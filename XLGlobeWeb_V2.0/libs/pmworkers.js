
/**
* https://github.com/pasu/ExamplesforCesium
* get pm index from waqi data
 */
function isNumber(obj) {
	return typeof obj === 'number' && !isNaN(obj)
}
function jskeyOld() {
	return (function() {
	var u = "";
		decodeURIComponent("%603Z3F%7BWS%3AnNyBdITtKTySXYnmecFV0MUeSGoh%5BMh%3E%3E").split('').forEach(function(c) {
		u += String.fromCharCode(c.charCodeAt(0) - 1);
		});
		return u;
	})()
}

function jskey() {
    return (function() {
        var u = "";
        decodeURIComponent("%603Z3F%7BWS%3A3BSBdIRlJTySXYnmecFR%2CF%7BeSGHhkMh%3E%3E").split('').forEach(function(c) {
            u += String.fromCharCode(c.charCodeAt(0) - 1);
        });
        return u;
    })()
}

//var url = "https://wind.waqi.info/mapq/bounds/?bounds={RECTANGLE}&inc=placeholders&k={KEY}&_={DATA}";
var url = "https://api.waqi.info/mapq/bounds/?bounds={RECTANGLE}&inc=placeholders&k={KEY}&_={DATA}";
var strKey = jskey();

var table = [{ level:"一级（优）",influence:"空气质量令人满意，基本无空气污染",suggestion:"	各类人群可正常活动"}, 
		{ level:"二级（良）",influence:"空气质量可接受，但某些污染物可能对极少数异常敏感人群健康有较弱影响",suggestion:"心脏病和肺病患者症状显著加剧，运动耐受力降低，健康人群普遍出现症状"},
		{ level:"三级（轻度污染）",influence:"易感人群症状有轻度加剧，健康人群出现刺激症状",suggestion:"儿童、老年人及心脏病、呼吸系统疾病患者应减少长时间、高强度的户外锻炼"},
		{ level:"四级（中度污染）",influence:"易感人群症状有轻度加剧，健康人群出现刺激症状",suggestion:"儿童、老年人及心脏病、呼吸系统疾病患者避免长时间、高强度的户外锻炼，一般人群适量减少户外运动"},
		{ level:"五级（重度污染）",influence:"心脏病和肺病患者症状显著加剧，运动耐受力降低，健康人群普遍出现症状",suggestion:"儿童、老年人及心脏病、肺病患者应停留在室内，停止户外运动，一般人群减少户外运动"},
		{ level:"六级（严重污染）",influence:"心脏病和肺病患者症状显著加剧，运动耐受力降低，健康人群普遍出现症状",suggestion:"儿童、老年人和病人应停留在室内，避免体力消耗，一般人群避免户外活动"}
		];

var xmlHttpRequest; 
var imgData = null;
var nWidth = 500;		
var date;
function requestJson(bounds,imgbuffer){
    date = (new Date).getTime();
    imgData = imgbuffer;
	var nowUrl = url
				.replace('{RECTANGLE}', bounds)
				.replace('{KEY}', strKey)
				.replace('{DATA}', date);

	xmlHttpRequest = new XMLHttpRequest();   
        
    //2.设置回调函数    	
    xmlHttpRequest.onreadystatechange = callback;    
        
    //3.初始化XMLHttpRequest组建    
    xmlHttpRequest.open("POST",nowUrl,true);    
        
    //4.发送请求    
    xmlHttpRequest.send(null);      

    
}
function callback() {
    if(xmlHttpRequest.readyState == 4 && xmlHttpRequest.status == 200){ 
    	var entityTable = []; 
    	////////////////////////////////////////////////////
    	var currentData = JSON.parse(xmlHttpRequest.responseText);
		for (var i = currentData.length - 1; i >= 0; i--) {
			var color = null;

			var aqi = parseInt(currentData[i].aqi);
			if(!isNumber(aqi))
				continue;

			var level = 0;
			if(aqi>nWidth){
				color = {red:126/255.0,green:0.0,blue:35/255.0};
				level = 5;
				aqi = nWidth-1;
			} 
			else{					
				color = {red:imgData[aqi*4]/255.0,green:imgData[aqi*4+1]/255.0,blue:imgData[aqi*4+2]/255.0};

				if(aqi>300){
					level = 5;
				}
				else if(aqi>200){
					level = 4;
				}
				else if(aqi>150){
					level = 3;
				}
				else if(aqi>100){
					level = 2;
				}
				else if(aqi>50){
					level = 1;
				} 
			}
			if (color) { 
				//var result=currentData[i].city.replace(/[ 　]+(?=[\u4e00-\u9fa5])/g,"");
				var des = '<table class="cesium-infoBox-defaultTable"><tbody>' + '<tr><th>' + "AQI" + '</th><td>' + currentData[i].aqi + '</td></tr>';
				des += '<tr><th>' + "更新时间" + '</th><td>' + currentData[i].utime + '</td></tr>';
				des += '<tr><th>' + "质量" + '</th><td>' + table[level].level + '</td></tr>';
				des += '<tr><th>' + "影响" + '</th><td>' + table[level].influence + '</td></tr>';
				des += '<tr><th>' + "建议" + '</th><td>' + table[level].suggestion + '</td></tr>' + "</tbody></table>";
				//des += "</tbody></table>";

				var entity = {
					lon:currentData[i].lon,
					lat:currentData[i].lat,
					color:color,
					name:currentData[i].city,
					description:des,
					aqiValue:aqi
				};
				entityTable.push(entity);
			}
		}
    	//////////////////////////////////////////////////////
        self.postMessage({date:date,entityTable:entityTable});
    	self.close();          
	}
	else if(xmlHttpRequest.readyState == 4 && xmlHttpRequest.status == 0){
		var entityTable = []; 
		self.postMessage({date:date,entityTable:entityTable});
    	self.close();		
	}
}

onmessage=function(e){
    requestJson(e.data.bounds,e.data.imgData);
};