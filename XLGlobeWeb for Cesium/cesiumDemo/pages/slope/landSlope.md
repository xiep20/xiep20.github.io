## 地形坡度分析

本文将介绍如何在Cesium中使用地形坡度分析功能。坡度分析是一种重要的地形分析技术，可以计算指定区域内地表的倾斜角度，并通过颜色分级直观展示不同坡度等级的分布情况，常用于土地利用规划、土木工程、农业规划等场景。

## 功能特性

坡度分析工具提供以下核心功能：
- **高精度坡度计算**：使用Delaunay三角网算法精确计算地形坡度
- **自适应采样**：根据分析区域大小自动调整采样密度，确保分析精度
- **颜色分级可视化**：将坡度分为6个等级，使用不同颜色直观展示
- **网格线模式**：支持使用三角网格线展示坡度分析结果
- **统计信息计算**：自动计算分析区域的平均坡度、主要坡度等级等统计信息
- **进度反馈**：支持分析过程的进度回调，提供良好的用户体验

## 坡度分级标准

| 坡度等级 | 角度范围 | 颜色表示 | 适用场景 |
|---------|---------|---------|----------|
| 平坡    | 0°-2°   | 纯绿色   | 适宜耕作、建筑 |
| 缓坡    | 2°-5°   | 黄绿色   | 适宜耕作、建筑 |
| 微坡    | 5°-8°   | 黄色     | 可耕作、需要适当改造 |
| 中坡    | 8°-15°  | 深橙色   | 适合林业、园艺 |
| 陡坡    | 15°-25° | 橙红色   | 适合林业、不宜大规模开发 |
| 极陡坡  | 25°以上  | 深红色   | 生态保护、不宜开发 |

## 使用方法

### 1. 创建坡度分析工具实例

```javascript
// 创建坡度分析工具实例
const slopeTool = new LandSlopeAnalysisTool(viewer, {
    maxSamplePoints: 5000,  // 最大采样点数
    sampleDistance: 0.003   // 采样密度
});
```

### 2. 执行坡度分析

```javascript
// 定义分析区域坐标（经纬度格式）
const polygonCoords = [
    [114.489039, 30.000866],   // 左下角
    [114.485378, 30.000866],   // 右下角
    [114.485378, 29.997749],   // 右上角
    [114.489039, 29.997749],   // 左上角
    [114.489039, 30.000866]    // 闭合多边形
];

// 执行坡度分析
slopeTool.analyzeSlope(
    polygonCoords, 
    (result) => {
        if (result.success) {
            console.log('坡度分析成功:', result);
            console.log('平均坡度:', result.data[0].averageSlope.toFixed(2) + '°');
            console.log('主要坡度等级:', result.data[0].dominantLevel.name);
        } else {
            console.error('坡度分析失败:', result.message);
        }
    },
    (progress) => {
        console.log(`分析进度: ${progress.progress}%, ${progress.message}`);
        // 更新UI进度条等
    }
);
```

### 3. 进度回调示例

```javascript
// 进度回调函数
function onProgress(progress) {
    // 更新进度条
    const progressBar = document.getElementById('progressBar');
    progressBar.style.width = progress.progress + '%';
    progressBar.textContent = progress.message;
    
    console.log(`坡度分析进度: ${progress.progress}% - ${progress.message}`);
}

// 使用进度回调执行分析
slopeTool.analyzeSlope(polygonCoords, onResult, onProgress);
```

### 4. 清除分析结果

```javascript
// 清除当前分析结果
slopeTool.clearAnalysis();

// 取消正在进行的分析
if (slopeTool.isAnalysisRunning()) {
    slopeTool.cancelAnalysis();
}
```

## 核心参数说明

### 构造函数参数
- `viewer`: Cesium Viewer实例
- `options.maxSamplePoints`: 最大采样点数，默认为5000
- `options.minSamplePoints`: 最小采样点数，默认为50
- `options.sampleDistance`: 采样密度，默认为0.003
- `options.slopeLevels`: 自定义坡度分级配置（可选）

### analyzeSlope方法参数
- `analysisPolygon`: 分析区域坐标数组（经纬度格式）
- `callback`: 分析完成回调函数
- `progressCallback`: 进度回调函数（可选）

### 回调函数参数

**分析完成回调参数(result):**
- `success`: 是否分析成功
- `data`: 分析结果数据数组
  - `geometry`: 分析区域几何信息
  - `area`: 分析区域面积
  - `slopeData`: 坡度数据点数组
  - `averageSlope`: 平均坡度
  - `dominantLevel`: 主要坡度等级
  - `samplePointsCount`: 采样点数
- `statistics`: 统计信息
- `levels`: 坡度分级配置

**进度回调参数(progress):**
- `progress`: 进度百分比（0-100）
- `message`: 当前进度描述

## 分析算法流程

1. **预处理分析区域**：验证多边形有效性，确保闭合
2. **生成采样点网格**：根据区域大小自适应生成采样点
3. **获取地形高程**：批量获取每个采样点的地形高程
4. **构建Delaunay三角网**：连接采样点生成三角网
5. **计算坡度**：计算每个三角形的坡度和朝向
6. **可视化**：使用网格线模式展示分析结果
7. **统计分析**：计算平均坡度、主要坡度等级等信息

### 示例展示 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/slope/landSlope.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/slope/landSlope.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>

&emsp; 

&emsp; 

&emsp;