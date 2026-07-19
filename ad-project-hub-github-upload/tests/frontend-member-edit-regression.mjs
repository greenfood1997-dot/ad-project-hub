import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/AdminMemberPanel.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/member.css", import.meta.url), "utf8");

assert(shell.includes("memberEditorRef.current?.scrollIntoView"), "editing a member should reveal the editor");
assert(shell.includes("memberEditorRef.current?.querySelector"), "editing a member should focus the first field");
assert(panel.includes('editingId === member.id ? "editing"'), "the selected member should be visibly highlighted");
assert(panel.includes('editingId === member.id ? "编辑中" : "编辑"'), "the selected edit action should show active feedback");
assert(styles.includes(".member-row.editing"), "the selected member should have dedicated edit styling");

console.log("frontend member edit regression passed");
