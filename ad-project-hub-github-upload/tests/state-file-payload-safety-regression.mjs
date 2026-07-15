import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");
const staticServer = await readFile(new URL("../server/static.mjs", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/ProjectFilesPanel.jsx", import.meta.url), "utf8");
const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");

assert(api.includes("return stripPrivatePayloads(state)"), "all state responses must pass through payload stripping");
for (const key of ["pinHash", "base64", "dataUrl", "binary", "bytes"]) {
  assert(api.includes(`\"${key}\"`), `state payload stripping must cover ${key}`);
}
assert(staticServer.includes('url.pathname.startsWith("/uploads/")') && staticServer.includes("Local uploads are not publicly accessible"), "local uploads must not be exposed by the anonymous static server");
for (const [label, source] of [["split", panel], ["production", main]]) {
  assert(source.includes('!String(file.storageUrl).startsWith("/uploads/")'), `${label} file UI must not create anonymous local upload links`);
  assert(source.includes("本地暂存不可公开访问，需配置对象存储"), `${label} file UI must explain local-only storage`);
}

console.log("state file payload safety regression passed");
