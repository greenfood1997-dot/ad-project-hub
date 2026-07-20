import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const settings = await readFile(new URL("../server/settings-service.mjs", import.meta.url), "utf8");
const admin = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/AiSettingsPanel.jsx", import.meta.url), "utf8");

assert(api.includes('"API Key": snapshot.settings?.aiService?.["API Key"] || ""'), "AI test should reuse the stored key when the form is blank");
assert(api.includes('"API Key": undefined') && api.includes("configured: Boolean(data[\"API Key\"]"), "AI save responses must not return the stored key");
assert(settings.includes('key !== "API Key"'), "blank AI keys should preserve the stored secret");
assert(admin.includes('...(settings.aiService || {}), "API Key": ""'), "loading saved AI settings must clear any typed key from browser state");
assert(panel.includes("已安全保存；留空继续使用原 Key"), "AI form should explain the safe blank-key behavior");

console.log("AI settings secret regression passed");
