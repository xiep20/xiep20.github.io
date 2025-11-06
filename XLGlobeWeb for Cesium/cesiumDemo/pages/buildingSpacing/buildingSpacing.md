## 建筑间距分析

建筑间距分析是城市规划中的重要工具，用于分析建筑物之间的最小距离是否符合规划要求。本示例展示了如何在Cesium中实现建筑间距分析功能，通过可视化方式展示建筑之间的间距关系。

## 功能特点

- **最小距离计算**：自动计算建筑之间的最小距离
- **间距可视化**：用连接线和标签显示建筑间距
- **颜色编码**：根据间距大小用不同颜色标识（红色/橙色/绿色）
- **实时调整**：支持动态调整间距阈值，实时更新分析结果
- **建筑轮廓显示**：显示建筑底面轮廓，便于观察分析结果

## 技术实现

### 核心组件

1. **BuildingDistanceAnalyzer类**：建筑间距分析工具的核心类
2. **空间距离计算**：使用Cesium的Cartesian3进行3D空间距离计算
3. **Cesium可视化**：使用Cesium的Entity进行点、线、标签可视化

### 主要功能

- **建筑数据处理**：支持GeoJSON格式的建筑底面数据
- **采样点生成**：在建筑底面边界上生成采样点
- **最小距离计算**：计算建筑对之间的最小距离
- **可视化渲染**：显示连接线、测量点和距离标签
- **颜色分级**：根据距离阈值进行颜色分级显示

## 使用方法

1. **设置建筑数据**：通过`buildingData`设置建筑底面GeoJSON数据
2. **调整间距阈值**：使用滑块设置限制间距（5-500米）
3. **执行分析**：点击"分析"按钮开始建筑间距分析
4. **查看结果**：红色表示间距不足，橙色表示接近限制，绿色表示安全
5. **清除结果**：点击"清除"按钮清除分析结果

## 配置参数

- **限制间距**：可设置5-500米的间距阈值
- **颜色分级**：
  - 红色：距离小于限制间距
  - 橙色：距离在限制间距的1.2倍内
  - 绿色：距离在限制间距的2倍内
- **显示选项**：可控制建筑轮廓、连接线、标签的显示

## 代码示例

### 基本使用

```javascript
// 创建分析工具实例
const distanceAnalyzer = new BuildingDistanceAnalyzer(viewer, {
    lineColor: Cesium.Color.YELLOW,
    lineWidth: 2,
    pointColor: Cesium.Color.RED,
    labelColor: Cesium.Color.WHITE,
    showBuilding: false, // 不显示建筑
    showBuildingOutline: true, // 显示建筑轮廓
    distanceColorRanges: {
        default: [
            { min: 0, max: 20, color: Cesium.Color.RED },
            { min: 20, max: 24, color: Cesium.Color.ORANGE },
            { min: 24, max: 40, color: Cesium.Color.GREEN }
        ]
    }
});

// 添加建筑数据
await distanceAnalyzer.addBuildingFromGeoJson(buildingData);

// 执行分析
distanceAnalyzer.analyzeAllBuildings(null, 32); // 最大分析距离32米
```

### 动态调整间距阈值

```javascript
// 滑块事件监听
spacingSlider.addEventListener('input', function() {
    spacingValue = parseInt(this.value);
    spacingValueDisplay.textContent = spacingValue;
});

// 分析按钮事件
analyzeBtn.addEventListener('click', async function() {
    await performAnalysis();
});
```

### 清除分析结果

```javascript
// 清除按钮事件
clearBtn.addEventListener('click', function() {
    if (distanceAnalyzer) {
        distanceAnalyzer.clearAnalysisResults();
    }
});
```
## 技术细节

### 距离计算算法

- **采样点生成**：在建筑底面边界上均匀生成采样点
- **最小距离计算**：遍历所有建筑对，计算采样点之间的最小距离
- **空间坐标转换**：使用Cesium.Cartesian3进行3D空间距离计算

### 可视化渲染

- **连接线**：使用Cesium.Polyline显示建筑间的最短距离线
- **测量点**：使用Cesium.Point显示距离测量的起点和终点
- **距离标签**：使用Cesium.Label显示距离数值
- **建筑轮廓**：使用Cesium.Polyline显示建筑底面边界

## 功能特性

### 颜色分级系统

- **红色区域**：建筑间距小于设定阈值，表示间距不足
- **橙色区域**：建筑间距在阈值的1.2倍内，表示接近限制
- **绿色区域**：建筑间距在阈值的2倍内，表示安全间距

### 交互控制

- **实时调整**：通过滑块实时调整间距阈值
- **一键分析**：点击分析按钮执行建筑间距分析
- **结果清除**：点击清除按钮移除所有分析结果
- **调试信息**：控制台输出详细的分析过程信息

### 性能优化

- **采样点控制**：自动控制建筑边界采样点数量，平衡精度和性能
- **距离阈值**：只分析指定距离范围内的建筑对，避免不必要的计算
- **内存管理**：提供destroy方法清理分析器资源

## 注意事项

1. **数据格式**：建筑数据必须是GeoJSON格式的Polygon类型
2. **坐标系统**：支持WGS84地理坐标系
3. **性能考虑**：建筑数量较多时建议设置合理的最大分析距离
4. **浏览器兼容**：需要支持ES6+的现代浏览器

### 示例展示 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/buildingSpacing/buildingSpacing.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/buildingSpacing/buildingSpacing.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>

&emsp; 

&emsp; 

&emsp; 