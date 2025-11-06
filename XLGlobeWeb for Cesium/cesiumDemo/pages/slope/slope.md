# 地形坡度分析

地形坡度分析是一种重要的地形分析功能，用于计算和可视化地形表面的坡度信息。本功能基于Cesium实现，能够在3D场景中高效地分析地形坡度并以热力图形式展示。

## 功能特性

- 基于Cesium的地形数据进行实时坡度计算
- 支持自定义采样密度和最大采样点数
- 提供进度回调功能，实时反馈分析进度
- 坡度分级颜色可视化，直观展示不同坡度区域
- 支持清除分析结果，恢复原始视图

## 坡度分级标准

| 坡度范围 | 类型 | 颜色 |
|---------|------|------|
| 0°-2°   | 平坡 | 绿色 |
| 2°-5°   | 缓坡 | 浅绿色 |
| 5°-8°   | 微坡 | 黄色 |
| 8°-15°  | 中坡 | 橙色 |
| 15°-25° | 陡坡 | 橙红色 |
| 25°以上 | 极陡坡 | 红色 |

## 使用方法

### 1. 创建实例

```javascript
import SlopeAnalysisTool from './slope.js';

// 初始化Cesium Viewer
const viewer = new Cesium.Viewer('cesiumContainer');

// 创建坡度分析工具实例
const slopeTool = new SlopeAnalysisTool(viewer, {
    maxSamplePoints: 3000,  // 最大采样点数
    sampleDistance: 0.005   // 采样间隔（经纬度度数）
});
```

### 2. 执行坡度分析

```javascript
// 定义分析区域的边界（经纬度范围）
const bounds = {
    west: 113.8,  // 西边界
    south: 29.8,  // 南边界
    east: 114.2,  // 东边界
    north: 30.2   // 北边界
};

// 执行坡度分析
slopeTool.analyzeSlope(bounds, {
    onProgress: (progress) => {
        console.log(`分析进度: ${Math.round(progress * 100)}%`);
    },
    onComplete: (result) => {
        console.log('分析完成，结果:', result);
    }
});
```

### 3. 进度回调

```javascript
// 分析过程中实时获取进度
slopeTool.analyzeSlope(bounds, {
    onProgress: (progress, current, total) => {
        // 更新进度条或显示进度信息
        updateProgressBar(progress * 100);
        console.log(`已处理 ${current}/${total} 个采样点`);
    }
});
```

### 4. 清除分析结果

```javascript
// 清除所有坡度分析结果和图形
slopeTool.clearAnalysis();
```

## 核心参数说明

### SlopeAnalysisTool构造函数参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| viewer | Cesium.Viewer | 必填 | Cesium Viewer实例 |
| options | Object | {} | 配置选项 |
| options.maxSamplePoints | Number | 3000 | 最大采样点数，防止内存溢出 |
| options.sampleDistance | Number | 0.005 | 采样间隔，单位为经纬度度数 |
| options.minHeight | Number | -10000 | 最小高度值 |
| options.maxHeight | Number | 10000 | 最大高度值 |

### analyzeSlope方法参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| bounds | Object | 必填 | 分析区域边界对象 |
| bounds.west | Number | 必填 | 西边界经度 |
| bounds.south | Number | 必填 | 南边界纬度 |
| bounds.east | Number | 必填 | 东边界经度 |
| bounds.north | Number | 必填 | 北边界纬度 |
| callbacks | Object | {} | 回调函数对象 |
| callbacks.onProgress | Function | null | 进度回调函数 |
| callbacks.onComplete | Function | null | 完成回调函数 |

## 分析算法流程

1. 根据指定的边界和采样间隔生成采样点网格
2. 限制采样点总数不超过最大采样点数
3. 对每个采样点获取地形高度值
4. 构建Delaunay三角网进行插值计算
5. 根据高程差计算每个三角面的坡度
6. 将坡度值映射到对应的颜色
7. 生成并显示坡度热力图

## 常见问题

1. **分析区域过大导致性能问题**
   - 解决方案：减小分析区域或增大采样间隔

2. **某些区域坡度显示不准确**
   - 解决方案：确保地形数据源分辨率足够，或减小采样间隔

3. **浏览器内存不足**
   - 解决方案：减小最大采样点数或分析区域

## 示例展示 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/slope/landSlope.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/slope/landSlope.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>

&emsp; 

&emsp; 

&emsp; 
