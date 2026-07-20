export const THEME_PREFERENCE_KEY = "ad-project-hub-preferences";

export function shanghaiHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", hourCycle: "h23" }).format(date));
}

export function resolvedColorScheme(mode = "auto", date = new Date()) {
  if (mode === "light" || mode === "dark") return mode;
  const hour = shanghaiHour(date);
  return hour >= 19 || hour < 7 ? "dark" : "light";
}

export function readThemePreferences(storage = globalThis.localStorage) {
  try {
    return { language: "zh-CN", fontSize: "standard", theme: "default", colorMode: "auto", ...JSON.parse(storage?.getItem(THEME_PREFERENCE_KEY) || "{}") };
  } catch {
    return { language: "zh-CN", fontSize: "standard", theme: "default", colorMode: "auto" };
  }
}

export function applyColorScheme(preferences, target = document.body, date = new Date()) {
  if (!target) return "light";
  const scheme = resolvedColorScheme(preferences?.colorMode, date);
  target.dataset.colorScheme = scheme;
  target.style.colorScheme = scheme;
  return scheme;
}
