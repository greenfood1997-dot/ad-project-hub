import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const chart = await readFile(new URL("../src/LazyChart.jsx", import.meta.url), "utf8");

assert(main.includes("containLabel: true"), "cash chart should reserve space for axis labels");
assert(main.includes("amount / 10000") && main.includes("amount / 1000000"), "large currency labels should use compact units");
assert(main.includes('overflow: "truncate"') && main.includes("slice(0, 9)"), "long client labels should truncate predictably");
assert(chart.includes('"ResizeObserver" in window') && chart.includes("resizeObserver.observe(node)"), "charts should resize when the dashboard or AI rail changes width");

console.log("dashboard chart label regression passed");
