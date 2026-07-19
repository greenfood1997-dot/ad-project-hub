import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/AdminMemberPanel.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/member.css", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(shell.includes("memberEditorRef.current?.scrollIntoView"), "editing a member should reveal the editor");
assert(shell.includes("memberEditorRef.current?.querySelector"), "editing a member should focus the first field");
assert(panel.includes('editingId === member.id ? "editing"'), "the selected member should be visibly highlighted");
assert(panel.includes('editingId === member.id ? "编辑中" : "编辑"'), "the selected edit action should show active feedback");
assert(styles.includes(".member-row.editing"), "the selected member should have dedicated edit styling");
assert(styles.includes("72px 72px 64px"), "member rows should reserve a compact sixth column for delete");
assert(panel.includes('className="ghost member-delete-button"'), "split member panel delete should use a compact ghost button");
assert(main.includes('className="ghost member-delete-button"'), "production member delete should use a compact ghost button");
assert(styles.includes("color: #b42318") && styles.includes("background: #fff5f4"), "delete should remain visibly destructive without a large solid red treatment");

console.log("frontend member edit regression passed");
