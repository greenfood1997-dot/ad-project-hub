import { readFile } from "node:fs/promises";

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const loginSource = await readFile(new URL("../src/LoginScreen.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/login.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(mainSource.includes('const LoginScreen = lazy(() => import("./LoginScreen.jsx"))'), "login screen should be lazy-loaded");
assert(loginSource.includes("export default function LoginScreen({ onLogin, sessionKey })"), "login screen component should exist");
assert(loginSource.includes('fetch("/api/auth/login"'), "login screen should call the real login API");
assert(loginSource.includes("localStorage.setItem(sessionKey") && loginSource.includes("onLogin(payload.data)"), "login should persist the session and enter the app");
assert(loginSource.includes('className="login-page"') && loginSource.includes('className="login-panel"') && loginSource.includes('className="input-row"'), "login screen should render stable login classes");
assert(loginSource.includes("默认管理员：admin@company.local / 123456"), "login screen should keep onboarding hint for first setup");
assert(mainSource.includes("sessionKey={SESSION_KEY}"), "app shell should pass the shared session storage key into login screen");
assert(loginSource.includes('import "./login.css";'), "login screen should import login styles with its lazy-loaded component");
assert(styles.includes(".login-page") && styles.includes(".login-panel") && styles.includes(".input-row") && styles.includes(".login-hint"), "login styles should cover page, panel, input rows, and hint");

console.log("frontend login entry passed");
