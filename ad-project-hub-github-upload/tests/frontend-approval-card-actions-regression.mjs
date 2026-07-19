import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/ApprovalFunds.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/approval.css", import.meta.url), "utf8");

assert(source.includes('className="approval-card-actions"') && source.includes(">查看</button>"));
assert.match(styles, /\.approval-card-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
assert.match(styles, /@media \(max-width: 1500px\)[\s\S]*?\.approval-card-actions\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
assert.match(styles, /\.approval-card-actions button\s*\{[^}]*min-width:\s*68px;[^}]*white-space:\s*nowrap;/s);

console.log("frontend approval card actions regression passed");
