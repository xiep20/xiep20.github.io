## 建筑退让分析

建筑退让分析是城市规划中的重要工具，用于分析建筑物与红线之间的退让距离是否符合规划要求。本示例展示了如何在Cesium中实现建筑退让分析功能，通过可视化方式展示违规区域和安全区域。

## 功能特点

- **红线缓冲区分析**：根据设定的退让距离生成红线缓冲区
- **建筑违规检测**：自动识别与红线缓冲区相交的建筑区域
- **可视化展示**：用不同颜色标识违规区域（红色）和安全区域（绿色）
- **实时调整**：支持动态调整退让距离，实时更新分析结果
- **3D模型集成**：在3D建筑模型上进行退让分析

## 技术实现

### 核心组件

1. **SetbackAnalysisTool类**：退让分析工具的核心类
2. **Turf.js空间分析**：使用turf.js进行几何运算和空间分析
3. **Cesium可视化**：使用Cesium的Primitive和ClassificationPrimitive进行3D可视化

### 主要功能

- **红线数据处理**：支持线状和面状红线数据
- **建筑底面分析**：基于建筑底面进行退让分析
- **缓冲区计算**：使用turf.buffer生成退让范围
- **相交分析**：使用turf.booleanIntersects检测违规区域
- **3D分类渲染**：在3D模型上高亮显示分析结果

## 使用方法

1. **设置红线数据**：通过`setbackTool.Redline`设置红线GeoJSON数据
2. **设置建筑数据**：通过`setbackTool.Buildings`设置建筑底面GeoJSON数据
3. **调整退让距离**：使用滑块或直接设置`setbackTool.BufferDistance`
4. **执行分析**：调用`setbackTool.updateAnalysis()`或点击分析按钮
5. **查看结果**：红色区域表示违规，绿色区域表示安全

## 配置参数

- **退让距离**：可设置1-100米的退让距离
- **建筑缓冲**：建筑底面缓冲距离（默认0.5米）
- **颜色样式**：可自定义违规区域和安全区域的颜色

## 代码示例

### 基本使用

```javascript
// 创建分析工具实例
const setbackTool = new SetbackAnalysisTool();

// 设置红线数据
setbackTool.Redline = redlineGeoJSON;

// 设置建筑数据
setbackTool.Buildings = buildingGeoJSON;

// 设置退让距离
setbackTool.BufferDistance = 10; // 10米退让距离

// 执行分析
setbackTool.updateAnalysis();
```

### 动态调整退让距离

```javascript
// 滑块事件监听
distanceSlider.addEventListener('input', function(e) {
    const distance = e.target.value;
    distanceValue.textContent = `${distance} 米`;
    
    // 防抖处理，避免频繁更新
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
        setbackTool.BufferDistance = parseFloat(distance);
    }, 500);
});
```

### 清除分析结果

```javascript
// 清除按钮事件
clearBtn.addEventListener('click', function() {
    setbackTool._clearVisuals();
});
```
## 技术细节

### 3D可视化

- **地面图元**：使用Cesium.Primitive显示地面分析结果
- **分类图元**：使用Cesium.ClassificationPrimitive在3D模型上高亮显示
- **颜色编码**：红色表示违规区域，绿色表示安全区域


### 示例展示 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/buildingSetback/buildingSetback.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/buildingSetback/buildingSetback.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>

&emsp; 

&emsp; 

&emsp; 