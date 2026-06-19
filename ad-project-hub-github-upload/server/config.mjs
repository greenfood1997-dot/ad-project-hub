import { join } from "node:path";
import { rootDir } from "./env.mjs";

export { rootDir };
export const dataDir = join(rootDir, "data");
export const uploadDir = join(rootDir, "uploads");
export const dbFile = join(dataDir, "db.json");
const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
export const host = isRender ? "0.0.0.0" : process.env.HOST || "0.0.0.0";
export const port = Number(process.env.PORT || 10000);
