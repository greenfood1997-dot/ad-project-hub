import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const aiStyles = await readFile(new URL("../src/ai.css", import.meta.url), "utf8");

assert.match(styles, /main\.dashboard-main\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s);
assert.match(styles, /\.overview-layout\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
assert.match(styles, /\.overview-center\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*auto;/s);
assert.match(styles, /\.ai-activity-panel\s*\{[^}]*grid-template-rows:[^}]*minmax\(0, 1fr\) auto;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
assert.match(styles, /\.ai-feed\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s);
assert.match(aiStyles, /\.overview-layout\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);

console.log("frontend dashboard viewport regression passed");
