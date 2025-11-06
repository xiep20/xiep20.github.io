## 模型压平

本文将介绍如何在Cesium中使用模型压平功能。模型压平是一种重要的3D场景处理技术，可以将指定区域内的3D模型顶点高度统一调整到指定高度，常用于城市规划、地形分析、建筑拆除等场景。

## 功能特性

模型压平工具提供以下核心功能：
- **多区域压平**：支持同时设置多个压平区域
- **灵活坐标格式**：支持Cartesian3、经纬度、WKT、GeoJSON等多种坐标格式
- **高度控制**：可设置统一的基准高度和区域特定的压平高度
- **实时预览**：压平效果实时显示，支持动态调整
- **批量处理**：可同时处理多个3D模型

## 使用方法

### 1. 创建压平工具实例

```javascript
// 创建压平工具实例
const flattenTool = new FlattenTileset([], {
    oHeight: 0,  // 统一基准高度
    flatHeight: 0 // 压平高度
});

// 添加要处理的3D模型
flattenTool.addTileset(tileset);
```

### 2. 添加压平区域

```javascript
// 使用经纬度坐标添加压平区域
const positions = [
    [114.489039, 30.000866],   // 左下角
    [114.485378, 30.000866],   // 右下角
    [114.485378, 29.997749],   // 右上角
    [114.489039, 29.997749],   // 左上角
    [114.489039, 30.000866]    // 闭合多边形
];

flattenTool.addRegion({
    positions: positions,
    height: 0  // 压平高度偏移
});
```

### 3. 支持多种坐标格式

#### 经纬度坐标
```javascript
flattenTool.addRegion({
    positions: [[lon1, lat1], [lon2, lat2], [lon3, lat3]],
    height: 0
});
```

#### WKT格式
```javascript
flattenTool.addRegion({
    positions: "POLYGON ((30 10, 40 40, 20 40, 10 20, 30 10))",
    height: 0
});
```

#### GeoJSON格式
```javascript
flattenTool.addRegion({
    positions: {
        type: "Polygon",
        coordinates: [[[lon1, lat1], [lon2, lat2], [lon3, lat3], [lon1, lat1]]]
    },
    height: 0
});
```

### 4. 管理压平区域

```javascript
// 清除指定区域
flattenTool.removeRegionById(regionId);

// 清除所有压平区域
flattenTool.clearAllRegions();

// 设置统一基准高度
flattenTool.setOHeight(100);

// 设置特定模型的压平高度
flattenTool.setFlatHeight(tileset, 50);
```

## 核心参数说明

### 构造函数参数
- `tilesets`: 要处理的3D模型集（Cesium3DTileset或数组）
- `opt.oHeight`: 统一基准高度，默认为0
- `opt.flatHeight`: 压平高度，默认为0

### addRegion参数
- `positions`: 压平区域坐标（支持多种格式）
- `height`: 压平高度偏移，相对于基准高度
- `id`: 区域唯一标识（可选）
- `format`: 显式指定坐标格式（可选）


### 示例展示 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/flatten/flattenTileset.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/flatten/flattenTileset.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>

&emsp; 

&emsp; 

&emsp; 