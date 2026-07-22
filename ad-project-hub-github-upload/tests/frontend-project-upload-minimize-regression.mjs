import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sources = await Promise.all([
  readFile(new URL("../src/ProjectDetail.jsx", import.meta.url), "utf8"),
  readFile(new URL("../src/main.jsx", import.meta.url), "utf8"),
]);

for (const source of sources) {
  assert(source.includes('const [quickUploadMinimized, setQuickUploadMinimized] = useState(false)'), "project upload should own minimized state");
  assert(source.includes("minimized={quickUploadMinimized}"), "project upload should pass minimized state to the dialog");
  assert(source.includes("onMinimize={() => setQuickUploadMinimized(true)}"), "project upload should wire the minimize action");
  assert(source.includes("onExpand={() => setQuickUploadMinimized(false)}"), "project upload should wire the restore action");
}

console.log("frontend project upload minimize regression passed");
