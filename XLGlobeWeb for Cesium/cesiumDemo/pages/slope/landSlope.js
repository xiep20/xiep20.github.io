// 项目中使用CDN方式引入turf库，直接使用全局变量turf
// import * as turf from '@turf/turf'
// 使用已通过HTML中的<script src="libs/delaunator.min.js"></script>引入的全局Delaunator对象
// import Delaunator from 'delaunator'

export default class LandSlopeAnalysisTool {
  constructor (viewer, options = {}) {
    this.viewer = viewer
    this.options = options
    this.slopeEntities = []
    this.analysisBoundary = null
    this.isCancelled = false
    this.progressCallback = null
    this.isAnalyzing = false

    // 默认坡度分级配置（可被自定义覆盖）
    this.defaultSlopeLevels = [{
      min: 0,
      max: 2,
      name: '平坡',
      color: '#00FF00', // 纯绿色 - 平缓区域
      description: '0°-2° 平坡'
    },
    {
      min: 2,
      max: 5,
      name: '缓坡',
      color: '#80FF00', // 黄绿色
      description: '2°-5° 缓坡'
    },
    {
      min: 5,
      max: 8,
      name: '微坡',
      color: '#FFFF00', // 黄色
      description: '5°-8° 微坡'
    },
    {
      min: 8,
      max: 15,
      name: '中坡',
      color: '#FF8C00', // 深橙色
      description: '8°-15° 中坡'
    },
    {
      min: 15,
      max: 25,
      name: '陡坡',
      color: '#FF4500', // 橙红色
      description: '15°-25° 陡坡'
    },
    {
      min: 25,
      max: 90,
      name: '极陡坡',
      color: '#FF0000', // 深红色 - 最陡区域
      description: '25°以上 极陡坡'
    }
    ]

    // 统一配置对象（可通过构造参数覆盖）
    this.config = Object.assign({
      maxSamplePoints: 4000, // 采样点总上限（包含并入的边界点）
      minSamplePoints: 50, // 采样点最小数量保障
      sampleDistanceKm: 0.003, // 初始规则网格间距（公里）
      terrainBatchSize: 1000, // 地形高程批量请求的批大小
      incrementalRenderBatchEdges: 2000, // 网格线增量渲染的每批边数量
      useGradientColor: false, // 使用连续渐变色映射坡度，否则使用分级颜色
      slopeLevels: null, // 自定义坡度分级（数组）时覆盖默认分级
      enableLOD: true, // 启用LOD：远距离减少边数量
      lodHeights: { simple: 15000, detailed: 8000 }, // LOD阈值（相机高度，米）
      lineWidth: 1.0, // 三角网线宽（像素）
      lineAlpha: 0.6, // 三角网线透明度（0-1）
      includeBoundaryPoints: true, // 将（简化后的）边界点并入采样
      boundarySimplifyToleranceMeters: 2, // 边界简化公差（米），越小越贴合、点数越多
      clipStrategy: 'intersect', // 三角网裁剪策略：'centroid' | 'intersect' | 'any-vertex'
      clipFallbackThreshold: 0.05, // 裁剪后保留比例低于此值则回退到未裁剪
      enforceEdgeClipping: true, // 渲染阶段对每条边做二次裁剪，避免面外线
      // 可视化模式：'grid' 网格线（当前方案）| 'points' 点云可视化
      visualizeMode: 'points',
      pointSize: 4, // 点模式下点大小（像素）
      pointsAlpha: 0.8, // 点模式下透明度
      pointBatchSize: 2000, // 点模式分批添加规模
      pointGroupByLevel: true, // 是否按坡度等级分组集合
      adaptiveColorScale: true, // 使用分位数/标准差自适应色带
      colorQuantileLow: 0.05, // 低分位
      colorQuantileHigh: 0.95, // 高分位
      sizeByDistance: true, // 点大小随距离衰减
      minPointSize: 2,
      maxPointSize: 8,
      depthTestDistance: Number.POSITIVE_INFINITY // 深度测试禁用距离
    }, options || {})

    // 生效的坡度分级
    this.slopeLevels = Array.isArray(this.config.slopeLevels) && this.config.slopeLevels.length > 0
      ? this.config.slopeLevels
      : this.defaultSlopeLevels

    // 性能相关便捷属性（向后兼容旧代码使用的字段名）
    this.maxSamplePoints = this.config.maxSamplePoints
    this.minSamplePoints = this.config.minSamplePoints
    this.sampleDistance = this.config.sampleDistanceKm

    // 渲染持有者
    this._unifiedGridPrimitive = null
    this._unifiedGridGeometryInstances = []
  }

  /**
     * 分析绘制范围的坡度（优化流程）
     */
  async analyzeSlope (analysisPolygon, _callback, progressCallback = null) {
    try {
      this.isAnalyzing = true
      this.clearAnalysis()
      this.isCancelled = false
      this.progressCallback = progressCallback

      // 步骤0: 初始化
      this.updateProgress(0, '开始分析')

      // 步骤1: 预处理分析区域
      this.updateProgress(5, '预处理分析区域...')
      const processedPolygon = this.preprocessAnalysisArea(analysisPolygon)
      if (!processedPolygon) {
        throw new Error('分析区域预处理失败')
      }

      // 创建分析边界
      // await this.createAnalysisBoundary(processedPolygon)

      // 步骤2: 生成采样点网格
      this.updateProgress(15, '生成采样点网格...')
      const samplePoints = await this.generateAdaptiveSampleGrid(processedPolygon)

      // 步骤3: 批量获取高程
      this.updateProgress(30, '获取地形高程...')
      const heights = await this.getTerrainHeightsBatch(samplePoints)

      // 步骤4: 生成Delaunay三角网
      this.updateProgress(50, '构建Delaunay三角网...')
      let triangulation = this.buildDelaunayTriangulation(samplePoints, heights)
      // 边界裁剪：仅保留在分析范围内的三角形
      triangulation = this.clipTriangulationToPolygon(triangulation, processedPolygon)

      // 步骤5: 计算每个三角形的坡度
      this.updateProgress(70, '计算坡度...')
      const slopeData = this.calculateTrianglesSlope(triangulation)

      if (slopeData.length === 0) {
        console.warn('未获取到坡度数据')
        _callback && _callback({
          success: false,
          message: '未获取到坡度数据'
        })
        return
      }

      // 步骤6: 坡度分级和可视化
      this.updateProgress(85, '生成坡度可视化...')

      console.log('=== 使用网格线可视化模式 ===')
      console.log('三角网格数据:', triangulation ? '有效' : '无效')

      // 可视化
      if ((this.config.visualizeMode || 'grid') === 'points') {
        await this.createSlopePointPrimitives(slopeData)
      } else {
        await this.createSlopeTriangularGridLines(triangulation, processedPolygon)
      }

      // this.createSlopeVisualization(slopeData) // 注释掉填充面效果

      // 计算统计信息
      const statistics = this.calculateStatistics(slopeData)

      console.log(`坡度分析完成，共分析 ${slopeData.length} 个坡度点`)

      // 最终进度更新
      this.updateProgress(100, '分析完成')

      _callback && _callback({
        success: true,
        data: [{
          geometry: {
            type: 'Polygon',
            coordinates: [processedPolygon]
          },
          properties: {},
          area: turf.area(turf.polygon([processedPolygon])),
          slopeData: slopeData,
          averageSlope: slopeData.reduce((sum, p) => sum + p.slope, 0) / slopeData.length,
          dominantLevel: this.getDominantLevel(slopeData),
          samplePointsCount: samplePoints.length
        }],
        totalPoints: slopeData.length,
        statistics: statistics,
        levels: this.slopeLevels
      })
    } catch (error) {
      console.error('坡度分析失败:', error)
      this.clearAnalysis()
      _callback && _callback({
        success: false,
        error: error.message,
        message: this.isCancelled ? '分析已取消' : '分析失败'
      })
    } finally {
      this.isAnalyzing = false
    }
  }

  /**
   * 更新进度回调
   */
  updateProgress (progress, message) {
    if (this.progressCallback) {
      this.progressCallback({
        progress,
        message
      })
    }
  }

  /**
     * 步骤1: 预处理分析区域
     * - 验证多边形有效性
     * - 确保多边形闭合
     * - 优化坐标精度
     * - 支持多面分割成单面
     */
  preprocessAnalysisArea (polygonCoords) {
    try {
      // 验证坐标
      if (!polygonCoords || polygonCoords.length < 3) {
        throw new Error('多边形坐标无效')
      }

      // 确保多边形闭合
      const processed = [...polygonCoords]
      const first = processed[0]
      const last = processed[processed.length - 1]

      // 如果首尾不闭合，添加闭合点
      if (first[0] !== last[0] || first[1] !== last[1]) {
        processed.push([...first])
      }

      // 验证多边形有效性
      const turfPolygon = turf.polygon([processed])
      const area = turf.area(turfPolygon)

      if (area < 100) {
        throw new Error('分析区域面积过小')
      }

      console.log(`预处理完成，区域面积: ${(area / 10000).toFixed(2)} 公顷`)
      return processed
    } catch (error) {
      console.error('预处理分析区域失败:', error)
      return null
    }
  }

