import { money } from "./format.js";

const chartTextStyle = {
  color: "#4e5969",
  fontFamily: "Inter, PingFang SC, Microsoft YaHei, Arial, sans-serif",
  fontSize: 12
};

export function progressChartOption(projects = []) {
  return {
    tooltip: { trigger: "item" },
    color: ["#3370ff", "#14b8a6", "#f6c453", "#f87171"],
    textStyle: chartTextStyle,
    series: [
      {
        type: "pie",
        radius: ["54%", "72%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#ffffff", borderWidth: 3 },
        label: { color: "#4e5969", fontSize: 12 },
        labelLine: { lineStyle: { color: "#c9d2e3" } },
        data: [
          { value: projects.filter((item) => item.status === "执行中").length, name: "执行中" },
          { value: projects.filter((item) => item.status === "已完成").length, name: "已完成" },
          { value: projects.filter((item) => item.status === "筹备中" || item.status === "草稿").length, name: "筹备中" },
          { value: projects.filter((item) => item.risk === "高").length, name: "高风险" }
        ].filter((item) => item.value > 0)
      }
    ]
  };
}

export function cashChartOption(projects = []) {
  return {
    grid: { left: 46, right: 14, top: 24, bottom: 32 },
    tooltip: { trigger: "axis" },
    textStyle: chartTextStyle,
    xAxis: {
      type: "category",
      data: projects.map((item) => item.client),
      axisLabel: { interval: 0, color: "#6b778c", fontSize: 12 },
      axisLine: { lineStyle: { color: "#d8dee9" } },
      axisTick: { show: false }
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v) => money(v), color: "#6b778c", fontSize: 12 },
      splitLine: { lineStyle: { color: "#edf1f7" } }
    },
    color: ["#3370ff", "#8fb4ff"],
    series: [
      { name: "已回款", type: "bar", data: projects.map((item) => item.paid), barMaxWidth: 22, itemStyle: { borderRadius: [5, 5, 0, 0] } },
      { name: "待回款", type: "bar", data: projects.map((item) => item.receivable), barMaxWidth: 22, itemStyle: { borderRadius: [5, 5, 0, 0] } }
    ]
  };
}

export function costChartOption(projects = []) {
  return {
    grid: { left: 66, right: 34, top: 24, bottom: 24 },
    tooltip: { trigger: "axis" },
    textStyle: chartTextStyle,
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { formatter: "{value}%", color: "#6b778c", fontSize: 12 },
      splitLine: { lineStyle: { color: "#edf1f7" } }
    },
    yAxis: {
      type: "category",
      data: projects.map((item) => item.pm),
      axisLabel: { color: "#6b778c", fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    color: ["#14b8a6"],
    series: [
      {
        type: "bar",
        data: projects.map((item) => item.costBudget ? Math.round((item.costUsed / item.costBudget) * 100) : 0),
        label: { show: true, position: "right", formatter: "{c}%", color: "#4e5969", fontSize: 12 },
        barMaxWidth: 14,
        itemStyle: { borderRadius: [0, 6, 6, 0] }
      }
    ]
  };
}
