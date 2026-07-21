import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(source.includes("function openPersonalSettings()"), "personal settings should use a centralized open action");
assert(source.includes("function openNotifications()"), "notifications should use a centralized open action");
assert(source.includes("setNotificationsOpen(false);\n    setPinDialogOpen(false);\n    setPersonalSettingsOpen(true);"), "opening personal settings must close other drawers and dialogs");
assert(source.includes("setPersonalSettingsOpen(false);\n    setPinDialogOpen(false);\n    setNotificationsOpen(true);"), "opening notifications must close personal settings and PIN dialog");
assert(source.includes("onClick={openPersonalSettings}") && source.includes("onClick={openNotifications}"), "production triggers must use mutually exclusive overlay actions");
assert(source.includes('createPortal(<div className="personal-settings-backdrop"') && source.includes("</div>, document.body)"), "personal settings and PIN overlays must escape the main layout through a body portal");
assert(source.includes('return createPortal(\n    <div className="notification-backdrop"') && source.includes("document.body\n  );"), "notification drawer must escape the main layout through a body portal");

const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const notificationStyles = await readFile(new URL("../src/notification.css", import.meta.url), "utf8");
assert(styles.includes(".personal-settings-backdrop") && styles.includes("align-items: flex-start") && styles.includes("overflow: auto"), "long personal settings must stay inside the viewport and scroll from the top");
assert(notificationStyles.includes("height: 100dvh") && notificationStyles.includes("box-sizing: border-box"), "notification drawer must fit the dynamic viewport without producing a blank overflow area");

console.log("frontend overlay exclusivity regression passed");
