import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const file of ["src/BackupRestorePanel.jsx", "src/main.jsx"]) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  assert(source.includes("原始合同/发票不写入备份"), `${file} must explain original file handling`);
  assert(source.includes("备份中新成员会先停用"), `${file} must explain restored member handling`);
  assert(source.includes("对象存储长期保存"), `${file} must explain the object storage dependency`);
}

console.log("frontend backup safety entry passed");
