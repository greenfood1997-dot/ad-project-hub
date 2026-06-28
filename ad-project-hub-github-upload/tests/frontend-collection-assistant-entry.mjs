import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('label: "催收助手"'), "navigation should expose collection assistant");
assert(source.includes("function CollectionAssistant"), "frontend should render collection assistant");
assert(source.includes('/api/collections/suggest"'), "collection assistant should generate scripts through backend");
assert(source.includes('/api/collections/outcome"'), "collection assistant should record outcomes through backend");
assert(source.includes("我的成功率"), "collection assistant should show personal success rate");
assert(source.includes("我的说话风格"), "collection assistant should allow salesperson style input");
assert(source.includes("有效话术参考"), "collection assistant should show successful team script reference");
assert(source.includes("有效") && source.includes("待优化"), "collection assistant should record script outcomes");
assert(source.includes("更像人说话") || source.includes("像人说话"), "collection assistant should focus on human-sounding copy");
assert(source.includes("后续会优先学习"), "successful outcomes should feed future learning");

console.log("frontend collection assistant entry passed");
