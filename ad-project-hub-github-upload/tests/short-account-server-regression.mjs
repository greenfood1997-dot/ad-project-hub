import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
assert.match(api, /function findLoginAccount[\s\S]*email\.endsWith\("@feishu\.local"\)[\s\S]*shortMatches\.length === 1/);
assert.match(api, /const account = findLoginAccount\(snapshot\.users, body\.email \|\| body\.account\)/);
console.log("short account server regression passed");
