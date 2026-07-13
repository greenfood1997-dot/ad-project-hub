import { readFile } from "node:fs/promises";

const adminSource = await readFile(new URL("../src/AdminShell.jsx", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../src/InterestRatePanel.jsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/admin-settings.css", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(adminSource.includes('const InterestRatePanel = React.lazy(() => import("./InterestRatePanel.jsx"))'), "admin settings should lazy-load the interest rate panel");
assert(adminSource.includes('api("/api/settings/interest-rate/refresh"'), "admin settings should call the real interest rate refresh API");
assert(adminSource.includes("const [refreshingInterestRate, setRefreshingInterestRate]"), "interest rate refresh should show a loading state");
assert(adminSource.includes("联网未成功，已继续使用兜底利率"), "interest rate refresh should explain fallback behavior");
assert(panelSource.includes("利率与垫资成本") && panelSource.includes("刷新 1 年期 LPR"), "interest rate panel should show current rate and a clear refresh action");
assert(panelSource.includes("不会改动既有项目账"), "interest rate panel should explain that historical project ledgers stay unchanged");
assert(styles.includes(".interest-rate-panel") && styles.includes(".interest-rate-values"), "interest rate panel should have responsive styles");

console.log("frontend interest rate entry passed");
