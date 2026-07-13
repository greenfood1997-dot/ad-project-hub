import { readdir, readFile } from "node:fs/promises";

const sourceDir = new URL("../src/", import.meta.url);
const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".jsx"));
const missing = [];

for (const file of files) {
  const source = await readFile(new URL(file, sourceDir), "utf8");
  if (!source.includes('from "react"') && !source.includes("from 'react'")) {
    missing.push(file);
  }
}

if (missing.length) {
  throw new Error(`JSX modules must import React runtime to avoid production white screens: ${missing.join(", ")}`);
}

console.log("frontend react runtime imports regression passed");
