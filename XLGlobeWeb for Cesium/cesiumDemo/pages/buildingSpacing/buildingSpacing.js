/**
 * 建筑间距的工具类，支持前后/左右方向判断和差异化配色
 */
class BuildingDistanceAnalyzer {
  /**
   * 创建建筑间距分析工具
   * @param {Cesium.Viewer} viewer - Cesium Viewer实例
   * @param {Object} options - 配置选项
   * @param {Cesium.Color} options.lineColor - 距离线颜色
   * @param {number} options.lineWidth - 距离线宽度
   * @param {Cesium.Color} options.pointColor - 测量点颜色
   * @param {number} options.pointSize - 测量点大小
   * @param {Cesium.Color} options.labelColor - 标签颜色
   * @param {string} options.labelFont - 标签字体
   * @param {boolean} options.showBuilding - 是否显示建筑实体
   * @param {boolean} options.showBuildingOutline - 是否显示建筑底面边框
   * @param {Cesium.Color} options.buildingOutlineColor - 建筑底面边框颜色
   * @param {number} options.buildingOutlineWidth - 建筑底面边框宽度
   * @param {Function} [options.getLineColor] - 自定义获取线颜色的方法
   * @param {Array|Object} [options.distanceColorRanges] - 距离颜色范围配置，可指定 front-back/left-right/default 区间
   * @param {boolean} [options.labelBackground=true] - 是否显示标签背景
   * @param {Cesium.Color} [options.labelBackgroundColor] - 标签背景颜色
   * @param {boolean} [options.showLineWhenOccluded] - 控制连接线是否在遮挡时显示
   * @param {boolean} [options.showLabelWhenOccluded] - 控制标签是否在遮挡时显示
   * @param {number} [options.mainDirectionAngle] - 主方向角度（0~360°），用于手动指定主方向
   * @param {boolean} [options.enableDirectionType=false] - 是否启用方向类型区分（前后/左右）
   */
  constructor (viewer, options = {}) {
    this.viewer = viewer
    this.options = {
      lineColor: Cesium.Color.YELLOW,
      lineWidth: 2,
      pointColor: Cesium.Color.RED,
      pointSize: 10,
      labelColor: Cesium.Color.WHITE,
      labelFont: '14pt monospace',
      showBuilding: true,
      showBuildingOutline: true,
      buildingOutlineColor: Cesium.Color.fromCssColorString('#1890FF').withAlpha(0.8),
      buildingOutlineWidth: 2,
      labelBackground: true,
      labelBackgroundColor: new Cesium.Color(0.165, 0.165, 0.165, 0.7),
      getLineColor: this._defaultLineColorGetter,
      distanceColorRanges: null,
      showLineWhenOccluded: true,
      showLabelWhenOccluded: true,
      mainDirectionAngle: null,
      enableDirectionType: false,
      frontBackAngleThreshold: 45, // 前后方向最大偏移角度，默认45度
      enableDirectionTolerance: true, // 是否启用±容差
      directionToleranceAngle: 5, // 角度容差
      showDirectionLabel: false, // 是否在标签中显示"前后"/"左右"
      ...options
    }

    // 绑定默认方法的作用域
    this._defaultLineColorGetter = this._defaultLineColorGetter.bind(this)

    this.buildings = []
    this.analysisResults = []

    // 初始化主方向向量
    this.globalMainDirection = null
    this._initMainDirection()
  }

  _initMainDirection () {
    if (this.options.mainDirectionAngle !== null && !isNaN(this.options.mainDirectionAngle)) {
      const angleRad = Cesium.Math.toRadians(this.options.mainDirectionAngle)
      this.globalMainDirection = new Cesium.Cartesian3(
        Math.sin(angleRad), // X轴朝东为0度，北为90度
        Math.cos(angleRad), // Y轴朝北为0度
        0
      )
    } else {
      this.globalMainDirection = null // 表示需要自动识别
    }
  }

