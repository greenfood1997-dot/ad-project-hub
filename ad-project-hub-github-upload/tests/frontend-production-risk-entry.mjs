import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const topbar = await readFile(new URL("../src/DashboardTopbar.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const source of [main, topbar]) {
  assert(source.includes("productionPersistenceReady") && source.includes("filePersistenceReady"), "both dashboard topbar implementations should expose database and file persistence risks");
  assert(source.includes("当前仍是测试级存储") && source.includes("去完成生产配置"), "production risk banner should explain the issue and offer a configuration action");
}
assert(styles.includes(".production-risk-bar"), "production risk banner should have visible warning styles");

console.log("frontend production risk entry passed");
