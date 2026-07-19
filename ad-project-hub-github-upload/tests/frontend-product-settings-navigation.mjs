import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/admin-settings.css", import.meta.url), "utf8");

assert(shell.includes("PRODUCT_SETTING_SECTIONS") && shell.includes('aria-label="产品设置分类"'), "product settings should expose a category navigation");
assert(shell.includes("if (openSection !== id) return null"), "only the selected setting page should render");
assert(shell.includes("每次只处理一类设置"), "the category navigation should explain the focused interaction");
assert(styles.includes("grid-template-columns: 250px minmax(0, 1fr)"), "desktop settings should use navigation and content columns");
assert(styles.includes("overflow-x: auto"), "mobile settings categories should remain usable in a horizontal scroller");

console.log("frontend product settings navigation passed");
