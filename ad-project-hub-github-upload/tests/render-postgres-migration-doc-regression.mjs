import { readFile } from "node:fs/promises";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const guide = await readFile(new URL("../RENDER_POSTGRES_MIGRATION.md", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(readme.includes("/api/health") && readme.includes("storageMode") && readme.includes("RENDER_POSTGRES_MIGRATION.md"), "README should point PostgreSQL verification to the real health payload and migration guide");
assert(guide.includes("导出 OA 备份") && guide.includes("校验备份 JSON"), "migration guide should require a backup and dry-run validation first");
assert(guide.includes("Internal Database URL") && guide.includes("DATABASE_URL"), "migration guide should explain Render database wiring");
assert(guide.includes('"storageMode": "postgres"') && guide.includes('"databaseUrl": true'), "migration guide should provide the real PostgreSQL health check criteria");
assert(guide.includes("确认恢复OA备份") && guide.includes("备份中新出现的成员会以停用状态恢复"), "migration guide should document restore confirmation and safe member handling");
assert(guide.includes("OA_BOOTSTRAP_ADMIN_PIN") && guide.includes("要求首次登录改密") && guide.includes("删除 `OA_BOOTSTRAP_ADMIN_PIN`"), "migration guide should document the one-time secure admin bootstrap lifecycle");
assert(guide.includes("Manual Deploy") && guide.includes("项目数据仍存在"), "migration guide should include post-deploy durability verification");

console.log("render postgres migration doc regression passed");
