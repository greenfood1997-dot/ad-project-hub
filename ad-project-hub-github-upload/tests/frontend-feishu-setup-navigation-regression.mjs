import assert from "node:assert/strict";
import fs from "node:fs";

const admin = fs.readFileSync(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../src/FeishuBotPanel.jsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/IntegrationSettingsPanel.jsx", import.meta.url), "utf8");

assert(panel.includes("onConfigureField?.(field)"), "setup checklist should navigate to the missing credential field");
assert(admin.includes('setOpenProductSection("collaboration")'), "credential action should open collaboration settings");
assert(settings.includes('data-feishu-field={key}') && settings.includes("scrollIntoView") && settings.includes("input?.focus"), "Feishu settings should reveal, scroll to, and focus the requested field");
assert(settings.includes('key === "appSecret" || key === "verificationToken" ? "password"'), "sensitive Feishu credentials should be masked");

console.log("frontend Feishu setup navigation regression passed");
