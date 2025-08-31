export default class FlattenTileset {
    /**
     * @param {Cesium.Cesium3DTileset|Cesium.Cesium3DTileset[]} tilesets 三维模型集
     * @param {Object} [opt] 配置项
     * @param {Number} [opt.oHeight=0] 统一基准高度
     */
    constructor(tilesets, opt) {
      this.opt = opt || {};
      this.oHeight = this.opt.oHeight || 0;
      this.tilesets = [];
      this.tilesetConfigs = new Map(); // 存储每个tileset的配置信息
      this.regionList = []; // 存储所有压平面信息
  
      this.addTileset(tilesets);
    }
  
    addTileset(tilesets) {
      const addSingle = (tileset) => {
        if (!tileset || this.tilesets.includes(tileset)) return;
  
        try {
          const center = tileset.boundingSphere.center.clone();
          let cart = Cesium.Cartographic.fromCartesian(center);
          let centerXYZ = [
            Cesium.Math.toDegrees(cart.longitude),
            Cesium.Math.toDegrees(cart.latitude),
            cart.height,
          ];
          const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(center);
          const localMatrix = Cesium.Matrix4.inverse(
            matrix,
            new Cesium.Matrix4()
          );
  
          this.tilesets.push(tileset);
          this.tilesetConfigs.set(tileset, {
            matrix,
            localMatrix,
            flatHeight: this.opt.flatHeight || 0,
            regions: [],
            centerXYZ,
          });
  
          // 应用现有压平面
          this.regionList.forEach((attr) =>
            this._addRegionToTileset(tileset, attr)
          );
          this._updateTilesetShader(tileset);
        } catch (e) {
          console.warn("Invalid tileset:", e);
        }
      };
  
      if (Array.isArray(tilesets)) {
        tilesets.forEach((t) => addSingle(t));
      } else if (tilesets) {
        addSingle(tilesets);
      }
    }
  
    removeTileset(tileset) {
      const index = this.tilesets.indexOf(tileset);
      if (index === -1) return;
  
      this.tilesets.splice(index, 1);
      this.tilesetConfigs.delete(tileset);
      tileset.customShader = undefined;
    }
  
    /**
     * 设置统一基准高度
     * @param {Number} height 新的基准高度
     */
    setOHeight(height) {
      this.oHeight = height;
      this.tilesets.forEach((tileset) => {
        if (tileset.customShader) {
          let _h = tileset.config.centerXYZ[2]
            ? height - tileset.config.centerXYZ[2]
            : height;
          tileset.customShader.setUniform("u_oHeight", _h);
        }
      });
    }
  
    /**
     * 设置指定tileset的压平高度
     * @param {Cesium.Cesium3DTileset} tileset 目标模型
     * @param {Number} height 压平高度（相对基准高度）
     */
    setFlatHeight(tileset, height) {
      const config = this.tilesetConfigs.get(tileset);
      if (!config) return;
  
      config.flatHeight = height;
      if (tileset.customShader) {
        tileset.customShader.setUniform("u_flatHeight", height);
      }
    }
    /**
     * 添加压平面（支持多种格式）
     * @param {Object} attr 参数
     * @param {Cesium.Cartesian3[]|number[][]|string|Object} attr.positions 坐标数据
     * @param {Number} [attr.height=0] 压平高度偏移
     * @param {String} [attr.id] 唯一标识
     * @param {String} [attr.format] 显式指定格式（可选值：cartesian/wkt/geojson/lonlat）仅支持单面
     */
    addRegion(attr) {
      if (!attr || !attr.positions) return;
  
      // 自动检测格式（可显式指定）
      const detectedFormat = attr.format || this._detectPositionFormat(attr.positions);
  
      try {
        // 转换为标准Cartesian3数组
        const positions = this._parsePositions(attr.positions, detectedFormat);
  
        // 验证坐标有效性
        if (!positions || positions.length < 3) {
          throw new Error("至少需要3个点组成多边形");
        }
  
        // 存储转换后的标准坐标
        attr.positions = positions;
        attr.id = attr.id || Cesium.createGuid();
        attr.height = attr.height || 0;
        this.regionList.push(attr);
  
        // 更新所有关联的tileset
        this.tilesets.forEach((tileset) => {
          this._addRegionToTileset(tileset, attr);
          this._updateTilesetShader(tileset);
        });
      } catch (e) {
        console.error("压平面添加失败:", e.message);
      }
    }
  
    /**
     * 自动检测坐标格式
     * @private
     */
    _detectPositionFormat(input) {
      if (Array.isArray(input)) {
        // 检测是否为二维数组 [[lon,lat], ...]
        if ((input[0].length === 2 || input[0].length === 3) && typeof input[0][0] === "number") {
          return "lonlat";
        }
        // 检测是否为Cartesian3数组
        if (input[0] instanceof Cesium.Cartesian3) {
          return "cartesian";
        }
      }
      // WKT字符串检测
      if (typeof input === "string" && input.match(/POLYGON\s*\(/i)) {
        return "wkt";
      }
      // GeoJSON检测
      if (input.type === "Feature" || input.type === "Polygon") {
        return "geojson";
      }
      throw new Error("无法识别的坐标格式");
    }
  
    /**
     * 坐标格式转换器
     * @private
     */
    _parsePositions(input, format) {
      switch (format) {
        case "cartesian":
          return input; // 直接使用现有Cartesian3数组
  
        case "lonlat":
          return input.map((p) =>
            Cesium.Cartesian3.fromDegrees(p[0], p[1], p[2] || 0)
          );
  
        case "wkt":
          return this._parseWKTPolygon(input);
  
        case "geojson":
          return this._parseGeoJSON(input);
  
        default:
          throw new Error(`不支持的格式: ${format}`);
      }
    }
  
    /**
     * 解析WKT多边形
     * @private
     */
    _parseWKTPolygon(wkt) {
      // 示例输入：POLYGON ((30 10, 40 40, 20 40, 10 20, 30 10))
      const match = wkt.match(/\(\(([^)]+)\)\)/);
      if (!match) throw new Error("无效的WKT格式");
  
      return match[1].split(",").map((pair) => {
        const [lon, lat] = pair.trim().split(/\s+/);
        return Cesium.Cartesian3.fromDegrees(parseFloat(lon), parseFloat(lat));
      });
    }
  
    /**
     * 解析GeoJSON
     * @private
     */
    _parseGeoJSON(geojson) {
      let coordinates;
      // 支持Feature或直接几何对象
      if (geojson.type === "Feature") {
        coordinates = geojson.geometry.coordinates;
      } else if (geojson.type === "Polygon") {
        coordinates = geojson.coordinates;
      } else {
        throw new Error("仅支持Polygon类型GeoJSON");
      }
  
      // 提取首个环（忽略孔洞）
      const ring = coordinates[0];
      if (!ring) throw new Error("缺少坐标数据");
  
      return ring.map((p) =>
        Cesium.Cartesian3.fromDegrees(p[0], p[1], p[2] || 0)
      );
    }
  
    _addRegionToTileset(tileset, attr) {
      const config = this.tilesetConfigs.get(tileset);
      if (!config) return;
  
      const localCoords = this._convertToLocalCoords(tileset, attr.positions);
      config.regions.push({
        id: attr.id,
        coords: localCoords,
        height: attr.height, // 存储区域高度
      });
    }
  
    removeRegionById(id) {
      this.regionList = this.regionList.filter((r) => r.id !== id);
  
      this.tilesets.forEach((tileset) => {
        const config = this.tilesetConfigs.get(tileset);
        if (!config) return;
  
        config.regions = config.regions.filter((r) => r.id !== id);
        this._updateTilesetShader(tileset);
      });
    }
  
    _convertToLocalCoords(tileset, positions) {
      const config = this.tilesetConfigs.get(tileset);
      return positions.map((pos) => {
        const local = Cesium.Matrix4.multiplyByPoint(
          config.localMatrix,
          pos,
          new Cesium.Cartesian3()
        );
        return [local.x, local.y];
      });
    }
  
    _updateTilesetShader(tileset) {
      const config = this.tilesetConfigs.get(tileset);
      if (!config) return;
  
      // 改为传递完整的regions数据（含高度）
      const funcStr = this._generateInPolygonFunctions(
        config.regions.map((r) => r.coords)
      );
      const mainLogic = this._generateShaderLogic(config.regions); // 传递regions而不是polygons
  
      tileset.customShader = new Cesium.CustomShader({
        uniforms: {
          u_tileset_localToWorldMatrix: {
            type: Cesium.UniformType.MAT4,
            value: config.matrix,
          },
          u_tileset_worldToLocalMatrix: {
            type: Cesium.UniformType.MAT4,
            value: config.localMatrix,
          },
          u_flatHeight: {
            type: Cesium.UniformType.FLOAT,
            value: config.flatHeight,
          },
          u_oHeight: {
            type: Cesium.UniformType.FLOAT,
            value: config.centerXYZ[2]
              ? this.oHeight - config.centerXYZ[2]
              : this.oHeight,
          },
        },
        vertexShaderText: `
                  ${funcStr}
                  void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
                      vec3 modelMC = vsInput.attributes.positionMC;
                      vec4 modelPos = vec4(modelMC, 1.0);
                      vec4 tilesetLocalPos = u_tileset_worldToLocalMatrix * czm_model * modelPos;
                      vec2 position2D = tilesetLocalPos.xy;
                      float baseHeight = u_oHeight + u_flatHeight;
  
                      ${mainLogic}
  
                      // 默认不修改顶点
                      vsOutput.positionMC = modelMC;
                  }`,
      });
    }
  
    _generateInPolygonFunctions(polygons) {
      const lengths = [...new Set(polygons.map((p) => p.length))];
      return lengths
        .map(
          (len) => `
              bool isInPolygon_${len}(vec2 pt, vec2[${len}] points) {
                  int crossings = 0;
                  for (int i = 0; i < ${len}; i++) {
                      vec2 a = points[i];
                      vec2 b = points[(i+1)%${len}];
                      if ((a.y > pt.y) != (b.y > pt.y)) {
                          float x = mix(a.x, b.x, (pt.y - a.y) / (b.y - a.y));
                          crossings += int(x > pt.x);
                      }
                  }
                  return (crossings % 2) == 1;
              }
          `
        )
        .join("\n");
    }
  
    _generateShaderLogic(regions) {
      // 参数改为regions（含高度信息）
      return regions
        .map((region, i) => {
          const coords = region.coords;
          const height = region.height;
          const len = coords.length;
  
          const points = coords
            .map(
              ([x, y], j) =>
                `points_${i}[${j}] = vec2(${x.toFixed(5)}, ${y.toFixed(5)});`
            )
            .join("\n");
  
          return `
                  {
                      vec2 points_${i}[${len}];
                      ${points}
                      if (isInPolygon_${len}(position2D, points_${i})) {
                          float finalHeight = u_oHeight + u_flatHeight + ${height.toFixed(
                            2
                          )};
                          vec4 newPos = vec4(tilesetLocalPos.xy, finalHeight, 1.0);
                          vec4 worldPos = u_tileset_localToWorldMatrix * newPos;
                          vsOutput.positionMC = (czm_inverseModel * worldPos).xyz;
                          return; // 重要：修改后立即返回
                      }
                  }
              `;
        })
        .join("\n");
    }
    clearAllRegions() {
      // 保存当前tileset引用防止遍历过程中发生变化
      const currentTilesets = [...this.tilesets];
  
      // 分步清理确保完全重置
      this.regionList.length = 0;
  
      currentTilesets.forEach((tileset) => {
        const config = this.tilesetConfigs.get(tileset);
        if (!config) return;
  
        // 重置区域配置
        config.regions = [];
  
        // 完全重置shader
        tileset.customShader = undefined;
  
        // 可选：延迟更新避免重复渲染
        requestAnimationFrame(() => {
          this._updateTilesetShader(tileset);
        });
      });
    }
    destroy() {
      this.tilesets.forEach((t) => (t.customShader = undefined));
      this.tilesets = [];
      this.tilesetConfigs.clear();
      this.regionList = [];
    }
  }
  