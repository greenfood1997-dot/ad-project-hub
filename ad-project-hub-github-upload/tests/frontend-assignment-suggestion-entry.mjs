import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes("/api/project-assignments/suggestions?projectId="), "assignment panel should call suggestions API");
assert(source.includes("AI 分派建议"), "assignment panel should show AI suggestion card");
assert(source.includes("一键套用推荐"), "assignment panel should allow applying recommendations");
assert(source.includes("SuggestionColumn"), "assignment panel should render recommendation columns");

console.log("frontend assignment suggestion entry passed");
