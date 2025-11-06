// 坡度分析工具
// 项目中使用CDN方式引入turf库，直接使用全局变量turf
// import * as turf from '@turf/turf'
// import Delaunator from 'delaunator' - 已通过HTML中的script标签引入

// 使用已通过HTML中的<script src="libs/delaunator.min.js"></script>引入的全局Delaunator对象

export default class slopeAnalysisTool {
  constructor (viewer, options = {}) {
    this.viewer = viewer
    this.options = options
    this.slopeEntities = []
    this.analysisBoundary = null
    this.isCancelled = false
    this.progressCallback = null
    this.isAnalyzing = false

    // 坡度分级配置（优化颜色，更接近三角网格效果）
    this.slopeLevels = [{
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

    // 性能配置
    this.maxSamplePoints = 5000 // 增加最大采样点数，确保点云覆盖完整
    this.minSamplePoints = 50 // 增加最小采样点数
    this.sampleDistance = 0.003 // 进一步增加采样密度
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
      const triangulation = this.buildDelaunayTriangulation(samplePoints, heights)

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

      // 使用网格线模式
      this.createSlopeTriangularGridLines(triangulation)

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

      // 使用turf生成规则网格点
      const gridPoints = turf.pointGrid(bbox, sampleDensity, {
        units: 'kilometers',
        mask: turfPolygon
      })

      let samplePoints = gridPoints.features.map(feature => ({
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1]
      }))

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
      return samplePoints
    } catch (error) {
      console.error('生成采样点失败:', error)
      return []
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

      const cartographicPoints = samplePoints.map(point =>
        Cesium.Cartographic.fromDegrees(point.longitude, point.latitude)
      )

      // 批量获取地形高度
      const updatedPoints = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        cartographicPoints
      )

      const heights = updatedPoints.map(point => {
        if (point && typeof point.height === 'number' && isFinite(point.height)) {
          return point.height
        }
        return 0
      })

      console.log(`获取到 ${heights.length} 个有效高度值`)
      return heights
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

      // 构建Delaunay三角网（使用全局Delaunator对象）
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

      const { triangles, validPoints, validHeights, samplePoints } = triangulation
      const slopeData = []
      const pointSlopes = new Map()

      // 遍历所有三角形
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

        // 为每个顶点记录坡度
        const points = [p0, p1, p2]
        points.forEach(point => {
          const pointKey = `${point.longitude},${point.latitude}`
          if (!pointSlopes.has(pointKey)) {
            pointSlopes.set(pointKey, [])
          }
          pointSlopes.get(pointKey).push(slope)
        })
      }

      // 对每个点的多个坡度值取平均
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
          height = validHeights[pointIndex]
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
    try {
      if (!this.viewer.terrainProvider ||
                this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
        console.warn('地形服务不可用，使用模拟高度')
        return this.generateSimulatedHeights(samplePoints)
      }

      const cartographicPoints = samplePoints.map(point =>
        Cesium.Cartographic.fromDegrees(point.longitude, point.latitude)
      )

      const updatedPoints = await Cesium.sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        cartographicPoints
      )

      const heights = updatedPoints.map(point => {
        if (point && typeof point.height === 'number' && isFinite(point.height)) {
          return point.height
        }
        return 0
      })

      console.log(`获取到 ${heights.length} 个有效高度值`)
      return heights
    } catch (error) {
      console.error('获取地形高度失败:', error)
      return this.generateSimulatedHeights(samplePoints)
    }
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

      // 构建Delaunay三角网（使用全局Delaunator对象）
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
  createSlopeTriangularGridLines (triangulation) {
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

      // 按坡度等级分组线条
      const linesByLevel = new Map()

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
        const level = this.getSlopeLevel(slope)

        // 创建三角形的3条边
        const edges = [
          [p0, p1], // 边1
          [p1, p2], // 边2
          [p2, p0] // 边3
        ]

        if (!linesByLevel.has(level.name)) {
          linesByLevel.set(level.name, [])
        }

        // 将3条边添加到对应等级
        edges.forEach(edge => {
          linesByLevel.get(level.name).push(edge)
        })
      }

      console.log(`✓ 生成了 ${linesByLevel.size} 个不同等级的网格线分组`)

      // 输出每个等级的统计
      linesByLevel.forEach((edges, levelName) => {
        console.log(`  - ${levelName}: ${edges.length} 条边`)
      })

      // 为每个坡度等级创建线条
      for (const [levelName, edges] of linesByLevel) {
        if (edges.length === 0) continue

        const level = this.slopeLevels.find(l => l.name === levelName)
        if (!level) continue

        console.log(`创建 ${levelName} 等级的网格线，共 ${edges.length} 条边`)

        // 创建该等级的所有线段
        this.createLevelGridLines(edges, level)
      }

      console.log('🎉 === 三角网格线可视化创建完成 ===')
      console.log(`共创建 ${this.slopeEntities.length} 个Primitive对象`)
    } catch (error) {
      console.error('创建三角网格线失败:', error)
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

      // 使用全局Delaunator对象
      const delaunay = Delaunator.from(triangulatedPoints)
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
            } else if (this.viewer.entities) {
              // 清除Entity
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

      console.log('slopeAnalysisTool 已销毁')
    } catch (error) {
      console.error('销毁分析工具失败:', error)
    }
  }
}
