import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const file of ["../src/supplier-client.css", "../src/styles.css"]) {
  const css = await readFile(new URL(file, import.meta.url), "utf8");
  assert(css.includes(".supplier-library .review-summary"), `${file} should scope supplier metrics`);
  assert(css.includes("grid-template-columns: repeat(2, minmax(0, 1fr))"), `${file} should use two readable metric columns`);
  assert(css.includes(".supplier-library .review-summary .mini strong") && css.includes("white-space: nowrap"), `${file} should keep currency values on one line`);
}

console.log("supplier metric layout regression passed");
