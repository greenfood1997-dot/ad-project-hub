import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/management.css", import.meta.url), "utf8");

assert(main.includes('import "./management.css"'), "the production entry must load management cockpit styles");
assert(styles.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"), "four management tabs should share one desktop row");
assert(styles.includes(".management-tab-row {\n  grid-column: 1 / -1"), "management tabs should span the full switcher width");
assert(styles.includes(".management-cost-toolbar { display: grid"), "the realtime cost toolbar should use a stable grid layout");
assert(styles.includes("@media (max-width: 980px)"), "management layouts should adapt before reaching mobile width");

console.log("frontend management style entry passed");
