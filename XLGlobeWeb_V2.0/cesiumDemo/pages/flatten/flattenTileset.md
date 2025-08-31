## 模型压平

本文将介绍如何在Cesium中添加天地图服务，天地图是国家地理信息公共服务平台，提供了丰富的地图服务资源。通过集成天地图服务，可以为您的Cesium应用提供高质量的地图底图。

## 天地图服务类型

天地图提供了多种类型的地图服务：
- **影像地图**：高分辨率的卫星影像
- **矢量地图**：包含道路、地名等矢量要素
- **地形地图**：显示地形起伏和地貌特征
- **注记图层**：地名、道路名称等标注信息

## 添加天地图服务示例

``` js

```

## 天地图服务配置说明
天地图服务URL包含以下参数：
- `SERVICE=WMTS`：服务类型为WMTS
- `REQUEST=GetTile`：请求类型为获取瓦片
- `VERSION=1.0.0`：服务版本
- `LAYER=img/cia`：图层类型（img为影像，cia为注记）
- `TILEMATRIXSET=w`：瓦片矩阵集
- `FORMAT=tiles`：格式为瓦片


### 示例展示 <p align="right"><a href="#/deveditor?examplePath=/cesiumDemo/pages/flatten/flattenTileset.html" target="_blank">Demo</a></p>

<iframe width="100%" height="430" src="#/deveditor?examplePath=/cesiumDemo/pages/flatten/flattenTileset.html" allowfullscreen="allowfullscreen" frameborder="0"></iframe>

&emsp; 

&emsp; 

&emsp; 