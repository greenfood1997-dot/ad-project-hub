import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('label: "供应商库"'), "navigation should expose supplier library");
assert(source.includes('label: "客户偏好"'), "navigation should expose client preference library");
assert(source.includes("function SupplierLibrary"), "frontend should render supplier library");
assert(source.includes("function ClientLibrary"), "frontend should render client library");
assert(source.includes('/api/suppliers/rate"'), "supplier library should save internal ratings through backend");
assert(source.includes('/api/suppliers/export'), "supplier library should expose supplier settlement export");
assert(source.includes("function downloadFile") && source.includes('"x-user-id": session.id'), "supplier export should download with current user identity");
assert(!source.includes('window.open("/api/suppliers/export"'), "supplier export should not use anonymous window.open");
assert(source.includes("导出结算 CSV"), "supplier library should show export button");
assert(source.includes("星级由合作次数、合作项目数、累计金额和内部评分共同计算"), "supplier library should explain data-first star logic");
assert(source.includes("推荐星级") && source.includes("合作次数") && source.includes("累计金额") && source.includes("内部评分"), "supplier profile should show recommendation evidence");
assert(source.includes('/api/clients/profile"'), "client library should save preferences through backend");
assert(source.includes("复制交接清单"), "client library should allow copying PM handoff checklist");
assert(source.includes("navigator.clipboard.writeText"), "client handoff should use clipboard copy");
assert(source.includes("客户喜欢") && source.includes("客户不喜欢") && source.includes("雷区") && source.includes("交接备注"), "client library should track preferences, dislikes, pitfalls, and handoff notes");

console.log("frontend supplier client entry passed");
