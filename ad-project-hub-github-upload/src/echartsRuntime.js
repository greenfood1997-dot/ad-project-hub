import * as echarts from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export default echarts;