  /**
     * 预处理多面几何数据，分割成单面
     * - 处理Polygon和MultiPolygon
     * - 返回单面坐标数组
     */
  preprocessMultiPolygonGeometry (geometry) {
    try {
      if (!geometry || !geometry.coordinates) {
        throw new Error('几何数据无效')
      }

      const singlePolygons = []

      if (geometry.type === 'Polygon') {
        // 单个多边形：处理外环和所有内环
        const outerRing = geometry.coordinates[0]
        if (outerRing && outerRing.length >= 3) {
          // 确保外环闭合
          const closedOuterRing = this.ensurePolygonClosed(outerRing)
          singlePolygons.push(closedOuterRing)
        }

        // 处理内环（洞）
        for (let i = 1; i < geometry.coordinates.length; i++) {
          const innerRing = geometry.coordinates[i]
          if (innerRing && innerRing.length >= 3) {
            const closedInnerRing = this.ensurePolygonClosed(innerRing)
            singlePolygons.push(closedInnerRing)
          }
        }
      } else if (geometry.type === 'MultiPolygon') {
        // 多个多边形：处理每个多边形的外环
        for (const polygon of geometry.coordinates) {
          if (polygon && polygon.length > 0) {
            const outerRing = polygon[0]
            if (outerRing && outerRing.length >= 3) {
              const closedOuterRing = this.ensurePolygonClosed(outerRing)
              singlePolygons.push(closedOuterRing)
            }
          }
        }
      } else {
        throw new Error('不支持的几何类型: ' + geometry.type)
      }

      // 过滤掉面积过小的多边形
      const validPolygons = singlePolygons.filter(polygonCoords => {
        try {
          const turfPolygon = turf.polygon([polygonCoords])
          const area = turf.area(turfPolygon)
          return area >= 100 // 最小面积阈值
        } catch (error) {
          console.warn('多边形面积计算失败:', error)
          return false
        }
      })

      console.log(`多面预处理完成，原始面数: ${singlePolygons.length}, 有效面数: ${validPolygons.length}`)
      return validPolygons
    } catch (error) {
      console.error('多面预处理失败:', error)
      return []
    }
  }

  /**
     * 确保多边形闭合
     */
  ensurePolygonClosed (coordinates) {
    if (!coordinates || coordinates.length < 3) {
      return coordinates
    }

    const processed = [...coordinates]
    const first = processed[0]
    const last = processed[processed.length - 1]

    // 如果首尾不闭合，添加闭合点
    if (first[0] !== last[0] || first[1] !== last[1]) {
      processed.push([...first])
    }

    return processed
  }

