import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const rootDir = fileURLToPath(new URL("..", import.meta.url));
export const envFile = join(rootDir, ".env");

export function parseEnvContent(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key) continue;

    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }
  return values;
}

export function loadEnv() {
  if (!existsSync(envFile)) return {};

  const values = parseEnvContent(readFileSync(envFile, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return values;
}

loadEnv();
