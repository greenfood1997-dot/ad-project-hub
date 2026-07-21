import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dark = await readFile(new URL("../src/dark-theme.css", import.meta.url), "utf8");
const required = [
  ".overview-layout .metric", ".ai-activity-panel", ".project-detail-section",
  ".upload-modal", ".approval-card", ".closeout-review", ".supplier-card",
  ".client-card", ".collection-script-card", ".management-cost-dashboard",
  ".member-table", ".assignment-accordion", ".feishu-bot-panel",
  ".notification-drawer", ".personal-settings-dialog"
];

for (const selector of required) assert(dark.includes(selector), `dark theme must cover ${selector}`);
assert(dark.includes("background: #111111 !important") && dark.includes("background: #181818 !important"), "dark theme should define primary and secondary surfaces");
assert(dark.includes('background-color: #111111 !important'), "generic lazy-loaded cards, panels and details should receive a dark surface");
assert(dark.includes("input, select, textarea") && dark.includes("::placeholder"), "dark theme should cover controls and placeholders");
assert(dark.includes(".alert-item") && dark.includes(".preview-progress-note") && dark.includes(".preview-warnings"), "dark theme should preserve danger, success and warning semantics");

console.log("dark theme complete coverage passed");
