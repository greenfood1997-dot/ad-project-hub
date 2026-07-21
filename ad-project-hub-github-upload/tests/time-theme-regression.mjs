import assert from "node:assert/strict";
import { applyColorScheme, readThemePreferences, resolvedColorScheme } from "../src/utils/theme.js";
import { readFile } from "node:fs/promises";

const atShanghaiHour = (hour) => new Date(`2026-07-20T${String((hour + 16) % 24).padStart(2, "0")}:00:00.000Z`);
assert.equal(resolvedColorScheme("auto", atShanghaiHour(7)), "light");
assert.equal(resolvedColorScheme("auto", atShanghaiHour(18)), "light");
assert.equal(resolvedColorScheme("auto", atShanghaiHour(19)), "dark");
assert.equal(resolvedColorScheme("auto", atShanghaiHour(6)), "dark");
assert.equal(resolvedColorScheme("light", atShanghaiHour(23)), "light");
assert.equal(resolvedColorScheme("dark", atShanghaiHour(12)), "dark");
assert.equal(readThemePreferences({ getItem: () => "{}" }).colorMode, "auto");
const target = { dataset: {}, style: {} };
assert.equal(applyColorScheme({ colorMode: "dark" }, target), "dark");
assert.equal(target.dataset.colorScheme, "dark");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const darkStyles = await readFile(new URL("../src/dark-theme.css", import.meta.url), "utf8");
const finalNightPalette = styles.slice(styles.lastIndexOf("/* Final night palette"));
assert(finalNightPalette.includes("background: #000000 !important") && finalNightPalette.includes(".sidebar") && finalNightPalette.includes("color: #ffffff !important"), "final dark override should enforce black surfaces and white text after legacy styles");
for (const moduleName of ["approval-workbench", "supplier-library", "client-library", "management-cost-dashboard", "feishu-bot-panel", "upload-modal", "notification-drawer", "project-cleanup-panel"]) assert(darkStyles.includes(moduleName), `dark theme should cover ${moduleName}`);
assert(darkStyles.includes(".notification-trigger.has-items") && darkStyles.includes(":where(.fresh, .selected, .active)"), "dark theme should override high-priority light state styles");
assert(darkStyles.includes(".personal-preference-group label") && darkStyles.includes(".personal-preference-group select"), "personal appearance controls should use dark surfaces instead of fixed white rows");
for (const [file, selectors] of [
  ["management.css", [".cash-formula-card span", ".cash-settings-preview.danger", 'body[data-color-scheme="dark"] .management-cost-dashboard', "background-image: none !important"]],
  ["supplier-client.css", [".client-handoff-actions p", ".client-library .review-summary .mini strong", "repeat(3, minmax(180px, 1fr))"]],
  ["closeout.css", [".closeout-complete-box", ".closeout-complete-box textarea", ".feature-panel .closeout-complete-box"]],
  ["collection.css", ['body[data-color-scheme="dark"] .collection-workbench', ".collection-script-card.fresh"]],
  ["ai.css", [".ai-feed-item p", ".ai-workbench .chat-input"]]
]) {
  const moduleStyles = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  for (const selector of selectors) assert(moduleStyles.includes(selector), `${file} should cover screenshot regression selector ${selector}`);
}
console.log("time theme regression passed");