  /**
 * 默认的线颜色获取方法（兼容方向和非方向模式）
 * @param {number} distance - 距离（米）
 * @returns {Cesium.Color}
 * @private
 */
  _defaultLineColorGetter (distance) {
  const ranges = this.options.distanceColorRanges

  // 如果启用了方向区分，并且有 default 区间，则优先使用 default
  if (this.options.enableDirectionType && ranges && typeof ranges === 'object' && !Array.isArray(ranges)) {
    if (ranges.default && ranges.default.length > 0) {
      for (const range of ranges.default) {
        if (distance >= range.min && distance < range.max) {
          return range.color
        }
      }
      return ranges.default[ranges.default.length - 1]?.color || Cesium.Color.GREEN
    }
    return Cesium.Color.GREEN // fallback
  }

  // 原始数组模式支持
  if (Array.isArray(ranges)) {
    for (const range of ranges) {
      if (distance >= range.min && distance < range.max) {
        return range.color
      }
    }
    return ranges[ranges.length - 1]?.color || Cesium.Color.GREEN
  }

  // 默认硬编码配色
  if (distance < 10) return Cesium.Color.RED
  if (distance < 30) return Cesium.Color.ORANGE
  return Cesium.Color.GREEN
}

  /**
   * 更新距离颜色范围配置
   * @param {Array|Object} ranges - 新的颜色范围配置
   * @param {boolean} [reanalyze=true] - 是否立即重新分析
   */
  updateDistanceColorRanges (ranges, reanalyze = true) {
    this.options.distanceColorRanges = ranges
    if (reanalyze && this.analysisResults.length > 0) {
      this.clearAnalysisResults()
      this.analyzeAllBuildings()
    }
  }

  /**
   * 添加GeoJSON格式的建筑数据
   * @param {Object|string} geoJson - GeoJSON对象或字符串
   * @param {Object} options - 建筑选项
   * @param {number} options.height - 建筑高度(米)
   * @param {Cesium.Color} options.color - 建筑颜色
   * @param {string} options.id - 建筑ID
   * @returns {Promise<void>}
   */
  async addBuildingFromGeoJson (geoJson, options = {}) {
    try {
      if (typeof geoJson === 'string') {
        geoJson = JSON.parse(geoJson)
      }

      if (!geoJson || (geoJson.type !== 'Feature' && geoJson.type !== 'FeatureCollection')) {
        throw new Error('Invalid GeoJSON format. Must be Feature or FeatureCollection.')
      }

      const features = geoJson.type === 'Feature' ? [geoJson] : geoJson.features
      const newBuildings = []

      for (const feature of features) {
        if (!feature.geometry || feature.geometry.type !== 'Polygon') {
          console.warn('Skipping non-polygon feature')
          continue
        }

        const id = options.id || Cesium.createGuid()
        const height = options.height || 20
        const color = options.color || Cesium.Color.fromRandom({ alpha: 0.7 })

        const coordinates = feature.geometry.coordinates[0]
        const positions = coordinates.map(coord =>
          Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0)
        )

        if (positions.length < 3) {
          throw new Error('Invalid polygon: less than 3 vertices')
        }

        const entity = this.viewer.entities.add({
          id,
          name: feature.properties?.name || `Building_${id}`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(positions),
            extrudedHeight: height,
            material: color,
            outline: false,
            show: this.options.showBuilding // 控制是否显示
          }
        })

        let outlineEntity = null
        if (this.options.showBuildingOutline) {
          outlineEntity = this.viewer.entities.add({
            polyline: {
              positions: [...positions, positions[0]],
              width: this.options.buildingOutlineWidth,
              material: this.options.buildingOutlineColor,
              clampToGround: true
            }
          })
        }

        // 优化采样点数量
        const groundPoints = this._sampleGroundPoints(positions, 5, 100)

        const building = {
          id,
          geoJson: feature,
          entity,
          outlineEntity,
          groundPoints,
          height,
          properties: feature.properties || {}
        }

        this.buildings.push(building)
        newBuildings.push(building)
      }

