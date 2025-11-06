
class HeightLimit {
  constructor (options = {}) {
     this._minHeight = 0
    this._maxHeight = options.maxHeight || 1000
    this._height = options.initialHeight || 0
    this._relativeHeight = options.initialRelativeHeight || 0
    this._polygon = null
    this._lowerPolygonPrimitive = null
    this._upperPolygonPrimitive = null
    this._polygonCutEntity = null
    this._showCutEntity = options.showCutEntity !== false
    this._centerWC = null
    this._center = null
    this._readyCallback = null
    this._viewer = options.viewer || window.viewer
    this._terrainProvider = this._viewer.terrainProvider
    this._currentHeight = 0
    this._isInitialized = false
  }

  // 获取多边形内最低点高度
  async _calculateMinHeight (positions) {
    if (!positions || positions.length === 0) return 0

    if (!this._terrainProvider || this._terrainProvider instanceof Cesium.EllipsoidTerrainProvider) {
      return 0
    }

    try {
      const degreesArray = positions.map(pos => {
        const carto = Cesium.Cartographic.fromCartesian(pos)
        return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)]
      })

      const turfPolygon = turf.polygon([degreesArray])
      const area = turf.area(turfPolygon) // 使用面积而不是长度
      let sampleDensity = Math.sqrt(area) / 50 // 根据面积动态调整采样密度
      if (sampleDensity < 0.001) sampleDensity = 0.001

      const turfExtent = turf.bbox(turfPolygon)
      const turfSamplePoints = turf.pointGrid(turfExtent, sampleDensity, {
        units: 'kilometers',
        mask: turfPolygon
      })

      const cesiumSamplePoints = turfSamplePoints.features.map(feature => {
        const coord = feature.geometry.coordinates
        return Cesium.Cartographic.fromDegrees(coord[0], coord[1])
      })

      const updatedPositions = await Cesium.sampleTerrainMostDetailed(
        this._terrainProvider,
        cesiumSamplePoints
      )

      const minHeight = updatedPositions.reduce((min, point) =>
        point.height < min ? point.height : min,
      Number.MAX_VALUE
      )

