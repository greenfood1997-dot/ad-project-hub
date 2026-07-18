import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(source.includes("后台管理 · 仅管理员可见"), "settings should group administrator-only entries");
assert(source.includes("{isAdmin && <div className=\"personal-settings-group admin-only-settings\">"), "admin settings group must be role-gated");
assert(!source.includes('<Settings2 size={18} />{isAdmin ? "后台管理" : "项目分派"}'), "standalone admin sidebar entry should be removed");
assert(!source.includes('><UserCog size={16} />成员管理</button>}'), "standalone member management header action should be removed");
assert(source.includes("!isAdmin && canManageAssignments"), "directors should retain only their assignment entry");

console.log("frontend settings permission entry passed");
