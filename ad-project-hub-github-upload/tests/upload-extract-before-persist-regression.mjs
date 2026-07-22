import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const services = await readFile(new URL("../server/services.mjs", import.meta.url), "utf8");
const start = services.indexOf("async function normalizeUploadedFiles");
const end = services.indexOf("function tableRowsToText", start);
const normalizer = services.slice(start, end);

assert(normalizer.indexOf("extractFileContent(withId)") < normalizer.indexOf("persistLocalUploadFile(withId"), "file bytes must be extracted before persistence removes them");

console.log("upload extract before persist regression passed");
