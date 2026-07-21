import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(source.includes("function openPersonalSettings()"), "personal settings should use a centralized open action");
assert(source.includes("function openNotifications()"), "notifications should use a centralized open action");
assert(source.includes("setNotificationsOpen(false);\n    setPinDialogOpen(false);\n    setPersonalSettingsOpen(true);"), "opening personal settings must close other drawers and dialogs");
assert(source.includes("setPersonalSettingsOpen(false);\n    setPinDialogOpen(false);\n    setNotificationsOpen(true);"), "opening notifications must close personal settings and PIN dialog");
assert(source.includes("onClick={openPersonalSettings}") && source.includes("onClick={openNotifications}"), "production triggers must use mutually exclusive overlay actions");

console.log("frontend overlay exclusivity regression passed");