  /**
     * 步骤2: 生成自适应采样点网格
     * - 根据区域面积调整采样密度
     * - 根据地形复杂度动态调整
     */
  async generateAdaptiveSampleGrid (polygonCoords) {
    try {
      const turfPolygon = turf.polygon([polygonCoords])
      const area = turf.area(turfPolygon)
      const areaInHectares = area / 10000

      console.log(`分析区域: ${areaInHectares.toFixed(2)} 公顷`)

      // 根据面积动态调整采样密度
      let sampleDensity = 0.003
      if (areaInHectares < 0.1) {
        sampleDensity = 0.001 // 超小地块使用高密度
      } else if (areaInHectares < 1) {
        sampleDensity = 0.002 // 小块地使用较高密度
      } else if (areaInHectares < 10) {
        sampleDensity = 0.003 // 中等地块
      } else {
        sampleDensity = 0.005 // 大地块使用较低密度
      }

      const bbox = turf.bbox(turfPolygon)

      // 初始规则网格
      let gridPoints = turf.pointGrid(bbox, sampleDensity, {
        units: 'kilometers',
        mask: turfPolygon
      })

      let samplePoints = gridPoints.features.map(feature => ({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1]
      }))

      // 可选：基于地形复杂度的自适应再细分（快速预估）
      if (samplePoints.length > 0) {
        try {
          const sparse = []
          const step = Math.max(1, Math.floor(samplePoints.length / 50)) // 取最多50个点估计复杂度
          for (let i = 0; i < samplePoints.length; i += step) sparse.push(samplePoints[i])
          const heightsSparse = await this.getTerrainHeightsBatch(sparse)
          const mean = heightsSparse.reduce((s, h) => s + h, 0) / heightsSparse.length
          const variance = heightsSparse.reduce((s, h) => s + Math.pow(h - mean, 2), 0) / Math.max(1, heightsSparse.length - 1)
          const std = Math.sqrt(variance)
          // 简单阈值：地形起伏>8米 => 加密；>20米 => 强加密
          if (std > 20) sampleDensity = Math.max(0.001, sampleDensity * 0.5)
          else if (std > 8) sampleDensity = Math.max(0.001, sampleDensity * 0.75)

          if (std > 8) {
            gridPoints = turf.pointGrid(bbox, sampleDensity, {
              units: 'kilometers',
              mask: turfPolygon
            })
            samplePoints = gridPoints.features.map(f => ({
              longitude: f.geometry.coordinates[0],
              latitude: f.geometry.coordinates[1]
            }))
          }
        } catch (e) {
          // 忽略复杂度评估失败，保留原密度
        }
      }

      // 如果采样点不足，添加随机点
      if (samplePoints.length < this.minSamplePoints) {
        const neededPoints = Math.max(30, this.minSamplePoints - samplePoints.length)
        const randomPoints = turf.randomPoint(neededPoints, {
          bbox: bbox,
          mask: turfPolygon
        })

        samplePoints = samplePoints.concat(
          randomPoints.features.map(feature => ({
            longitude: feature.geometry.coordinates[0],
            latitude: feature.geometry.coordinates[1]
          }))
        )
      }

      // 如果采样点过多，均匀采样
      if (samplePoints.length > this.maxSamplePoints) {
        const step = samplePoints.length / this.maxSamplePoints
        const sampled = []
        for (let i = 0; i < this.maxSamplePoints; i++) {
          const index = Math.floor(i * step)
          sampled.push(samplePoints[index])
        }
        samplePoints = sampled
      }

      console.log(`生成 ${samplePoints.length} 个采样点`)
      // 边界点并入（简化后）
      if (this.config.includeBoundaryPoints) {
        try {
          const boundaryPoints = this.getSimplifiedBoundaryPoints(polygonCoords)
          // 先构建集合去重
          const key = (lon, lat) => `${lon.toFixed(8)},${lat.toFixed(8)}`
          const set = new Set()
          samplePoints.forEach(p => set.add(key(p.longitude, p.latitude)))
          const boundaryUnique = []
          for (const bp of boundaryPoints) {
            const k = key(bp.longitude, bp.latitude)
            if (!set.has(k)) {
              set.add(k)
              boundaryUnique.push(bp)
            }
          }

          // 合并并按上限裁剪：优先保留边界点
          let merged = samplePoints.concat(boundaryUnique)
          if (merged.length > this.maxSamplePoints) {
            const reservedBoundary = boundaryUnique
            const remain = Math.max(0, this.maxSamplePoints - reservedBoundary.length)
            if (remain === 0) {
              // 边界点太多，均匀抽样边界点到上限
              const step = Math.max(1, Math.floor(reservedBoundary.length / this.maxSamplePoints))
              const sampledBoundary = []
              for (let i = 0; i < reservedBoundary.length && sampledBoundary.length < this.maxSamplePoints; i += step) {
                sampledBoundary.push(reservedBoundary[i])
              }
              merged = sampledBoundary
            } else {
              const interior = samplePoints
              const interiorSampled = []
              if (interior.length <= remain) {
                merged = reservedBoundary.concat(interior)
              } else {
                const stepI = interior.length / remain
                for (let i = 0; i < remain; i++) {
                  interiorSampled.push(interior[Math.floor(i * stepI)])
                }
                merged = reservedBoundary.concat(interiorSampled)
              }
            }
          }
          samplePoints = merged
        } catch (e) {
          // 边界并入失败则忽略，使用原采样
        }
      }

      return samplePoints
    } catch (error) {
      console.error('生成采样点失败:', error)
      return []
    }
  }

  /**
   * 生成简化后的边界点（外环；输入为闭合坐标串）
   */
  getSimplifiedBoundaryPoints (polygonCoords) {
    try {
      const poly = turf.polygon([polygonCoords])
      // 将米转换为度（近似）
      const tolMeters = Math.max(0, this.config.boundarySimplifyToleranceMeters || 8)
      const tolDegrees = tolMeters / 111320
      const simplified = turf.simplify(poly, { tolerance: tolDegrees, highQuality: true, mutate: false })
      const ring = simplified.geometry && simplified.geometry.coordinates && simplified.geometry.coordinates[0]
        ? simplified.geometry.coordinates[0]
        : polygonCoords
      const points = []
      // 去掉闭合末尾重复点
      const n = ring.length
      for (let i = 0; i < n - 1; i++) {
        const c = ring[i]
        points.push({ longitude: c[0], latitude: c[1] })
      }
      return points
    } catch (e) {
      // 失败则退回原边界点（去掉闭合点）
      const res = []
      for (let i = 0; i < polygonCoords.length - 1; i++) {
        const c = polygonCoords[i]
        res.push({ longitude: c[0], latitude: c[1] })
      }
      return res
    }
  }

  /**
     * 步骤3: 批量获取高程
     * - 高效批量采样地形
     * - 处理采样失败的情况
     */
  async getTerrainHeightsBatch (samplePoints) {
    try {
      if (!this.viewer.terrainProvider ||
          this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
        console.warn('地形服务不可用，使用模拟高度')
        return this.generateSimulatedHeights(samplePoints)
      }

      const batchSize = Math.max(100, this.config.terrainBatchSize || 1000)
      const results = new Array(samplePoints.length)

      const runBatch = async (start, end) => {
        const slice = samplePoints.slice(start, end)
        const carto = slice.map(p => Cesium.Cartographic.fromDegrees(p.longitude, p.latitude))
        const updated = await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, carto)
        for (let i = 0; i < updated.length; i++) {
          const h = (updated[i] && typeof updated[i].height === 'number' && isFinite(updated[i].height)) ? updated[i].height : 0
          results[start + i] = h
        }
      }

      const tasks = []
      for (let i = 0; i < samplePoints.length; i += batchSize) {
        tasks.push(runBatch(i, Math.min(i + batchSize, samplePoints.length)))
      }
      // 顺序执行以避免过多并发压垮服务
      for (const t of tasks) {
        // eslint-disable-next-line no-await-in-loop
        await t
      }

      console.log(`获取到 ${results.length} 个有效高度值（分批：${batchSize}）`)
      return results
    } catch (error) {
      console.error('获取地形高度失败:', error)
      return this.generateSimulatedHeights(samplePoints)
    }
  }

  /**
     * 步骤4: 构建Delaunay三角网
     * - 基于采样点构建三角网格
     * - 返回三角形列表
     */
  buildDelaunayTriangulation (samplePoints, heights) {
    try {
      if (!samplePoints || samplePoints.length < 3 || !heights || heights.length !== samplePoints.length) {
        console.warn('采样点或高度数据不足，无法构建三角网')
        return null
      }

      // 过滤无效点
      const validPoints = []
      const validHeights = []
      const originalIndices = []

      for (let i = 0; i < samplePoints.length; i++) {
        if (samplePoints[i] && heights[i] !== undefined && isFinite(heights[i])) {
          validPoints.push([samplePoints[i].longitude, samplePoints[i].latitude])
          validHeights.push(heights[i])
          originalIndices.push(i)
        }
      }

      if (validPoints.length < 3) {
        console.warn('有效采样点不足3个，无法构建三角网')
        return null
      }

      // 构建Delaunay三角网
      const delaunay = Delaunator.from(validPoints)
      const triangles = delaunay.triangles

      if (triangles.length < 3) {
        console.warn('三角网构建失败')
        return null
      }

      console.log(`生成了 ${triangles.length / 3} 个三角形`)

      return {
        triangles,
        validPoints,
        validHeights,
        originalIndices,
        samplePoints
      }
    } catch (error) {
      console.error('构建Delaunay三角网失败:', error)
      return null
    }
  }

  /**
   * 将三角网裁剪到边界多边形（仅保留质心在区域内的三角形）
   */
  clipTriangulationToPolygon (triangulation, polygonCoords) {
    try {
      if (!triangulation || !polygonCoords) return triangulation
      const { triangles, validPoints, validHeights, originalIndices, samplePoints } = triangulation
      const polygon = turf.polygon([polygonCoords])
      const kept = []
      const total = triangles.length / 3

      const strategy = (this.config.clipStrategy || 'intersect').toLowerCase()

      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i]
        const i1 = triangles[i + 1]
        const i2 = triangles[i + 2]
        const p0 = validPoints[i0]
        const p1 = validPoints[i1]
        const p2 = validPoints[i2]

        let keep = false
        if (strategy === 'centroid') {
          const cx = (p0[0] + p1[0] + p2[0]) / 3
          const cy = (p0[1] + p1[1] + p2[1]) / 3
          const centroid = turf.point([cx, cy])
          keep = turf.booleanPointInPolygon(centroid, polygon)
        } else if (strategy === 'any-vertex') {
          const v0 = turf.point(p0)
          const v1 = turf.point(p1)
          const v2 = turf.point(p2)
          keep = turf.booleanPointInPolygon(v0, polygon) ||
                 turf.booleanPointInPolygon(v1, polygon) ||
                 turf.booleanPointInPolygon(v2, polygon)
        } else { // intersect (默认)
          const tri = turf.polygon([[p0, p1, p2, p0]])
          // 任一条件满足即保留：相交或任一顶点在内（提升稳健性）
          keep = turf.booleanIntersects(tri, polygon) ||
                 turf.booleanPointInPolygon(turf.point(p0), polygon) ||
                 turf.booleanPointInPolygon(turf.point(p1), polygon) ||
                 turf.booleanPointInPolygon(turf.point(p2), polygon)
        }

        if (keep) {
          kept.push(i0, i1, i2)
        }
      }

      // 若裁剪后保留比例过低，回退原三角网，避免无坡度
      const keepRatio = kept.length / 3 / Math.max(1, total)
      if (kept.length === 0 || keepRatio < (this.config.clipFallbackThreshold || 0.05)) {
        return triangulation
      }

      return { triangles: kept, validPoints, validHeights, originalIndices, samplePoints }
    } catch (e) {
      return triangulation
    }
  }

  /**
     * 步骤5: 计算每个三角形的坡度
     * - 遍历所有三角形
     * - 计算每个三角形的坡度值
     * - 为每个顶点分配坡度
     */
  calculateTrianglesSlope (triangulation) {
    try {
      if (!triangulation) {
        return []
      }

      const { triangles, validPoints, validHeights } = triangulation

      const sums = new Float64Array(validPoints.length)
      const counts = new Uint32Array(validPoints.length)

      // 遍历所有三角形，按顶点索引累加坡度
      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i]
        const i1 = triangles[i + 1]
        const i2 = triangles[i + 2]

        const p0 = { longitude: validPoints[i0][0], latitude: validPoints[i0][1], height: validHeights[i0] }
        const p1 = { longitude: validPoints[i1][0], latitude: validPoints[i1][1], height: validHeights[i1] }
        const p2 = { longitude: validPoints[i2][0], latitude: validPoints[i2][1], height: validHeights[i2] }

        const slope = this.calculateTriangleSlope(p0, p1, p2)
        if (isFinite(slope) && slope > 0) {
          sums[i0] += slope; counts[i0]++
          sums[i1] += slope; counts[i1]++
          sums[i2] += slope; counts[i2]++
        }
      }

      const slopeData = []
      for (let idx = 0; idx < validPoints.length; idx++) {
        const avg = counts[idx] > 0 ? (sums[idx] / counts[idx]) : 0
        const level = this.getSlopeLevel(avg)
        slopeData.push({
          point: { longitude: validPoints[idx][0], latitude: validPoints[idx][1] },
          slope: avg,
          level: level,
          height: validHeights[idx]
        })
      }

      console.log(`坡度计算完成，共 ${slopeData.length} 个坡度点`)
      return slopeData
    } catch (error) {
      console.error('计算坡度失败:', error)
      return []
    }
  }

  /**
     * 分析整个区域（保留兼容性）
     */
  async analyzeArea (polygonCoords) {
    try {
      const turfPolygon = turf.polygon([polygonCoords])
      const area = turf.area(turfPolygon)

      const samplePoints = this.generateSamplePoints(turfPolygon, area)
      if (samplePoints.length < this.minSamplePoints) {
        console.warn('采样点不足')
        return null
      }

      const heights = await this.getTerrainHeights(samplePoints)
      if (!heights || heights.length === 0) {
        console.warn('无法获取地形高度')
        return null
      }

      const slopeData = this.calculateSlopeWithDelaunay(samplePoints, heights)

      if (slopeData.length === 0) {
        return null
      }

      // 计算平均坡度和主要等级
      const avgSlope = slopeData.reduce((sum, point) => sum + point.slope, 0) / slopeData.length
      const dominantLevel = this.getDominantLevel(slopeData)

      return {
        geometry: {
          type: 'Polygon',
          coordinates: [polygonCoords]
        },
        properties: {},
        area: area,
        slopeData: slopeData,
        averageSlope: avgSlope,
        dominantLevel: dominantLevel,
        samplePointsCount: samplePoints.length
      }
    } catch (error) {
      console.error('分析区域失败:', error)
      return null
    }
  }

  /**
     * 生成采样点
     */
  generateSamplePoints (turfPolygon, area) {
    try {
      // 根据面积动态调整采样密度，确保点云覆盖完整
      const areaInHectares = area / 10000
      let sampleDensity = 0.003 // 默认密度，进一步提高采样密度

      // 根据地块面积调整采样密度
      if (areaInHectares < 0.1) {
        sampleDensity = 0.001 // 超小地块使用高密度
      } else if (areaInHectares < 1) {
        sampleDensity = 0.002 // 小块地使用较高密度
      } else if (areaInHectares < 10) {
        sampleDensity = 0.003 // 中等地块使用中等密度
      } else {
        sampleDensity = 0.005 // 大地块使用较低密度
      }

      const bbox = turf.bbox(turfPolygon)

      // 使用turf的pointGrid生成规则网格点
      const gridPoints = turf.pointGrid(bbox, sampleDensity, {
        units: 'kilometers',
        mask: turfPolygon
      })

      let samplePoints = gridPoints.features.map(feature => ({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1]
      }))

      // 如果采样点不足，添加随机点补充
      if (samplePoints.length < this.minSamplePoints) {
        const neededPoints = Math.max(30, this.minSamplePoints - samplePoints.length)
        const randomPoints = turf.randomPoint(neededPoints, {
          bbox: bbox,
          mask: turfPolygon
        })

        samplePoints = samplePoints.concat(
          randomPoints.features.map(feature => ({
            longitude: feature.geometry.coordinates[0],
            latitude: feature.geometry.coordinates[1]
          }))
        )
      }

      // 如果采样点过多，使用均匀采样保留代表性点
      if (samplePoints.length > this.maxSamplePoints) {
        samplePoints = this.uniformlySamplePoints(samplePoints, this.maxSamplePoints)
      }

      // 如果采样点仍然不足，添加额外的随机点
      if (samplePoints.length < this.minSamplePoints) {
        const additionalPoints = this.generateAdditionalRandomPoints(turfPolygon, this.minSamplePoints - samplePoints.length)
        samplePoints = samplePoints.concat(additionalPoints)
      }

      console.log(`为面积 ${areaInHectares.toFixed(4)} 公顷的地块生成 ${samplePoints.length} 个采样点`)
      return samplePoints
    } catch (error) {
      console.error('生成采样点失败:', error)
      return []
    }
  }

  /**
   * 均匀采样点集，保留代表性点
   */
  uniformlySamplePoints (points, targetCount) {
    if (points.length <= targetCount) return points

    const sampledPoints = []
    const step = points.length / targetCount

    for (let i = 0; i < targetCount; i++) {
      const index = Math.floor(i * step)
      sampledPoints.push(points[index])
    }

    return sampledPoints
  }

  /**
   * 生成额外的随机采样点
   */
  generateAdditionalRandomPoints (turfPolygon, count) {
    try {
      const bbox = turf.bbox(turfPolygon)
      const randomPoints = turf.randomPoint(count, {
        bbox: bbox,
        mask: turfPolygon
      })

      return randomPoints.features.map(feature => ({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1]
      }))
    } catch (error) {
      console.warn('生成额外随机点失败:', error)
      return []
    }
  }

  /**
     * 获取地形高度
     */
  async getTerrainHeights (samplePoints) {
    // 统一走分批逻辑，消除重复代码
    return this.getTerrainHeightsBatch(samplePoints)
  }

  /**
     * 生成模拟高度数据
     */
  generateSimulatedHeights (samplePoints) {
    return samplePoints.map((point, index) => {
      const baseHeight = 100 + Math.sin(point.longitude * 0.01) * 50 + Math.cos(point.latitude * 0.01) * 30
      const variation = Math.sin(point.longitude * 0.1) * Math.cos(point.latitude * 0.1) * 20
      return baseHeight + variation + (index % 10) * 2
    })
  }

  /**
     * 使用Delaunay三角网计算坡度
     */
  calculateSlopeWithDelaunay (samplePoints, heights) {
    try {
      if (!samplePoints || samplePoints.length < 3 || !heights || heights.length !== samplePoints.length) {
        console.warn('采样点或高度数据不足，无法构建三角网')
        return []
      }

      // 过滤无效数据点
      const validPoints = []
      const validHeights = []
      const originalIndices = []

      for (let i = 0; i < samplePoints.length; i++) {
        if (samplePoints[i] && heights[i] !== undefined && isFinite(heights[i])) {
          validPoints.push([samplePoints[i].longitude, samplePoints[i].latitude])
          validHeights.push(heights[i])
          originalIndices.push(i)
        }
      }

      if (validPoints.length < 3) {
        console.warn('有效采样点不足3个，无法构建三角网')
        return []
      }

      // 构建Delaunay三角网
      const delaunay = Delaunator.from(validPoints)
      const triangles = delaunay.triangles

      if (triangles.length < 3) {
        console.warn('三角网构建失败')
        return []
      }

      const slopeData = []
      // 用于存储每个原始点的坡度值，避免重复计算
      const pointSlopes = new Map()

      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i]
        const i1 = triangles[i + 1]
        const i2 = triangles[i + 2]

        const p0 = {
          longitude: validPoints[i0][0],
          latitude: validPoints[i0][1],
          height: validHeights[i0],
          originalIndex: originalIndices[i0]
        }
        const p1 = {
          longitude: validPoints[i1][0],
          latitude: validPoints[i1][1],
          height: validHeights[i1],
          originalIndex: originalIndices[i1]
        }
        const p2 = {
          longitude: validPoints[i2][0],
          latitude: validPoints[i2][1],
          height: validHeights[i2],
          originalIndex: originalIndices[i2]
        }

        // 计算三角形坡度
        const slope = this.calculateTriangleSlope(p0, p1, p2)

        // 为每个点记录坡度值
        const points = [p0, p1, p2]
        points.forEach(point => {
          const pointKey = `${point.longitude},${point.latitude}`
          if (!pointSlopes.has(pointKey)) {
            pointSlopes.set(pointKey, [])
          }
          pointSlopes.get(pointKey).push(slope)
        })
      }

      // 对每个点的多个坡度值取平均，提高准确性
      pointSlopes.forEach((slopes, pointKey) => {
        const [longitude, latitude] = pointKey.split(',').map(Number)
        const avgSlope = slopes.reduce((sum, s) => sum + s, 0) / slopes.length
        const level = this.getSlopeLevel(avgSlope)

        // 查找对应的高度值
        let height = 0
        const pointIndex = samplePoints.findIndex(p =>
          p && Math.abs(p.longitude - longitude) < 1e-10 && Math.abs(p.latitude - latitude) < 1e-10
        )
        if (pointIndex >= 0) {
          height = heights[pointIndex]
        }

        slopeData.push({
          point: {
            longitude: longitude,
            latitude: latitude
          },
          slope: avgSlope,
          level: level,
          height: height
        })
      })

      console.log(`Delaunay坡度计算完成，生成 ${slopeData.length} 个坡度点`)
      return slopeData
    } catch (error) {
      console.error('Delaunay坡度计算失败:', error)
      return []
    }
  }

  /**
     * 计算三角形坡度
     */
  calculateTriangleSlope (p0, p1, p2) {
    try {
      // 计算3条边的坡度，取平均
      const slopes = []

      // 计算边 p0-p1 的坡度
      const slope01 = this.calculateEdgeSlope(p0, p1)
      if (slope01 > 0) slopes.push(slope01)

      // 计算边 p0-p2 的坡度
      const slope02 = this.calculateEdgeSlope(p0, p2)
      if (slope02 > 0) slopes.push(slope02)

      // 计算边 p1-p2 的坡度
      const slope12 = this.calculateEdgeSlope(p1, p2)
      if (slope12 > 0) slopes.push(slope12)

      // 返回平均坡度
      if (slopes.length === 0) return 0
      const avgSlope = slopes.reduce((sum, s) => sum + s, 0) / slopes.length
      return avgSlope
    } catch (error) {
      console.error('计算三角形坡度失败:', error)
      return 0
    }
  }

  /**
   * 计算边的坡度（正确方法）
   */
  calculateEdgeSlope (p0, p1) {
    try {
      // 计算水平距离（米）
      const horizontalDistance = this.calculateHorizontalDistance(p0, p1)

      if (horizontalDistance === 0) return 0

      // 计算垂直距离（米）
      const verticalDistance = Math.abs(p1.height - p0.height)

      // 坡度 = arctan(垂直距离/水平距离)
      const slopeRadians = Math.atan(verticalDistance / horizontalDistance)
      const slopeDegrees = slopeRadians * 180 / Math.PI

      return slopeDegrees
    } catch (error) {
      console.error('计算边坡度失败:', error)
      return 0
    }
  }

  /**
   * 计算两点间的水平距离（米）
   */
  calculateHorizontalDistance (p0, p1) {
    try {
      // 使用EllipsoidGeodesic计算大地测量距离（椭球面距离）
      const carto0 = Cesium.Cartographic.fromDegrees(p0.longitude, p0.latitude)
      const carto1 = Cesium.Cartographic.fromDegrees(p1.longitude, p1.latitude)

      // 使用椭球面距离
      const geodesic = new Cesium.EllipsoidGeodesic(carto0, carto1)
      const distance = geodesic.surfaceDistance

      return distance
    } catch (error) {
      console.error('计算水平距离失败:', error)
      // 降级方案：使用Haversine公式
      return this.haversineDistance(p0.longitude, p0.latitude, p1.longitude, p1.latitude)
    }
  }

  /**
   * 使用Haversine公式计算距离（米）
   */
  haversineDistance (lon1, lat1, lon2, lat2) {
    try {
      const R = 6371000 // 地球半径（米）
      const dLat = (lat2 - lat1) * Math.PI / 180
      const dLon = (lon2 - lon1) * Math.PI / 180
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      const distance = R * c
      return distance
    } catch (error) {
      console.error('Haversine计算失败:', error)
      return 0
    }
  }

  /**
     * 获取坡度等级
     */
  getSlopeLevel (slope) {
    for (const level of this.slopeLevels) {
      if (slope >= level.min && slope < level.max) {
        return level
      }
    }
    return this.slopeLevels[this.slopeLevels.length - 1]
  }

  /**
     * 获取主要坡度等级（出现最多的等级）
     */
  getDominantLevel (slopeData) {
    const levelCounts = {}

    slopeData.forEach(point => {
      const levelName = point.level.name
      levelCounts[levelName] = (levelCounts[levelName] || 0) + 1
    })

    let maxCount = 0
    let dominantLevelName = null

    Object.keys(levelCounts).forEach(levelName => {
      if (levelCounts[levelName] > maxCount) {
        maxCount = levelCounts[levelName]
        dominantLevelName = levelName
      }
    })

    return this.slopeLevels.find(level => level.name === dominantLevelName) || this.slopeLevels[0]
  }

  /**
     * 创建坡度可视化（使用贴地面渲染）
     */
  async createSlopeVisualization (slopeData) {
    try {
      console.log(`开始创建 ${slopeData.length} 个坡度点的面可视化`)

      // 按坡度等级分组数据
      const levelGroups = this.groupSlopeDataByLevel(slopeData)

      // 为每个坡度等级创建面可视化
      for (const [levelName, points] of levelGroups) {
        if (points.length === 0) continue

        const level = this.slopeLevels.find(l => l.name === levelName)
        if (!level) continue

        console.log(`处理 ${levelName} 等级，共 ${points.length} 个点`)

        // 使用面渲染
        await this.createLevelPolygonSurface(points, level)
      }

      console.log(`成功创建 ${levelGroups.size} 个坡度等级的面可视化`)
    } catch (error) {
      console.error('创建坡度可视化失败:', error)
    }
  }

  /**
     * 按坡度等级分组数据
     */
  groupSlopeDataByLevel (slopeData) {
    const groups = new Map()

    slopeData.forEach(point => {
      const levelName = point.level.name
      if (!groups.has(levelName)) {
        groups.set(levelName, [])
      }
      groups.get(levelName).push(point)
    })

    return groups
  }

  /**
   * 创建三角网格线可视化（通过网格线颜色区分不同坡度）
   */
  async createSlopeTriangularGridLines (triangulation, boundaryPolygonCoords) {
    try {
      if (!triangulation) {
        console.warn('三角网格数据无效')
        return
      }

      const { triangles, validPoints, validHeights } = triangulation

      console.log('🎨 === 开始创建三角网格线可视化 ===')
      console.log(`三角形数量: ${triangles.length / 3}`)
      console.log(`有效点数: ${validPoints.length}`)
      console.log(`高度数据点: ${validHeights.length}`)

      // 如果已有统一primitive，先移除
      if (this._unifiedGridPrimitive) {
        try {
          this.viewer.scene.primitives.remove(this._unifiedGridPrimitive)
          if (this._unifiedGridPrimitive.destroy) this._unifiedGridPrimitive.destroy()
        } catch (e) {}
        this._unifiedGridPrimitive = null
      }

      // 单Primitive批量渲染：构建几何实例与颜色
      const geometryInstances = []

      // LOD：根据相机高度简化边渲染（远处仅渲染1条）
      let renderOneEdgeOnly = false
      if (this.config.enableLOD && this.viewer && this.viewer.camera && this.viewer.camera.positionCartographic) {
        try {
          const h = this.viewer.camera.positionCartographic.height
          renderOneEdgeOnly = h > (this.config.lodHeights && this.config.lodHeights.simple ? this.config.lodHeights.simple : 15000)
        } catch (e) {}
      }

      // 预备边界多边形（用于二次裁剪边）
      let boundaryPoly = null
      if (this.config.enforceEdgeClipping && Array.isArray(boundaryPolygonCoords) && boundaryPolygonCoords.length >= 3) {
        try { boundaryPoly = turf.polygon([boundaryPolygonCoords]) } catch (e) { boundaryPoly = null }
      }

      // 遍历每个三角形
      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i]
        const i1 = triangles[i + 1]
        const i2 = triangles[i + 2]

        const p0 = {
          longitude: validPoints[i0][0],
          latitude: validPoints[i0][1],
          height: validHeights[i0]
        }
        const p1 = {
          longitude: validPoints[i1][0],
          latitude: validPoints[i1][1],
          height: validHeights[i1]
        }
        const p2 = {
          longitude: validPoints[i2][0],
          latitude: validPoints[i2][1],
          height: validHeights[i2]
        }

        // 计算三角形坡度
        const slope = this.calculateTriangleSlope(p0, p1, p2)
        const colorCss = this.config.useGradientColor ? this.getSlopeColor(slope) : this.getSlopeLevel(slope).color

        const addEdge = (pa, pb) => {
          try {
            // 二次裁剪：将边与多边形边界求交并截断，仅保留面内部分
            if (boundaryPoly && this.config.enforceEdgeClipping) {
              const segments = this.clipLineToPolygon(pa, pb, boundaryPoly)
              if (!segments || segments.length === 0) return
              segments.forEach(seg => {
                if (!Array.isArray(seg) || seg.length < 2) return
                const flat = []
                for (let k = 0; k < seg.length; k++) {
                  flat.push(seg[k][0], seg[k][1])
                }
                const positions = Cesium.Cartesian3.fromDegreesArray(flat)
                const polylineGeometry = new Cesium.GroundPolylineGeometry({
                  positions: positions,
                  width: this.config.lineWidth || 1.0
                })
                const geometryInstance = new Cesium.GeometryInstance({
                  geometry: polylineGeometry,
                  attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                      Cesium.Color.fromCssColorString(colorCss).withAlpha(this.config.lineAlpha || 0.6)
                    )
                  }
                })
                geometryInstances.push(geometryInstance)
              })
              return
            }

            // 无需裁剪：直接绘制整条边
            const positions = Cesium.Cartesian3.fromDegreesArray([
              pa.longitude, pa.latitude,
              pb.longitude, pb.latitude
            ])
            const polylineGeometry = new Cesium.GroundPolylineGeometry({
              positions: positions,
              width: this.config.lineWidth || 1.0
            })
            const geometryInstance = new Cesium.GeometryInstance({
              geometry: polylineGeometry,
              attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                  Cesium.Color.fromCssColorString(colorCss).withAlpha(this.config.lineAlpha || 0.6)
                )
              }
            })
            geometryInstances.push(geometryInstance)
          } catch (e) {}
        }

        if (renderOneEdgeOnly) {
          addEdge(p0, p1)
        } else {
          addEdge(p0, p1)
          addEdge(p1, p2)
          addEdge(p2, p0)
        }
      }

      // 增量渲染，避免一次性创建过多导致卡顿
      const appearance = new Cesium.PolylineColorAppearance({ translucent: true })
      const batch = Math.max(1000, this.config.incrementalRenderBatchEdges || 2000)
      for (let i = 0; i < geometryInstances.length; i += batch) {
        const slice = geometryInstances.slice(i, i + batch)
        const primitive = new Cesium.GroundPolylinePrimitive({
          geometryInstances: slice,
          appearance: appearance,
          classificationType: Cesium.ClassificationType.BOTH
        })
        this._unifiedGridPrimitive = primitive // 记录最后一个，便于整体清理
        this.viewer.scene.primitives.add(primitive)
        // 将primitive添加到slopeEntities数组，确保后续可以被正确清除
        this.slopeEntities.push({
          type: 'primitive',
          primitive: primitive,
          level: { name: '网格线' }
        })
        // 让出主线程，保证UI可响应
        // eslint-disable-next-line no-await-in-loop
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      console.log('🎉 === 三角网格线可视化创建完成（统一Primitive批量渲染+增量） ===')
    } catch (error) {
      console.error('创建三角网格线失败:', error)
    }
  }

  /**
   * 颜色渐变：根据坡度值映射颜色（低到高：绿-黄-红）
   */
  getSlopeColor (slope) {
    try {
      const min = 0
      const max = 35 // 可按需调整最大梯度
      const t = Math.max(0, Math.min(1, (slope - min) / (max - min)))
      // 绿色(0,255,0) -> 黄色(255,255,0) -> 红色(255,0,0)
      let r = 0; let g = 0; let b = 0
      if (t < 0.5) {
        const k = t / 0.5 // 0..1
        r = Math.round(255 * k)
        g = 255
        b = 0
      } else {
        const k = (t - 0.5) / 0.5 // 0..1
        r = 255
        g = Math.round(255 * (1 - k))
        b = 0
      }
      return `rgb(${r},${g},${b})`
    } catch (e) {
      return '#FFFF00'
    }
  }

  /**
   * 计算自适应色带统计（分位数与均值/标准差）
   */
  computeAdaptiveScaleStats (values) {
    try {
      const arr = values.filter(v => isFinite(v)).slice().sort((a, b) => a - b)
      if (arr.length === 0) return null
      const q = (p) => {
        const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))
        return arr[idx]
      }
      const lowQ = this.config.colorQuantileLow || 0.05
      const highQ = this.config.colorQuantileHigh || 0.95
      const minV = q(lowQ)
      const maxV = q(highQ)
      let mean = 0
      for (let i = 0; i < arr.length; i++) mean += arr[i]
      mean /= arr.length
      let s2 = 0
      for (let i = 0; i < arr.length; i++) s2 += (arr[i] - mean) * (arr[i] - mean)
      const std = Math.sqrt(s2 / Math.max(1, arr.length - 1))
      return { minV, maxV, mean, std }
    } catch (e) {
      return null
    }
  }

  /**
   * 自适应渐变色（使用分位数窗口规范化）
   */
  getAdaptiveSlopeColor (slope, stats) {
    if (!stats) return this.getSlopeColor(slope)
    const min = stats.minV
    const max = Math.max(min + 1e-6, stats.maxV)
    const t = Math.max(0, Math.min(1, (slope - min) / (max - min)))
    // 复用 getSlopeColor 的绿-黄-红梯度逻辑
    const maxDeg = 35
    const slopeEquiv = t * maxDeg
    return this.getSlopeColor(slopeEquiv)
  }

  /**
   * 绑定相机距离驱动的点大小更新
   */
  bindPointSizeByDistance (collections, baseSize) {
    try {
      const minSize = this.config.minPointSize || 2
      const maxSize = this.config.maxPointSize || 8
      const camera = this.viewer && this.viewer.camera
      if (!camera) return
      let lastBucket = -1
      this._pointSizeUpdater && this.viewer.scene.postRender.removeEventListener(this._pointSizeUpdater)
      this._pointSizeUpdater = function () {
        try {
          const h = camera.positionCartographic ? camera.positionCartographic.height : 0
          // 简易映射：高度 2km-20km 区间从 maxSize 到 minSize
          const hMin = 2000
          const hMax = 20000
          const t = Math.max(0, Math.min(1, (h - hMin) / (hMax - hMin)))
          const size = Math.round((1 - t) * (maxSize - minSize) + minSize)
          const bucket = size
          if (bucket === lastBucket) return
          lastBucket = bucket
          for (let i = 0; i < collections.length; i++) {
            const coll = collections[i]
            const pts = coll && coll._pointPrimitives
            if (!pts) continue
            for (let j = 0; j < pts.length; j++) {
              pts[j].pixelSize = size
            }
          }
        } catch (e) {}
      }
      this.viewer.scene.postRender.addEventListener(this._pointSizeUpdater)
    } catch (e) {}
  }

  /**
   * 点模式：使用 PointPrimitiveCollection 可视化坡度点
   */
  async createSlopePointPrimitives (slopeData) {
    try {
      if (!Array.isArray(slopeData) || slopeData.length === 0) return
      const alpha = this.config.pointsAlpha || 0.8
      const baseSize = this.config.pointSize || 4
      const batchSize = Math.max(500, this.config.pointBatchSize || 2000)
      const groupByLevel = !!this.config.pointGroupByLevel
      const useAdaptive = !!this.config.adaptiveColorScale && !!this.config.useGradientColor
      const depthDist = (typeof this.config.depthTestDistance === 'number') ? this.config.depthTestDistance : Number.POSITIVE_INFINITY

      // 统计用于自适应色带
      let colorStats = null
      if (useAdaptive) {
        colorStats = this.computeAdaptiveScaleStats(slopeData.map(p => p.slope))
      }

      const addPointsBatched = async (collection, points) => {
        for (let i = 0; i < points.length; i += batchSize) {
          const chunk = points.slice(i, Math.min(i + batchSize, points.length))
          for (let k = 0; k < chunk.length; k++) {
            const p = chunk[k]
            const colorCss = this.config.useGradientColor
              ? (useAdaptive ? this.getAdaptiveSlopeColor(p.slope, colorStats) : this.getSlopeColor(p.slope))
              : (p.level && p.level.color ? p.level.color : '#FFFF00')
            const color = Cesium.Color.fromCssColorString(colorCss).withAlpha(alpha)
            const position = Cesium.Cartesian3.fromDegrees(p.point.longitude, p.point.latitude, p.height || 0)
            collection.add({ position, color, pixelSize: baseSize, disableDepthTestDistance: depthDist })
          }
          // 让出主线程
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }

      const collections = []
      if (groupByLevel) {
        const groups = new Map()
        slopeData.forEach(p => {
          const key = p.level && p.level.name ? p.level.name : '未分级'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(p)
        })
        const tasks = []
        groups.forEach((points, name) => {
          const coll = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.ALPHA_BLEND })
          this.viewer.scene.primitives.add(coll)
          this.slopeEntities.push({ type: 'primitive', primitive: coll, level: { name: `点-${name}` } })
          collections.push(coll)
          tasks.push(addPointsBatched(coll, points))
        })
        // 顺序执行，保证稳定
        for (const t of tasks) { // eslint-disable-line no-restricted-syntax
          // eslint-disable-next-line no-await-in-loop
          await t
        }
      } else {
        const collection = new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.ALPHA_BLEND })
        this.viewer.scene.primitives.add(collection)
        this.slopeEntities.push({ type: 'primitive', primitive: collection, level: { name: '坡度点' } })
        collections.push(collection)
        await addPointsBatched(collection, slopeData)
      }

      // 点大小随距离衰减（可选）
      if (this.config.sizeByDistance) {
        this.bindPointSizeByDistance(collections, baseSize)
      }
    } catch (e) {
      console.error('创建坡度点可视化失败:', e)
    }
  }

  /**
   * 将线段裁剪到多边形：返回在面内的子线段数组（每个为坐标数组）
   */
  clipLineToPolygon (pa, pb, polygon) {
    try {
      const line = turf.lineString([[pa.longitude, pa.latitude], [pb.longitude, pb.latitude]])
      const boundary = turf.polygonToLine(polygon)
      // 按边界拆分线段，得到若干子段
      let splitted = null
      try {
        splitted = turf.lineSplit(line, boundary)
      } catch (e) {
        // 无法拆分时，退化为原始线
        splitted = { type: 'FeatureCollection', features: [line] }
      }

      const kept = []
      const feats = (splitted && splitted.features) ? splitted.features : []
      if (feats.length === 0) {
        // 没有拆分结果，判断整条线是否在面内/相交
        const mid = turf.along(line, turf.length(line, { units: 'kilometers' }) / 2, { units: 'kilometers' })
        if (turf.booleanPointInPolygon(mid, polygon) || turf.booleanIntersects(line, polygon)) {
          kept.push(line.geometry.coordinates)
        }
        return kept
      }

      for (const f of feats) {
        if (!f || !f.geometry || f.geometry.type !== 'LineString') continue
        const seg = f
        const segLen = turf.length(seg, { units: 'kilometers' })
        const mid = turf.along(seg, segLen / 2, { units: 'kilometers' })
        if (turf.booleanPointInPolygon(mid, polygon)) {
          kept.push(seg.geometry.coordinates)
        }
      }

      return kept
    } catch (e) {
      return []
    }
  }

  /**
   * 允许外部设置自定义坡度等级
   */
  setSlopeLevels (levels) {
    if (Array.isArray(levels) && levels.length > 0) {
      this.slopeLevels = levels
    }
  }

  /**
   * 为某个坡度等级创建网格线（使用GroundPolylinePrimitive）
   */
  createLevelGridLines (edges, level) {
    try {
      console.log(`📐 开始创建 ${level.name} 网格线，共 ${edges.length} 条边，颜色: ${level.color}`)

      const geometryInstances = []

      // 为每条边创建几何体实例
      edges.forEach((edge) => {
        const p0 = edge[0]
        const p1 = edge[1]

        // 验证点数据有效性
        if (!p0 || !p1 ||
            !p0.longitude || !p0.latitude || !p0.height ||
            !p1.longitude || !p1.latitude || !p1.height) {
          console.warn('无效的边缘点，跳过')
          return
        }

        try {
          // // 使用Cartographic格式创建位置（GroundPolylinePrimitive需要）
          // const position0 = Cesium.Cartographic.fromDegrees(p0.longitude, p0.latitude, p0.height)
          // const position1 = Cesium.Cartographic.fromDegrees(p1.longitude, p1.latitude, p1.height)

          // // 验证转换结果
          // if (!position0 || !position1 || isNaN(position0.longitude) || isNaN(position1.longitude)) {
          //   console.warn('坐标转换失败，跳过')
          //   return
          // }
          // const positions = [position0, position1]

          const positions = Cesium.Cartesian3.fromDegreesArray([
            p0.longitude, p0.latitude,
            p1.longitude, p1.latitude
          ])

          // 创建GroundPolylineGeometry（GroundPolylinePrimitive专用）
          const polylineGeometry = new Cesium.GroundPolylineGeometry({
            positions: positions,
            width: 1.0
          })

          // 创建几何体实例
          const geometryInstance = new Cesium.GeometryInstance({
            geometry: polylineGeometry,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(level.color).withAlpha(0.6)
              )
            }
          })

          geometryInstances.push(geometryInstance)
        } catch (error) {
          console.warn('创建网格线几何体失败:', error)
        }
      })

      // 使用GroundPolylinePrimitive批量渲染
      if (geometryInstances.length > 0) {
        try {
          const appearance = new Cesium.PolylineColorAppearance({
            translucent: true
          })

          // 创建primitive
          const primitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: geometryInstances,
            appearance: appearance,
            classificationType: Cesium.ClassificationType.BOTH
          })

          this.viewer.scene.primitives.add(primitive)

          // 保存引用
          this.slopeEntities.push({
            type: 'primitive',
            primitive: primitive,
            level: level
          })

          console.log(`✓ 成功创建 ${geometryInstances.length} 条 ${level.name} 网格线`)
          console.log(`  颜色: ${level.color}, 透明度: 0.6, 宽度: 1.0px`)
        } catch (error) {
          console.error('❌ 创建GroundPolylinePrimitive失败:', error)
          console.error('geometryInstances数量:', geometryInstances.length)
          // 打印第一个实例的信息用于调试
          if (geometryInstances.length > 0) {
            console.error('第一个几何实例:', geometryInstances[0])
          }
        }
      } else {
        console.warn(`⚠ 没有有效的几何实例（${level.name}）`)
      }
    } catch (error) {
      console.error('创建等级网格线失败:', error)
    }
  }

  /**
     * 转换坐标到Cesium位置
     */
  convertCoordsToPositions (coords) {
    const positions = []

    for (const coord of coords) {
      if (Array.isArray(coord) && coord.length >= 2) {
        try {
          const position = Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0)
          if (position && position.x !== undefined && position.y !== undefined && position.z !== undefined) {
            positions.push(position)
          }
        } catch (error) {
          console.warn('坐标转换失败:', coord, error)
        }
      }
    }

    return positions
  }

  /**
   * 获取地形高度并调整多边形顶点高度
   */
  async adjustPolygonHeightsToTerrain (positions) {
    try {
      if (!this.viewer.terrainProvider ||
          this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
        return positions // 如果没有地形服务，直接返回原位置
      }

      // 将位置转换为Cartographic
      const cartographicPositions = positions.map(pos =>
        Cesium.Cartographic.fromCartesian(pos)
      )

      // 获取地形高度
      const updatedPositions = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        cartographicPositions
      )

      // 转换回Cartesian3
      return updatedPositions.map(cartographic =>
        Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height)
      )
    } catch (error) {
      console.warn('调整多边形高度失败，使用原始位置:', error)
      return positions
    }
  }

  /**
   * 生成坡度等级描述
   */
  generateLevelDescription (level, points) {
    const avgSlope = points.reduce((sum, point) => sum + point.slope, 0) / points.length
    const minSlope = Math.min(...points.map(p => p.slope))
    const maxSlope = Math.max(...points.map(p => p.slope))

    return `
      <div style="padding: 10px; max-width: 300px;">
        <h4 style="margin-top: 0;">${level.name}</h4>
        <p><strong>坡度范围：</strong>${level.description}</p>
        <p><strong>平均坡度：</strong>${avgSlope.toFixed(2)}°</p>
        <p><strong>最小坡度：</strong>${minSlope.toFixed(2)}°</p>
        <p><strong>最大坡度：</strong>${maxSlope.toFixed(2)}°</p>
        <p><strong>采样点数：</strong>${points.length}</p>
        <div style="margin-top: 10px; display: flex; align-items: center;">
          <span style="display: inline-block; width: 20px; height: 20px; background-color: ${level.color}; margin-right: 8px; border-radius: 3px;"></span>
          <span>${level.name}</span>
        </div>
      </div>
    `
  }

  /**
   * 创建坡度等级多边形面（贴地渲染）
   */
  async createLevelPolygonSurface (points, level) {
    try {
      if (points.length < 3) return

      console.log(`为 ${level.name} 创建 ${points.length} 个点的贴地多边形面`)

      // GroundPrimitive会自动采样地形，无需手动获取高度
      this.createTriangularMeshSurface(points, level)
    } catch (error) {
      console.error('创建多边形面可视化失败:', error)
    }
  }

  /**
   * 创建三角网格面覆盖（使用GroundPrimitive自动贴地）
   */
  createTriangularMeshSurface (points, level) {
    try {
      if (points.length < 3) return

      console.log(`为 ${level.name} 创建三角网格，共 ${points.length} 个点`)

      // 创建Delaunay三角剖分（GroundPrimitive只需要经纬度）
      const triangulatedPoints = points.map((pointData) => [
        pointData.point.longitude,
        pointData.point.latitude
      ])

      const delaunay = Delaunator.from(triangulatedPoints.map(p => [p[0], p[1]]))
      const triangles = delaunay.triangles

      console.log(`生成了 ${triangles.length / 3} 个三角形`)

      // GroundPrimitive需要为每个三角形创建单独的多边形
      // 收集所有三角形的几何体实例（填充面）
      const geometryInstances = []
      const color = Cesium.Color.fromCssColorString(level.color).withAlpha(0.8)
      const triangleCount = triangles.length / 3

      for (let i = 0; i < triangles.length; i += 3) {
        const i0 = triangles[i]
        const i1 = triangles[i + 1]
        const i2 = triangles[i + 2]

        const p0 = triangulatedPoints[i0]
        const p1 = triangulatedPoints[i1]
        const p2 = triangulatedPoints[i2]

        // 创建三角形的三个顶点（只使用经纬度，高度由GroundPrimitive自动采样）
        const positions = [
          Cesium.Cartesian3.fromDegrees(p0[0], p0[1]),
          Cesium.Cartesian3.fromDegrees(p1[0], p1[1]),
          Cesium.Cartesian3.fromDegrees(p2[0], p2[1])
        ]

        // 创建多边形几何体（填充面）
        const polygonGeometry = new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(positions),
          height: 0,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
        })

        // 创建几何体实例
        const geometryInstance = new Cesium.GeometryInstance({
          geometry: polygonGeometry,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
          }
        })

        geometryInstances.push(geometryInstance)

        // 暂时不创建轮廓线，避免错误
        // 如需显示网格线，可以后续优化
      }

      // 创建填充面的外观
      const appearance = new Cesium.PerInstanceColorAppearance({
        translucent: true,
        closed: true
      })

      // 创建GroundPrimitive（自动贴地）用于填充
      const primitive = new Cesium.GroundPrimitive({
        geometryInstances: geometryInstances,
        appearance: appearance,
        classificationType: Cesium.ClassificationType.BOTH
      })

      // 将primitive添加到场景中
      this.viewer.scene.primitives.add(primitive)

      // 保存引用以便后续清除
      this.slopeEntities.push({
        type: 'primitive',
        primitive: primitive,
        level: level,
        points: points
      })

      console.log(`成功创建 ${level.name} 的GroundPrimitive，包含 ${triangleCount} 个三角形`)
    } catch (error) {
      console.error('创建三角网格面失败:', error)
    }
  }

  /**
     * 创建分析边界
     */
  async createAnalysisBoundary (polygonCoords) {
    try {
      let positions = this.convertCoordsToPositions(polygonCoords)
      if (positions.length < 3) return

      // 调整多边形顶点高度以贴合地形
      positions = await this.adjustPolygonHeightsToTerrain(positions)

      this.analysisBoundary = this.viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          // 优化边界材质，使其更清晰地贴地显示
          material: Cesium.Color.YELLOW.withAlpha(0.6),
          outline: true,
          outlineColor: Cesium.Color.YELLOW.withAlpha(0.8),
          outlineWidth: 3,
          // 确保边界完全贴地
          height: 0,
          extrudedHeight: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          extrudedHeightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          // 启用位置高度，确保边界跟随地形
          perPositionHeight: true
        }
      })
    } catch (error) {
      console.error('创建分析边界失败:', error)
    }
  }

  /**
   * 修复几何数据，确保多边形有效
   */
  fixGeometry (geometry) {
    if (!geometry || !geometry.coordinates) {
      return null
    }

    try {
      if (geometry.type === 'Polygon') {
        const fixedCoords = []

        for (const ring of geometry.coordinates) {
          if (!Array.isArray(ring) || ring.length < 3) {
            continue
          }

          // 确保环闭合
          const fixedRing = [...ring]

          // 移除重复的连续点
          const cleanedRing = []
          for (let i = 0; i < fixedRing.length; i++) {
            const current = fixedRing[i]
            const next = fixedRing[(i + 1) % fixedRing.length]
            if (current[0] !== next[0] || current[1] !== next[1]) {
              cleanedRing.push([...current])
            }
          }

          // 确保至少有3个不同的点
          if (cleanedRing.length < 3) {
            console.warn('环的点数不足，跳过')
            continue
          }

          // 确保环闭合
          if (cleanedRing.length < 4) {
            // 如果点太少，复制第一个点来闭合
            cleanedRing.push([...cleanedRing[0]])
          } else {
            // 检查是否已经闭合
            const first = cleanedRing[0]
            const last = cleanedRing[cleanedRing.length - 1]
            if (first[0] !== last[0] || first[1] !== last[1]) {
              cleanedRing.push([...first])
            }
          }

          // 最终验证：确保至少有4个点
          if (cleanedRing.length >= 4) {
            fixedCoords.push(cleanedRing)
          }
        }

        if (fixedCoords.length === 0) {
          return null
        }

        return {
          type: 'Polygon',
          coordinates: fixedCoords
        }
      }

      if (geometry.type === 'MultiPolygon') {
        const fixedCoords = []

        for (const polygon of geometry.coordinates) {
          if (!Array.isArray(polygon) || polygon.length === 0) {
            continue
          }

          const fixedPolygon = []
          for (const ring of polygon) {
            if (!Array.isArray(ring) || ring.length < 3) {
              continue
            }

            // 移除重复的连续点
            const cleanedRing = []
            for (let i = 0; i < ring.length; i++) {
              const current = ring[i]
              const next = ring[(i + 1) % ring.length]
              if (current[0] !== next[0] || current[1] !== next[1]) {
                cleanedRing.push([...current])
              }
            }

            // 确保至少有3个不同的点
            if (cleanedRing.length < 3) {
              console.warn('环的点数不足，跳过')
              continue
            }

            // 确保环闭合
            if (cleanedRing.length < 4) {
              cleanedRing.push([...cleanedRing[0]])
            } else {
              const first = cleanedRing[0]
              const last = cleanedRing[cleanedRing.length - 1]
              if (first[0] !== last[0] || first[1] !== last[1]) {
                cleanedRing.push([...first])
              }
            }

            // 最终验证：确保至少有4个点
            if (cleanedRing.length >= 4) {
              fixedPolygon.push(cleanedRing)
            }
          }

          if (fixedPolygon.length > 0) {
            fixedCoords.push(fixedPolygon)
          }
        }

        if (fixedCoords.length === 0) {
          return null
        }

        return {
          type: 'MultiPolygon',
          coordinates: fixedCoords
        }
      }

      return geometry
    } catch (error) {
      console.warn('修复几何数据失败:', error)
      return null
    }
  }

  /**
     * 计算统计信息（旧方法，按点统计）
     */
  calculateStatistics (slopeData) {
    const stats = {
      totalPoints: slopeData.length,
      levelStats: {},
      averageSlope: 0
    }

    this.slopeLevels.forEach(level => {
      stats.levelStats[level.name] = {
        count: 0,
        percentage: 0,
        color: level.color
      }
    })

    slopeData.forEach(point => {
      const levelName = point.level.name
      if (stats.levelStats[levelName]) {
        stats.levelStats[levelName].count++
      }
    })

    Object.keys(stats.levelStats).forEach(levelName => {
      const levelStat = stats.levelStats[levelName]
      levelStat.percentage = ((levelStat.count / stats.totalPoints) * 100).toFixed(2)
    })

    const totalSlope = slopeData.reduce((sum, point) => sum + point.slope, 0)
    stats.averageSlope = (totalSlope / stats.totalPoints).toFixed(2)

    return stats
  }

  /**
     * 清除分析结果
     */
  clearAnalysis () {
    try {
      // 清除所有实体和Primitives
      if (this.viewer) {
        // 解绑点大小更新器
        if (this._pointSizeUpdater && this.viewer.scene && this.viewer.scene.postRender) {
          try { this.viewer.scene.postRender.removeEventListener(this._pointSizeUpdater) } catch (e) {}
          this._pointSizeUpdater = null
        }
        // 清除分析实体和Primitives
        this.slopeEntities.forEach(item => {
          try {
            if (item.type === 'primitive' && item.primitive) {
              // 清除Primitive
              this.viewer.scene.primitives.remove(item.primitive)
              // 销毁primitive以释放资源
              if (item.primitive.destroy) {
                item.primitive.destroy()
              }
            } else if (item.type === 'entity' && item.entity && this.viewer.entities) {
              // 清除Entity
              this.viewer.entities.remove(item.entity)
            } else if (this.viewer.entities && typeof item.constructor === 'function' && item.constructor.name === 'Entity') {
              // 兼容旧代码（直接是Entity的情况）
              this.viewer.entities.remove(item)
            }
          } catch (error) {
            console.warn('移除可视化对象失败:', error)
          }
        })

        // 清除边界实体
        if (this.analysisBoundary && this.viewer.entities) {
          try {
            this.viewer.entities.remove(this.analysisBoundary)
          } catch (error) {
            console.warn('移除边界实体失败:', error)
          }
          this.analysisBoundary = null
        }
      }

      // 重置数组（使用length=0更高效地释放内存）
      this.slopeEntities.length = 0
    } catch (error) {
      console.error('清除分析结果失败:', error)
    }
  }

  /**
     * 取消分析
     */
  cancelAnalysis () {
    this.isCancelled = true
    console.log('分析已取消')
  }

  /**
     * 检查是否正在分析
     */
  isAnalysisRunning () {
    return this.isAnalyzing
  }

  /**
     * 分析耕地坡度（使用analyzeSlope方法）
     */
  async analyzeFarmlandSlope (analysisPolygon, farmlandData, _callback, progressCallback = null) {
    try {
      this.isAnalyzing = true
      this.clearAnalysis()
      this.isCancelled = false
      this.progressCallback = progressCallback

      // 初始化进度
      if (this.progressCallback) {
        this.progressCallback({
          progress: 0,
          message: '开始分析'
        })
      }

      const farmlandResults = []

      if (farmlandData && farmlandData.features && farmlandData.features.length > 0) {
        console.log(`开始分析 ${farmlandData.features.length} 个耕地地块`)

        if (this.progressCallback) {
          this.progressCallback({
            progress: 5,
            message: `开始分析 ${farmlandData.features.length} 个耕地地块`
          })
        }

        for (let i = 0; i < farmlandData.features.length; i++) {
          if (this.isCancelled) {
            console.log('分析已取消')
            if (_callback) {
              _callback({
                success: false,
                message: '分析已取消'
              })
            }
            return
          }

          const feature = farmlandData.features[i]

          // 检查几何数据有效性
          if (!this.isValidGeometry(feature.geometry)) {
            console.warn('跳过无效几何数据')
            continue
          }

          // 预处理多面几何数据，分割成单面
          const singlePolygons = this.preprocessMultiPolygonGeometry(feature.geometry)

          if (singlePolygons.length === 0) {
            console.warn('耕地无有效面，跳过')
            continue
          }

          // 检查是否与分析区域相交
          const analysisTurfPolygon = turf.polygon([analysisPolygon])
          let hasValidIntersection = false

          for (const polygonCoords of singlePolygons) {
            const turfPolygon = turf.polygon([polygonCoords])
            if (turf.booleanIntersects(turfPolygon, analysisTurfPolygon)) {
              hasValidIntersection = true
              break
            }
          }

          if (!hasValidIntersection) {
            console.warn('耕地不在分析区域内，跳过')
            continue
          }

          // 对每个单面进行坡度分析
          let farmlandSlopeData = []
          let totalSamplePoints = 0
          let totalArea = 0

          for (const polygonCoords of singlePolygons) {
            // 调用 analyzeSlope 进行分析
            const slopeResult = await this.analyzeSlopeForFarmland(polygonCoords)

            if (slopeResult && slopeResult.success && slopeResult.data.length > 0) {
              const farmlandData = slopeResult.data[0]
              farmlandSlopeData = farmlandSlopeData.concat(farmlandData.slopeData)
              totalSamplePoints += farmlandData.samplePointsCount
              totalArea += farmlandData.area
            }
          }

          if (farmlandSlopeData.length > 0) {
            // 计算整个耕地的平均坡度和主要等级
            const avgSlope = farmlandSlopeData.reduce((sum, p) => sum + p.slope, 0) / farmlandSlopeData.length
            const dominantLevel = this.getDominantLevel(farmlandSlopeData)

            const farmlandResult = {
              geometry: feature.geometry,
              properties: feature.properties || {},
              area: totalArea,
              slopeData: farmlandSlopeData,
              averageSlope: avgSlope,
              dominantLevel: dominantLevel,
              samplePointsCount: totalSamplePoints,
              polygonCount: singlePolygons.length
            }
            farmlandResults.push(farmlandResult)

            // 注：visualization 已经由 createSlopeTriangularGridLines 创建了网格线
            // this.createSingleFarmlandVisualization(farmlandResult)
          }

          // 短暂延迟，让UI有机会响应
          if (i % 5 === 0) {
            await new Promise(resolve => setTimeout(resolve, 10))
          }

          if (this.progressCallback) {
            const progress = Math.min(5 + ((i + 1) / farmlandData.features.length) * 90, 95)
            this.progressCallback({
              progress: Math.round(progress),
              message: `已分析 ${i + 1}/${farmlandData.features.length} 个耕地地块`
            })
          }
        }
      }

      if (farmlandResults.length === 0) {
        console.warn('未获取到坡度数据')
        _callback && _callback({
          success: false,
          message: '未获取到坡度数据'
        })
        return
      }

      // 统计所有坡度点
      let totalPoints = 0
      farmlandResults.forEach(result => {
        totalPoints += result.slopeData.length
      })

      if (this.progressCallback) {
        this.progressCallback({
          progress: 95,
          message: '生成统计结果中...'
        })
      }

      console.log(`坡度分析完成，共分析 ${farmlandResults.length} 个地块，${totalPoints} 个坡度点`)

      if (this.progressCallback) {
        this.progressCallback({
          progress: 100,
          message: `分析完成，共分析 ${farmlandResults.length} 个地块`
        })
      }

      _callback && _callback({
        success: true,
        data: farmlandResults,
        farmlandCount: farmlandResults.length,
        totalPoints: totalPoints,
        statistics: this.calculateFarmlandStatistics(farmlandResults),
        levels: this.slopeLevels
      })
    } catch (error) {
      console.error('坡度分析失败:', error)
      this.clearAnalysis()
      _callback && _callback({
        success: false,
        error: error.message,
        message: this.isCancelled ? '分析已取消' : '分析失败'
      })
    } finally {
      this.isAnalyzing = false
    }
  }

  /**
     * 使用analyzeSlope分析单个耕地面
     */
  async analyzeSlopeForFarmland (farmlandCoords) {
    try {
      // 步骤1: 预处理分析区域
      const processedPolygon = this.preprocessAnalysisArea(farmlandCoords)
      if (!processedPolygon) {
        return { success: false, message: '分析区域预处理失败' }
      }

      // 步骤2: 生成采样点网格
      const samplePoints = await this.generateAdaptiveSampleGrid(processedPolygon)

      // 步骤3: 批量获取高程
      const heights = await this.getTerrainHeightsBatch(samplePoints)

      // 步骤4: 生成Delaunay三角网
      let triangulation = this.buildDelaunayTriangulation(samplePoints, heights)
      // 边界裁剪
      triangulation = this.clipTriangulationToPolygon(triangulation, processedPolygon)

      // 步骤5: 计算每个三角形的坡度
      const slopeData = this.calculateTrianglesSlope(triangulation)

      if (slopeData.length === 0) {
        return { success: false, message: '未获取到坡度数据' }
      }

      // 步骤6: 坡度分级和可视化
      // 可视化（或填充面）
      if ((this.config.visualizeMode || 'grid') === 'points') {
        await this.createSlopePointPrimitives(slopeData)
      } else {
        await this.createSlopeTriangularGridLines(triangulation, processedPolygon)
      }

      // 计算统计信息
      const statistics = this.calculateStatistics(slopeData)

      return {
        success: true,
        data: [{
          geometry: {
            type: 'Polygon',
            coordinates: [processedPolygon]
          },
          properties: {},
          area: turf.area(turf.polygon([processedPolygon])),
          slopeData: slopeData,
          averageSlope: slopeData.reduce((sum, p) => sum + p.slope, 0) / slopeData.length,
          dominantLevel: this.getDominantLevel(slopeData),
          samplePointsCount: samplePoints.length
        }],
        totalPoints: slopeData.length,
        statistics: statistics,
        levels: this.slopeLevels
      }
    } catch (error) {
      console.error('分析耕地面失败:', error)
      return { success: false, error: error.message }
    }
  }

  /**
     * 验证几何数据
     */
  isValidGeometry (geometry) {
    if (!geometry || !geometry.coordinates || !Array.isArray(geometry.coordinates)) {
      return false
    }

    if (geometry.type === 'Polygon') {
      return geometry.coordinates.length > 0 && geometry.coordinates[0].length >= 4
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.length > 0 && geometry.coordinates[0].length > 0
    }

    return false
  }

  /**
     * 创建单个耕地地块的可视化
     */
  createSingleFarmlandVisualization (farmland) {
    try {
      if (!farmland || !farmland.geometry || !farmland.dominantLevel || !farmland.slopeData) {
        console.warn('地块数据不完整，跳过可视化')
        return
      }

      const geometry = farmland.geometry
      const level = farmland.dominantLevel

      // 将几何坐标转换为Cesium位置
      let positions = []
      const holes = []

      if (geometry.type === 'Polygon') {
        positions = this.convertCoordsToPositions(geometry.coordinates[0])
        for (let i = 1; i < geometry.coordinates.length; i++) {
          const holePositions = this.convertCoordsToPositions(geometry.coordinates[i])
          if (holePositions.length >= 3) {
            holes.push(holePositions)
          }
        }
      } else if (geometry.type === 'MultiPolygon') {
        if (geometry.coordinates[0] && geometry.coordinates[0][0]) {
          positions = this.convertCoordsToPositions(geometry.coordinates[0][0])
          for (let i = 1; i < geometry.coordinates[0].length; i++) {
            const holePositions = this.convertCoordsToPositions(geometry.coordinates[0][i])
            if (holePositions.length >= 3) {
              holes.push(holePositions)
            }
          }
        }
      }

      if (positions.length < 3) {
        console.warn('地块坐标点不足，跳过可视化')
        return
      }

      // 创建多边形层次结构
      const hierarchy = new Cesium.PolygonHierarchy(positions, holes)

      // 创建多边形实体
      const entity = this.viewer.entities.add({
        polygon: {
          hierarchy: hierarchy,
          material: Cesium.Color.fromCssColorString(level.color).withAlpha(0.7),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(level.color),
          outlineWidth: 2,
          height: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
        }
      })

      this.slopeEntities.push({
        type: 'entity',
        entity: entity
      })
    } catch (error) {
      console.error('创建单个地块可视化失败:', error)
    }
  }

  /**
     * 计算耕地统计信息（按地块统计）
     */
  calculateFarmlandStatistics (farmlandResults) {
    const stats = {
      totalFarmlands: farmlandResults.length,
      totalArea: 0,
      totalPoints: 0,
      levelStats: {},
      averageSlope: 0
    }

    // 初始化等级统计
    this.slopeLevels.forEach(level => {
      stats.levelStats[level.name] = {
        count: 0,
        area: 0,
        percentage: 0,
        areaPercentage: 0,
        color: level.color
      }
    })

    let totalSlope = 0
    farmlandResults.forEach(farmland => {
      stats.totalArea += farmland.area
      stats.totalPoints += farmland.slopeData.length
      totalSlope += farmland.averageSlope * farmland.area

      const levelName = farmland.dominantLevel.name
      if (stats.levelStats[levelName]) {
        stats.levelStats[levelName].count++
        stats.levelStats[levelName].area += farmland.area
      }
    })

    // 计算百分比
    Object.keys(stats.levelStats).forEach(levelName => {
      const levelStat = stats.levelStats[levelName]
      levelStat.percentage = ((levelStat.count / stats.totalFarmlands) * 100).toFixed(2)
      levelStat.areaPercentage = ((levelStat.area / stats.totalArea) * 100).toFixed(2)
    })

    // 计算加权平均坡度
    stats.averageSlope = (totalSlope / stats.totalArea).toFixed(2)

    return stats
  }

  /**
     * 销毁工具
     */
  destroy () {
    try {
      // 确保在销毁前停止任何正在进行的分析
      this.cancelAnalysis()

      // 清除所有分析结果和可视化
      this.clearAnalysis()

      // 释放引用，帮助垃圾回收
      this.viewer = null
      this.options = null
      this.slopeLevels = null
      this.progressCallback = null

      console.log('LandSlopeAnalysisTool 已销毁')
    } catch (error) {
      console.error('销毁分析工具失败:', error)
    }
  }
}
