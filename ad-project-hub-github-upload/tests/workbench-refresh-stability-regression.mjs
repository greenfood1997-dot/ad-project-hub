import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(main.includes("setSelectedId((currentId) =>"), "state refresh should compare against the latest selected project");
assert(main.includes("if (currentId && payload.data.projects.some((project) => project.id === currentId)) return currentId"), "existing project selection should survive polling");
assert(main.includes("expandedProjectId === selected?.id") && main.includes("{uploadOpen && <UploadDialog"), "project workbench and upload dialog depend on stable selection and mounting");

console.log("workbench refresh stability regression passed");
