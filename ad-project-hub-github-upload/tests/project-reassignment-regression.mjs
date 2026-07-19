import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("../src/ProjectAssignmentPanel.jsx", import.meta.url), "utf8");
const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");

assert(panel.includes("selected?.pm") && panel.includes("selected?.sales") && panel.includes("JSON.stringify(selected?.members || [])"), "assignment form must rehydrate when the same project receives a refreshed roster");
assert(api.includes("member.projectId !== project.id && member.project !== project.name"), "reassignment must replace all previous project roster rows");
assert(api.includes("items: [...scopedOut, ...assignmentRows]"), "reassignment must persist only the new roster for the project");

console.log("project reassignment regression passed");