      return newBuildings
    } catch (error) {
      console.error('Error adding building from GeoJSON:', error)
      throw error
    }
  }

  /**
 * 更新主方向（可用于手动设置或重新自动识别）
 * @param {number|null} [angle=null] - 手动指定角度（0~360°），若不传则自动识别
 */
  updateMainDirection (angle = null) {
  if (angle !== null && !isNaN(angle)) {
    // 手动设置主方向
    const angleRad = Cesium.Math.toRadians(angle)
    this.globalMainDirection = new Cesium.Cartesian3(
      Math.sin(angleRad),
      Math.cos(angleRad),
      0
    )
  } else {
    // 自动识别主方向
    this.globalMainDirection = this._autoDetectGlobalDirection()
  }
}

  /**
 * 自动检测所有建筑的主方向，并计算全局主方向
 * @private
 */
  _autoDetectGlobalDirection () {
  const allDirections = []

  for (const building of this.buildings) {
    const dir = this._getBuildingMainDirection(building)
    if (dir) {
      allDirections.push(dir)
    }
  }

  if (allDirections.length === 0) {
    return null
  }

  // 简单取平均向量
  const avgDir = new Cesium.Cartesian3()
  for (const d of allDirections) {
    Cesium.Cartesian3.add(avgDir, d, avgDir)
  }
  Cesium.Cartesian3.normalize(avgDir, avgDir)

  return avgDir
}

  /**
 * 获取单个建筑的主方向（最长边方向）
 * @param {Object} building - 建筑对象
 * @returns {Cesium.Cartesian3|null} 主方向向量
 * @private
 */
  _getBuildingMainDirection (building) {
  const positions = building.groundPoints

  if (!positions || positions.length < 2) {
    return null
  }

  let maxLen = 0
  let idx = 0

  // 查找最长边
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]
    const end = positions[(i + 1) % positions.length]
    const len = Cesium.Cartesian3.distance(start, end)
    if (len > maxLen) {
      maxLen = len
      idx = i
    }
  }

  // 获取最长边向量
  const p1 = positions[idx]
  const p2 = positions[(idx + 1) % positions.length]
  const dir = Cesium.Cartesian3.subtract(p2, p1, new Cesium.Cartesian3())

  // 计算与最长边垂直的向量（左右方向）
  const perpendicularDir = new Cesium.Cartesian3(-dir.y, dir.x, 0) // 垂直于边的方向
  Cesium.Cartesian3.normalize(perpendicularDir, perpendicularDir)

  return perpendicularDir // 返回左右方向
}

  /**
   * 在多边形底面采样点集
   * @param {Cesium.Cartesian3[]} positions - 多边形顶点
   * @param {number} [sampleDistance=5] - 采样间隔(米)
   * @param {number} [maxPoints=100] - 最大采样点数
   * @returns {Cesium.Cartesian3[]}
   * @private
   */
  _sampleGroundPoints (positions, sampleDistance = 5, maxPoints = 100) {
    if (!positions || positions.length < 2) {
      console.warn('Invalid positions for sampling')
      return []
    }

    // 初始点为多边形顶点
    const points = [...positions]

    // 如果顶点数量已达到最大采样点数，直接返回
    if (points.length >= maxPoints) {
      return points.slice(0, maxPoints)
    }

    // 计算多边形总长度
    let totalLength = 0
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i]
      const end = positions[(i + 1) % positions.length]
      totalLength += Cesium.Cartesian3.distance(start, end)
    }

    // 根据总长度调整采样间隔
    const requiredPoints = maxPoints - positions.length
    const adjustedSampleDistance = totalLength / requiredPoints

    // 在每条边上进行采样
    for (let i = 0; i < positions.length && points.length < maxPoints; i++) {
      const start = positions[i]
      const end = positions[(i + 1) % positions.length]
      const segmentLength = Cesium.Cartesian3.distance(start, end)
      const segmentCount = Math.max(1, Math.floor(segmentLength / adjustedSampleDistance))

      for (let j = 1; j < segmentCount && points.length < maxPoints; j++) {
        const ratio = j / segmentCount
        const point = new Cesium.Cartesian3()
        Cesium.Cartesian3.lerp(start, end, ratio, point)
        points.push(point)
      }
    }

    return points
  }

  /**
   * 分析所有建筑之间的最小距离
   * @param {Array<string|Object>} [buildingList] 可选的建筑列表（ID或对象）
   * @param {number} [maxDistance=Infinity] 可选的最大距离阈值
   */
  analyzeAllBuildings (buildingList, maxDistance = Infinity) {
    // 如果启用了方向区分且主方向未设置，则先识别主方向
  if (this.options.enableDirectionType && !this.globalMainDirection) {
    this.updateMainDirection() // 自动识别
  }
    // 清除之前的分析结果
    this.clearAnalysisResults()

    // 确定要分析的建筑
    let buildingsToAnalyze = []

    if (buildingList && buildingList.length > 0) {
      // 解析传入的建筑列表
      buildingsToAnalyze = buildingList.map(b =>
        typeof b === 'string' ? this.buildings.find(bld => bld.id === b) : b
      ).filter(b => b !== undefined)
    } else {
      // 如果没有指定建筑列表，分析所有建筑
      buildingsToAnalyze = [...this.buildings]
    }

    // 验证至少有两个建筑
    if (buildingsToAnalyze.length < 2) {
      console.warn('At least two buildings are required for analysis')
      return
    }

    // 存储所有的分析结果
    const allResults = []

    // 遍历所有唯一的建筑对
    for (let i = 0; i < buildingsToAnalyze.length - 1; i++) {
      for (let j = i + 1; j < buildingsToAnalyze.length; j++) {
        const b1 = buildingsToAnalyze[i]
        const b2 = buildingsToAnalyze[j]

        try {
          // 计算两个建筑之间的最小距离
          const result = this._calculateMinimumDistancePair(b1, b2)

          if (result && result.distance !== Infinity && result.distance <= maxDistance) {
            // 创建可视化实体
            const visualization = this._createVisualizationEntities(
              result.closestPoint1,
              result.closestPoint2,
              b1,
              b2,
              result.distance
            )

            // 存储分析结果
            const analysisResult = {
              id: Cesium.createGuid(),
              buildings: [b1, b2],
              points: [result.closestPoint1, result.closestPoint2],
              distance: result.distance,
              entities: visualization
            }

            this.analysisResults.push(analysisResult)
            allResults.push(analysisResult)
          }
        } catch (error) {
          console.error(`Error analyzing building pair ${b1.id}-${b2.id}:`, error)
        }
      }
    }

    return allResults
  }

  /**
   * 计算两个建筑之间的最小距离
   * @private
   */
  _calculateMinimumDistancePair (b1, b2) {
    let minDistance = Infinity
    let closestPoint1 = null
    let closestPoint2 = null

    // 简化空间搜索
    for (const p1 of b1.groundPoints) {
      for (const p2 of b2.groundPoints) {
        const distance = Cesium.Cartesian3.distance(p1, p2)
        if (distance < minDistance) {
          minDistance = distance
          closestPoint1 = p1
          closestPoint2 = p2
        }
      }
    }

    return {
      distance: minDistance,
      closestPoint1,
      closestPoint2
    }
  }

  /**
 * 判断两点连线相对于主方向的方向类型（前后/左右）
 * @private
 */
  _getDirectionType (point1, point2) {
  if (!this.globalMainDirection || !this.options.enableDirectionType) return null

  const direction = Cesium.Cartesian3.subtract(point2, point1, new Cesium.Cartesian3())
  Cesium.Cartesian3.normalize(direction, direction)

  const mainDir = this.globalMainDirection

  // 计算夹角
  const cross = Cesium.Cartesian3.cross(mainDir, direction, new Cesium.Cartesian3())
  const dot = Cesium.Cartesian3.dot(mainDir, direction)
  const angleRad = Math.atan2(Cesium.Cartesian3.magnitude(cross), dot)
  let angleDeg = Cesium.Math.toDegrees(angleRad)

  // 判断方向朝左还是朝右
  const up = new Cesium.Cartesian3(0, 0, 1)
  const normal = Cesium.Cartesian3.cross(mainDir, direction, new Cesium.Cartesian3())
  const sign = Cesium.Cartesian3.dot(normal, up) >= 0 ? 1 : -1
  angleDeg *= sign

  const absAngle = Math.abs(angleDeg)

  const threshold = this.options.frontBackAngleThreshold || 45
  const tolerance = this.options.enableDirectionTolerance ? this.options.directionToleranceAngle : 0

  // 前后方向范围：[0, threshold + tolerance] ∪ [180 - threshold + tolerance, 180]
  if (
    absAngle <= threshold + tolerance ||
    absAngle >= (180 - threshold - tolerance)
  ) {
    return 'front-back'
  }

  // 左右方向范围：[90 - tolerance, 90 + tolerance]
  if (
    absAngle >= (90 - threshold + tolerance) &&
    absAngle <= (90 + threshold - tolerance)
  ) {
    return 'left-right'
  }

  return null // 其他情况不分类
}

  /**
   * 获取基于方向的距离对应颜色
   * @private
   */
  _getDistanceLineColor (distance, dirType = null) {
    const ranges = this.options.distanceColorRanges
    if (this.options.enableDirectionType && dirType && ranges && ranges[dirType]) {
      for (const range of ranges[dirType]) {
        if (distance >= range.min && distance < range.max) {
          return range.color
        }
      }
      return ranges[dirType][ranges[dirType].length - 1]?.color || Cesium.Color.GREEN
    }

    if (ranges && ranges.default) {
      for (const range of ranges.default) {
        if (distance >= range.min && distance < range.max) {
          return range.color
        }
      }
      return ranges.default[ranges.default.length - 1]?.color || Cesium.Color.GREEN
    }

    return this.options.lineColor
  }

  /**
   * 创建可视化实体（点、线、标签）
   * @private
   */
  _createVisualizationEntities (point1, point2, b1, b2, distance) {
    const dirType = this._getDirectionType(point1, point2)
    const lineColor = this._getDistanceLineColor(distance, dirType)

    const point1Entity = this.viewer.entities.add({
      position: point1,
      point: {
        pixelSize: this.options.pointSize,
        color: lineColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      }
    })

    const point2Entity = this.viewer.entities.add({
      position: point2,
      point: {
        pixelSize: this.options.pointSize,
        color: lineColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      }
    })

    const lineOptions = {
      positions: [point1, point2],
      width: this.options.lineWidth + 1,
      material: lineColor,
      height: 0.1,
      arcType: Cesium.ArcType.RHUMB,
      zIndex: 10
    }

    if (this.options.showLineWhenOccluded) {
      lineOptions.depthFailMaterial = lineColor.withAlpha(0.5)
    }

    const line = this.viewer.entities.add({
      polyline: lineOptions
    })

    const center = Cesium.Cartesian3.midpoint(point1, point2, new Cesium.Cartesian3())
    center.z = Math.max(point1.z || 0, point2.z || 0) + 5

    const showDirection = this.options.showDirectionLabel && dirType
      ? (dirType === 'front-back' ? '前后' : dirType === 'left-right' ? '左右' : '')
      : ''
    const labelProps = {
      text: `${showDirection} ${this._formatDistance(distance)}`,
      font: 'bold 16pt monospace',
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineWidth: 3,
      fillColor: lineColor,
      outlineColor: Cesium.Color.BLACK,
      pixelOffset: new Cesium.Cartesian2(0, -25),
      showBackground: this.options.labelBackground,
      backgroundColor: this.options.labelBackgroundColor,
      backgroundPadding: new Cesium.Cartesian2(10, 7)
    }

    if (this.options.showLabelWhenOccluded) {
      labelProps.disableDepthTestDistance = Number.POSITIVE_INFINITY
    }

    if (distance < 50) {
      const direction = Cesium.Cartesian3.subtract(point2, point1, new Cesium.Cartesian3())
      Cesium.Cartesian3.normalize(direction, direction)
      const perpendicular = new Cesium.Cartesian3(-direction.y, direction.x, 0)
      Cesium.Cartesian3.multiplyByScalar(perpendicular, 20, perpendicular)
      labelProps.pixelOffset = new Cesium.Cartesian2(perpendicular.x, perpendicular.y)
    }

    const label = this.viewer.entities.add({
      position: center,
      label: labelProps
    })

    return {
      point1: point1Entity,
      point2: point2Entity,
      line,
      label
    }
  }

  /**
   * 获取所有分析结果
   */
  getAllAnalysisResults () {
    return [...this.analysisResults]
  }

  /**
   * 清除所有分析结果
   */
  clearAnalysisResults () {
    this.analysisResults.forEach(result => {
      if (result.entities.point1) this.viewer.entities.remove(result.entities.point1)
      if (result.entities.point2) this.viewer.entities.remove(result.entities.point2)
      if (result.entities.line) this.viewer.entities.remove(result.entities.line)
      if (result.entities.label) this.viewer.entities.remove(result.entities.label)
    })

    this.analysisResults = []
  }

  /**
   * 销毁分析工具
   */
  destroy () {
    this.clearAnalysisResults()

    this.buildings.forEach(building => {
      this.viewer.entities.remove(building.entity)
      if (building.outlineEntity) {
        this.viewer.entities.remove(building.outlineEntity)
      }

      building.entity = null
      building.outlineEntity = null
      building.groundPoints = null
      building.properties = null
    })

    this.buildings = []
    this.options = null
  }

  /**
   * 格式化距离显示
   * @private
   */
  _formatDistance (distance) {
    return distance > 1000
      ? `${(distance / 1000).toFixed(2)} km`
      : `${distance.toFixed(2)} m`
  }
}
