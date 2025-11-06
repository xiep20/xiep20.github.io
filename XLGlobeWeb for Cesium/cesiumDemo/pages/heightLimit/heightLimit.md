## 限高分析

本示例演示如何在 Cesium 中对给定用地范围进行“建筑限高”分析，并将合规与超高区间以分类图元高亮显示。页面提供滑块与数值输入来设置限制高度，并可切换是否显示切割面。

## 使用步骤

1. 进入示例页面后，点击“分析”，将固定矩形作为分析面应用到 `HeightLimit`。
2. 通过滑块/输入框调整限制高度，点击“分析”更新结果。
3. 勾选/取消“显示切割面”以切换切割面可视化。

## 关键类与参数

- **HeightLimit(options)**
  - `viewer`: Cesium.Viewer 实例。
  - `maxHeight`(可选): 超高部分上限高度，默认 1000m。
  - `initialRelativeHeight`(可选): 初始相对高度。
  - `showCutEntity`(可选): 是否显示切割面，默认 true。

- 主要属性/方法
  - `polygon`: 设定或获取分析面（GeoJSON，支持 Polygon/MultiPolygon）。
  - `heightRelative`: 设定相对高度（相对于面内最低地形）。
  - `showCutEntity`: 控制切割面显隐。
  - `clear()/destroy()`: 清理或销毁实例。

## 代码片段

```javascript
const heightLimit = new HeightLimit({ viewer })
// 首次分析
heightLimit.showCutEntity = true
heightLimit.polygon = rectangleGeoJSON
heightLimit.heightRelative = 50

// 之后仅更新高度
heightLimit.heightRelative = 80
```

## 示例链接 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/heightLimit/heightLimit.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/heightLimit/heightLimit.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>


