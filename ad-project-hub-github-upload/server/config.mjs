import { join } from "node:path";
import { rootDir } from "./env.mjs";

export { rootDir };
export const dataDir = join(rootDir, "data");
export const uploadDir = join(rootDir, "uploads");
export const dbFile = join(dataDir, "db.json");
export const host = process.env.HOST || "0.0.0.0";
export const port = Number(process.env.PORT || 10000);
