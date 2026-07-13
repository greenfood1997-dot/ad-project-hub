import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(!source.includes('import * as echarts from "echarts"'), "ECharts should not be loaded in the first page bundle");
assert(source.includes('const echarts = await import("echarts")'), "ECharts should lazy-load only when chart panels mount");
assert(source.includes("function LazyChart({ option })"), "dashboard charts should render through the lazy chart component");
assert(source.includes("chart?.dispose()") && source.includes('window.removeEventListener("resize", onResize)'), "lazy charts should clean up chart instances and resize listeners");
assert(source.includes("const cashOption = useMemo") && source.includes("const progressOption = useMemo") && source.includes("const costOption = useMemo"), "chart options should be memoized instead of recreated through callback refs");

console.log("frontend performance entry passed");
