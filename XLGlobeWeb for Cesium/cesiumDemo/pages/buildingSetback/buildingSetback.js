/* eslint-disable accessor-pairs */

const DEFAULT_STYLES = {
  safeColor: Cesium.Color.GREEN.withAlpha(0.5),
  violationColor: Cesium.Color.RED.withAlpha(0.7),
  highlightColor: Cesium.Color.YELLOW.withAlpha(0.8), // 新增高亮颜色
  lineWidth: 0.0,
  buildingBuffer: {
    distance: 0.5, // 建筑底面缓冲距离（米）
    units: 'meters'
  },
  _minHeight: 0.0,
  _maxHeight: 1000.0
}

 class SetbackAnalysisTool {
  constructor (options = {}) {
    this._redline = null // 红线数据（线/面）
    this._parcel = null // 地块数据（面）
    this._buildings = null // 建筑底面数据（面）
    this._bufferDistance = options.bufferDistance || 10
    this._tolerance = options.tolerance || DEFAULT_STYLES.buildingBuffer.distance
    this.primitive = null // 主图元对象
    this.classificationPrimitive = null // 分类图元对象
    this.highlightPrimitive = null // 高亮图元对象
    this.lineWidth = options.lineWidth || DEFAULT_STYLES.lineWidth
  }

  // 设置红线数据（线或面）
  set Redline (geojson) {
    const rl = this._normalizeGeoJSON(geojson)
    let isline = false
    const validTypes = ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']

    rl.features.forEach(feature => {
      if (!validTypes.includes(feature.geometry.type)) {
        console.warn(`不支持的几何类型: ${feature.geometry.type}，仅支持线/面数据`)
      }

      if (['LineString', 'MultiLineString'].includes(feature.geometry.type)) {
        isline = true
      }
    })

    this._redline = isline && this.lineWidth > 0
      ? turf.buffer(rl, this.lineWidth, { units: 'meters' })
      : rl
  }

  // 设置地块数据（面）
  set Parcel (geojson) {
    this._parcel = this._normalizeGeoJSON(geojson)
  }

  // 设置建筑底面数据（面）
  set Buildings (geojson) {
    this._buildings = this._normalizeGeoJSON(geojson)
  }

  // 设置退让距离
  set BufferDistance (meters) {
    this._bufferDistance = meters
    this.updateAnalysis()
  }

  // 验证并标准化输入数据
  _normalizeInput (geojson) {
    if (!geojson) return null

    // 标准化为FeatureCollection
    const normalized = this._normalizeGeoJSON(geojson)
    if (!normalized) return null

    // 清理几何坐标
    const cleanedFeatures = normalized.features.map(feature => {
      try {
        // 处理线数据自动转为多边形
        if (feature.geometry.type.includes('LineString')) {
          return turf.feature(
            turf.lineToPolygon(feature).geometry,
            feature.properties
          )
        }

        // 清理无效坐标点
        return turf.cleanCoords(feature)
      } catch (e) {
        console.warn('几何体清理失败:', e)
        return null
      }
    }).filter(Boolean)

    return turf.featureCollection(cleanedFeatures)
  }

  // 更新分析
  updateAnalysis () {
    this._clearVisuals()

    if (!this._redline) return

    // 1. 生成退让范围（红线缓冲区）
    let setbackArea = turf.buffer(
      this._redline,
      this._bufferDistance,
      { units: 'meters' }
    )
    this._parcel = this._normalizeInput(this._parcel)
    setbackArea = this._normalizeInput(setbackArea)

    // 2. 根据输入数据类型选择分析模式
    if (this._buildings) {
      this._analyzeBuildings(setbackArea)
    } else if (this._parcel) {
      this._analyzeParcel(setbackArea)
    } else {
      // 仅显示退让范围
      this._visualizeSetbackArea(setbackArea)
    }
  }

  // 建筑底面分析模式
  _analyzeBuildings (setbackArea) {
    // 对建筑底面进行缓冲
    const bufferedBuildings = turf.buffer(
      this._buildings,
      this._tolerance,
      { units: DEFAULT_STYLES.buildingBuffer.units }
    )

    // 分割建筑为违规/安全区域
    const violationFeatures = []
    const safeFeatures = []

    bufferedBuildings.features.forEach(building => {
      const isViolated = turf.booleanIntersects(building, setbackArea)
      if (isViolated) {
        violationFeatures.push(building)
      } else {
        safeFeatures.push(building)
      }
    })

    // 可视化
    this._createPrimitive({
      violation: turf.featureCollection(violationFeatures),
      safe: turf.featureCollection(safeFeatures)
    })
  }

  // 地块分析模式
  async _analyzeParcel (setbackArea) {
    const violationArea = this.robustIntersectionAnalysis(this._parcel, setbackArea)
    const safeArea = await this.calculateDifference(this._parcel, setbackArea)
    // 可视化
    this._createPrimitive({
      violation: violationArea,
      safe: safeArea
    })
  }

  // 相交分析
  robustIntersectionAnalysis (parcel, road) {
    try {
      // 1. 转换MultiPolygon为多个Polygon
      const parcelPolygons = parcel.features.flatMap(f =>
        f.geometry.type === 'MultiPolygon'
          ? f.geometry.coordinates.map(poly =>
            turf.polygon(poly, f.properties))
          : [f]
      )

      // 2. 对每个多边形执行相交分析
      const results = []
      for (const roadFeature of road.features) {
        for (const parcelPoly of parcelPolygons) {
          try {
            const intersection = turf.intersect(parcelPoly, roadFeature)
            if (intersection) {
              results.push(intersection)
            }
          } catch (e) {
            console.warn('单个相交分析失败:', e)
          }
        }
      }

      // 3. 合并结果
      return results.length > 0
        ? turf.featureCollection(results)
        : null
    } catch (error) {
      console.error('分析流程错误:', error)
      return null
    }
  }

  /**
 * 计算地块与道路的差异区域（支持MultiPolygon、GeometryCollection等复杂情况）
 * @param {GeoJSON} parcelData 地块数据（Polygon/MultiPolygon/FeatureCollection）
 * @param {GeoJSON} roadData 道路数据（Polygon/MultiPolygon/FeatureCollection）
 * @returns {GeoJSON|null} 安全区域GeoJSON
 */
  calculateDifference (parcelData, roadData) {
  if (!parcelData || !roadData) return null

  try {
    // 1. 标准化输入数据
    const normalizedParcel = this._normalizeAndClean(parcelData)
    const normalizedRoad = this._normalizeAndClean(roadData)

    // 2. 获取所有道路多边形的联合体（作为剪切区域）
    const roadUnion = this._createUnionPolygon(normalizedRoad)
    if (!roadUnion) return normalizedParcel

    // 3. 分解所有地块多边形（包括MultiPolygon）
    const parcelPolygons = this._extractPolygons(normalizedParcel)
    if (parcelPolygons.length === 0) return null

    // 4. 并行计算差异（使用Promise提高性能）
    const diffResults = []
    const promises = parcelPolygons.map(polygon =>
      this._calculatePolygonDifference(polygon, roadUnion)
        .then(result => result && diffResults.push(result))
        .catch(e => console.warn('多边形差异计算失败:', e))
    )

    // 5. 等待所有计算完成
    return Promise.all(promises).then(() => {
      if (diffResults.length === 0) return null

      // 6. 合并所有有效结果
      const merged = this._mergeFeatures(turf.featureCollection(diffResults))
      return merged ? this._ensureValidPolygon(merged) : null
    })
  } catch (error) {
    console.error('差异计算流程错误:', error)
    return null
  }
}

  // ========== 关键辅助方法 ========== //
  // 辅助方法：合并多个要素为一个
  _mergeFeatures (featureCollection) {
  if (featureCollection.features.length <= 1) {
    return featureCollection.features[0] || null
  }

  try {
    // 尝试直接union
    return featureCollection.features.reduce((merged, feature) => {
      return merged ? turf.union(merged, feature) : feature
    }, null)
  } catch (e) {
    // union失败时使用bbox合并
    console.warn('使用union合并失败，改用bbox合并')
    const bbox = turf.bbox(featureCollection)
    return turf.bboxPolygon(bbox)
  }
}

  /**
 * 标准化并清理GeoJSON数据
 */
  _normalizeAndClean (geojson) {
  // 转换为FeatureCollection
  const normalized = this._normalizeGeoJSON(geojson)

  // 清理坐标并修复拓扑
  return turf.featureCollection(
    normalized.features
      .map(f => {
        try {
          const cleaned = turf.cleanCoords(f)
          return turf.rewind(cleaned, { reverse: true }) // 统一环绕方向
        } catch (e) {
          console.warn('几何体清理失败:', e)
          return null
        }
      })
      .filter(Boolean)
  )
}

  /**
 * 从GeoJSON中提取所有多边形（包括MultiPolygon分解）
 */
  _extractPolygons (featureCollection) {
  return featureCollection.features.flatMap(feature => {
    switch (feature.geometry.type) {
    case 'Polygon':
      return [turf.clone(feature)]
    case 'MultiPolygon':
      return feature.geometry.coordinates.map(coords =>
        turf.polygon(coords, feature.properties)
      )
    case 'GeometryCollection':
      return feature.geometry.geometries
        .filter(g => g.type === 'Polygon' || g.type === 'MultiPolygon')
        .flatMap(g =>
          g.type === 'Polygon'
            ? [turf.polygon(g.coordinates, feature.properties)]
            : g.coordinates.map(c => turf.polygon(c, feature.properties))
        )
    default:
      return []
    }
  })
}

  /**
 * 创建道路多边形的联合体（带容错机制）
 */
  _createUnionPolygon (roadFeatures) {
  if (roadFeatures.features.length === 0) return null

  try {
    // 尝试快速合并
    if (roadFeatures.features.length === 1) {
      return roadFeatures.features[0]
    }

    // 分步合并避免内存溢出
    let union = roadFeatures.features[0]
    for (let i = 1; i < roadFeatures.features.length; i++) {
      try {
        union = turf.union(union, roadFeatures.features[i])
      } catch (e) {
        console.warn(`合并道路多边形 ${i} 失败:`, e)
        // 失败时改为缓冲后合并
        const buffered = turf.buffer(roadFeatures.features[i], 0.01, { units: 'meters' })
        union = turf.union(union, buffered)
      }
    }
    return union
  } catch (error) {
    console.error('道路合并失败，使用包围盒替代:', error)
    return turf.bboxPolygon(turf.bbox(roadFeatures))
  }
}

  /**
 * 单个多边形差异计算（Promise封装）
 */
  _calculatePolygonDifference (polygon, clipping) {
  return new Promise((resolve) => {
    try {
      // 快速判断无交集
      if (!turf.booleanIntersects(polygon, clipping)) {
        resolve(polygon)
        return
      }

      // 精确计算差异
      const diff = turf.difference(polygon, clipping)

      // 验证结果
      if (!diff || turf.area(diff) < 0.1) {
        resolve(null)
      } else {
        resolve(this._ensureValidPolygon(diff))
      }
    } catch (e) {
      // 尝试缓冲补偿
      try {
        const bufferedPoly = turf.buffer(polygon, 0.01, { units: 'meters' })
        const diff = turf.difference(bufferedPoly, clipping)
        resolve(diff && turf.area(diff) >= 0.1 ? diff : null)
      } catch (bufferError) {
        console.warn('缓冲补偿方案失败:', bufferError)
        resolve(null)
      }
    }
  })
}

  /**
 * 确保多边形有效性
 */
  _ensureValidPolygon (feature) {
  try {
    // 检查面积
    if (turf.area(feature) < 0.1) return null

    // 重新清理坐标
    const cleaned = turf.cleanCoords(feature)

    // 修复可能的拓扑问题
    return turf.rewind(cleaned, { reverse: true })
  } catch (e) {
    console.warn('多边形验证失败:', e)
    return null
  }
}

  // 创建可视化图元
  _createPrimitive ({ violation, safe }) {
  // 清除现有图元
  this._clearVisuals()

  // 1. 创建地面图元（仅红色违规区域）
  if (violation) {
    const violationInstances = this._createGeometryInstances(violation, DEFAULT_STYLES.violationColor, true)
    this.primitive = new Cesium.Primitive({
      geometryInstances: violationInstances,
      appearance: new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        renderState: { depthTest: { enabled: true } }
      })
    })
    viewer.scene.primitives.add(this.primitive)
  }

  // 2. 创建两个独立的分类图元（红色和绿色分开）
  if (violation || safe) {
    // 红色分类图元
    if (violation) {
      const violationClassifyInstances = this._createGeometryInstances(violation, DEFAULT_STYLES.violationColor)
      this.violationClassification = new Cesium.ClassificationPrimitive({
        geometryInstances: violationClassifyInstances,
        // appearance: new Cesium.PerInstanceColorAppearance({
        //   flat: true,
        //   translucent: true,
        //   closed: true
        // }),
        classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
        asynchronous: true
      })

      viewer.scene.primitives.add(this.violationClassification)
    }

    // 绿色分类图元
    if (safe) {
      const safeClassifyInstances = this._createGeometryInstances(safe, DEFAULT_STYLES.safeColor)
      this.safeClassification = new Cesium.ClassificationPrimitive({
        geometryInstances: safeClassifyInstances,
        // appearance: new Cesium.PerInstanceColorAppearance({
        //   flat: true,
        //   translucent: true,
        //   closed: true
        // }),
        classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
        asynchronous: true
      })
      viewer.scene.primitives.add(this.safeClassification)
    }
  }
}

  // 仅显示退让范围
  _visualizeSetbackArea (setbackArea) {
    this._createPrimitive({
      violation: setbackArea,
      safe: null
    })
  }

  // 创建几何实例
  _createGeometryInstances (geojson, color, flag) {
    const features = geojson.type === 'FeatureCollection'
      ? geojson.features
      : [geojson]

    return features.flatMap(feature => {
      if (!feature.geometry ||
        (feature.geometry.type !== 'Polygon' &&
          feature.geometry.type !== 'MultiPolygon')) {
        return []
      }

      const polygons = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates

      return polygons.map(polygon => {
        const hierarchy = new Cesium.PolygonHierarchy(
          Cesium.Cartesian3.fromDegreesArray(
            polygon[0].map(coord => [coord[0], coord[1]]).flat()
          )
        )
if (flag) {
        return new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: hierarchy,
            height: 0,
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
          }
        })
} else {
        return new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({
            polygonHierarchy: hierarchy,
            height: DEFAULT_STYLES._minHeight,
            extrudedHeight: DEFAULT_STYLES._maxHeight, // 确保不低于minHeight
            vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
          }
        })
}
      })
    })
  }

  // 标准化GeoJSON输入
  _normalizeGeoJSON (geojson) {
    if (!geojson) return null
    if (geojson.type === 'FeatureCollection') return geojson
    if (geojson.type === 'Feature') return turf.featureCollection([geojson])
    if (geojson.type) return turf.featureCollection([turf.feature(geojson)])
    throw new Error('Invalid GeoJSON input')
  }

  // 清理可视化
  _clearVisuals () {
  if (this.primitive) {
    viewer.scene.primitives.remove(this.primitive)
    this.primitive = null
  }
  if (this.violationClassification) {
    viewer.scene.primitives.remove(this.violationClassification)
    this.violationClassification = null
  }
  if (this.safeClassification) {
    viewer.scene.primitives.remove(this.safeClassification)
    this.safeClassification = null
  }
  this._clearHighlight()
}

  // 清理高亮
  _clearHighlight () {
    if (this.highlightPrimitive) {
      viewer.scene.primitives.remove(this.highlightPrimitive)
      this.highlightPrimitive = null
    }
  }

  // 销毁
  destroy () {
    this._clearVisuals()
  }
}


// 暴露到全局
// window.SetbackAnalysisTool = SetbackAnalysisTool;
