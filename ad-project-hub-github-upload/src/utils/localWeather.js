import { useEffect, useState } from "react";

const labels = { 0: "晴", 1: "大部晴朗", 2: "多云", 3: "阴", 45: "有雾", 48: "雾凇", 51: "小毛毛雨", 53: "毛毛雨", 55: "较强毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 73: "中雪", 75: "大雪", 80: "阵雨", 81: "较强阵雨", 82: "强阵雨", 95: "雷雨" };

export function useLocalWeather() {
  const [text, setText] = useState("正在读取你的位置和天气…");

  useEffect(() => {
    if (!navigator.geolocation) { setText("当前浏览器不支持位置读取"); return; }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const latitude = coords.latitude.toFixed(4);
        const longitude = coords.longitude.toFixed(4);
        const [weatherResponse, placeResponse] = await Promise.all([
          fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`),
          fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=zh`)
        ]);
        if (!weatherResponse.ok) throw new Error("天气服务暂不可用");
        const weather = await weatherResponse.json();
        const place = placeResponse.ok ? await placeResponse.json() : {};
        const city = place.city || place.locality || place.principalSubdivision || "当前位置";
        const temperature = Math.round(Number(weather.current?.temperature_2m));
        const condition = labels[weather.current?.weather_code] || "天气实时更新";
        setText(`${city} ${Number.isFinite(temperature) ? `${temperature}°C · ` : ""}${condition}`);
      } catch (error) {
        setText(error.message || "实时天气读取失败");
      }
    }, (error) => setText(error.code === 1 ? "未开启定位，无法显示当地天气" : "当前位置读取失败"), {
      enableHighAccuracy: false, timeout: 10000, maximumAge: 15 * 60 * 1000
    });
  }, []);

  return text;
}
