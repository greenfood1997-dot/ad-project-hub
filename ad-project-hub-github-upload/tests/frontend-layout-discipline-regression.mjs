import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(styles.includes("body {\n  overflow-x: hidden"), "the application must not expose horizontal page overflow");
assert(styles.includes(".sidebar {\n  position: sticky") && styles.includes("height: 100vh"), "desktop navigation should scroll independently and stay available");
assert(styles.includes(".topbar {\n  position: sticky"), "page actions should remain reachable on long screens");
assert(styles.includes("main {\n  width: 100%") && styles.includes("max-width: 1600px"), "main pages should share one bounded content width");
assert(styles.includes("overflow-wrap: anywhere"), "long project names and service values must wrap instead of stretching cards");
assert(styles.includes("@media (max-width: 760px)") && styles.includes("position: static"), "sticky desktop regions should return to normal flow on small screens");

console.log("frontend layout discipline regression passed");
