import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const path of ["../src/ai.css", "../src/styles.css"]) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  assert.match(source, /@media \(max-height: 900px\)[\s\S]*?\.ai-activity-panel:not\(\.collapsed\)[^{]*\{[^}]*minmax\(160px, 1fr\)/);
  assert.match(source, /\.ai-activity-panel \.ai-feed\s*\{\s*min-height:\s*160px;/);
  assert.match(source, /\.ai-quick-tags[^}]*grid-template-columns:\s*repeat\(4/);
}

console.log("frontend AI chat height regression passed");