      // 确保最低高度不会低于0
      return Math.max(minHeight, 0)
    } catch (error) {
      console.warn('地形采样失败，使用默认高度0:', error)
      return 0
    }
  }

  // 将GeoJSON转换为多边形层次结构
  _geojsonToPolygonHierarchy (geojson) {
    if (!geojson) return null

    const type = geojson.type
    let coordinates = []

    if (type === 'Polygon') {
      coordinates = geojson.coordinates
    } else if (type === 'MultiPolygon') {
      coordinates = geojson.coordinates.flat()
    } else {
      console.warn('不支持的GeoJSON类型:', type)
      return null
    }

    const is3d = coordinates[0][0].length === 3
    const flattened = coordinates.flat(2)

    const positions = is3d
      ? Cesium.Cartesian3.fromDegreesArrayHeights(flattened)
      : Cesium.Cartesian3.fromDegreesArray(flattened)

    return new Cesium.PolygonHierarchy(positions)
  }

  // 设置多边形
  set polygon (geojson) {
    this._clear()
    this._isInitialized = false
    if (!geojson) return

    const hierarchy = this._geojsonToPolygonHierarchy(geojson)
    if (!hierarchy) return

    this._polygon = geojson
    this._centerWC = Cesium.BoundingSphere.fromPoints(hierarchy.positions).center
    this._center = Cesium.Cartographic.fromCartesian(this._centerWC)

    // 先计算最低高度，再初始化Primitive
    this._calculateMinHeight(hierarchy.positions).then(minHeight => {
      this._minHeight = minHeight
      this._isInitialized = true

      // 应用存储的高度值（会触发_updateHeight）
      if (this._relativeHeight !== undefined) {
        this.heightRelative = this._relativeHeight
      } else {
        this.height = this._height
      }

      // 创建Primitive（此时_currentHeight已更新）
      this._createPolygonPrimitives(hierarchy)
      if (this._showCutEntity) {
        this._createPolygonCutEntity(hierarchy)
      }

      if (this._readyCallback) this._readyCallback()
    }).catch(error => {
      console.error('计算最低高度失败:', error)
      this._minHeight = 0
      this._isInitialized = true
      this.height = this._height
    })
  }

  get polygon () {
    return this._polygon
  }

  // 创建两个分类图元（合规部分和超高部分）
  _createPolygonPrimitives (hierarchy) {
    // 移除旧Primitive
  this._removePrimitives()

  // 计算微小偏移量（避免浮点数精度问题）
  const epsilon = 0.01 // 0.1米偏移

  // 合规部分（绿色）
  this._lowerPolygonPrimitive = new Cesium.ClassificationPrimitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchy,
        height: this._minHeight,
        extrudedHeight: Math.max(this._currentHeight, this._minHeight + epsilon), // 确保不低于minHeight
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.GREEN.withAlpha(0.5))
      }
    }),
    classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
    asynchronous: true
  })

  // 超高部分（红色）：currentHeight -> maxHeight
  this._upperPolygonPrimitive = new Cesium.ClassificationPrimitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchy,
        height: this._currentHeight,
        extrudedHeight: this._maxHeight,
        vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.RED.withAlpha(0.5))
      }
    }),
    classificationType: Cesium.ClassificationType.CESIUM_3D_TILE,
    asynchronous: true
  })

  // 添加到场景
  this._viewer.scene.primitives.add(this._lowerPolygonPrimitive)
  this._viewer.scene.primitives.add(this._upperPolygonPrimitive)
  }

  // 新增：移除Primitive的辅助方法
  _removePrimitives () {
    if (this._lowerPolygonPrimitive && !this._lowerPolygonPrimitive.isDestroyed()) {
      this._viewer.scene.primitives.remove(this._lowerPolygonPrimitive)
      this._lowerPolygonPrimitive.destroy()
      this._lowerPolygonPrimitive = null
    }
    if (this._upperPolygonPrimitive && !this._upperPolygonPrimitive.isDestroyed()) {
      this._viewer.scene.primitives.remove(this._upperPolygonPrimitive)
      this._upperPolygonPrimitive.destroy()
      this._upperPolygonPrimitive = null
    }
  }

  // 创建多边形切割实体
  _createPolygonCutEntity (hierarchy) {
    if (!this._showCutEntity) return

    this._polygonCutEntity = this._viewer.entities.add({
      name: 'Height Limit Cut Plane',
      polygon: {
        hierarchy,
        height: 0,
        material: Cesium.Color.CYAN.withAlpha(0.5),
        outline: true,
        extrudedHeight: this._currentHeight || 100,
        heightReference: Cesium.HeightReference.NONE,
        extrudedHeightReference: Cesium.HeightReference.NONE,
        outlineColor: Cesium.Color.BLACK
      }
    })
  }

  // 设置高度
  set height (value) {
    if (!this._isInitialized) {
      this._height = value
      return
    }

    const clampedValue = Math.max(value, this._minHeight)
    this._height = clampedValue
    this._currentHeight = clampedValue
    this._updateHeight(clampedValue)
  }

  get height () {
    return this._height
  }

  // 设置相对高度
  set heightRelative (value) {
    if (!this._isInitialized) {
      this._relativeHeight = value
      return
    }

    this._relativeHeight = value
    const realHeight = value + this._minHeight
    this.height = realHeight // 这会触发height的setter
  }

  get heightRelative () {
    return this._relativeHeight
  }

  // 设置是否显示切割面
  set showCutEntity (show) {
    if (this._showCutEntity === show) return

    this._showCutEntity = show

    if (!this._polygon) return

    if (show && !this._polygonCutEntity) {
      // 需要创建切割面
      const hierarchy = this._geojsonToPolygonHierarchy(this._polygon)
      this._createPolygonCutEntity(hierarchy)
      if (this._isInitialized) {
        this._polygonCutEntity.polygon.extrudedHeight = this._currentHeight
      }
    } else if (!show && this._polygonCutEntity) {
      // 需要移除切割面
      this._viewer.entities.remove(this._polygonCutEntity)
      this._polygonCutEntity = null
    }
  }

  get showCutEntity () {
    return this._showCutEntity
  }

  // 更新高度 - 确保同时更新两个部分
  _updateHeight (value) {
    if (!this._isInitialized || !this._polygon) return
  this._currentHeight = value

  // 重建Primitive（自动应用新的高度范围）
  const hierarchy = this._geojsonToPolygonHierarchy(this._polygon)
  this._createPolygonPrimitives(hierarchy)

  // 更新切割面
  if (this._polygonCutEntity) {
    this._polygonCutEntity.polygon.extrudedHeight = value
  }
  }

  // 设置准备回调
  set onReady (callback) {
    this._readyCallback = callback
  }

  get onReady () {
    return this._readyCallback
  }

  // 清除
  clear () {
    this._clear()
  }

  // 销毁
  destroy () {
    this._clear()
    this._viewer = null
    this._terrainProvider = null
  }

  // 内部清理方法
  _clear () {
    this._removePrimitives()

    if (this._polygonCutEntity && !this._polygonCutEntity.isDestroyed) {
      this._viewer.entities.remove(this._polygonCutEntity)
      this._polygonCutEntity = null
    }

    this._polygon = null
    this._centerWC = null
    this._center = null
    this._isInitialized = false
  }
}
