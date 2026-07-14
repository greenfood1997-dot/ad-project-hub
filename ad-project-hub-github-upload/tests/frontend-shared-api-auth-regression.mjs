import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/utils/api.js", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(source.includes('authorization: `Bearer ${session.token || ""}`'), "shared API requests and downloads must carry the production Bearer token");
assert(source.match(/authorization: `Bearer \$\{session\.token \|\| ""\}`/g)?.length >= 2, "both JSON requests and file downloads must authenticate with Bearer tokens");
assert(source.includes('"x-user-id": session.id'), "shared API helper should keep non-production regression compatibility");

console.log("frontend shared API auth regression passed");
