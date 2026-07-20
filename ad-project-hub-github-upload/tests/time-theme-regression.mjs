import assert from "node:assert/strict";
import { applyColorScheme, readThemePreferences, resolvedColorScheme } from "../src/utils/theme.js";

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
console.log("time theme regression passed");
