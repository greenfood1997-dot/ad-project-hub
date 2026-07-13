import { readFile } from "node:fs/promises";

const frontend = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const backend = await readFile(new URL("../server/api.mjs", import.meta.url), "utf8");

function unique(values) {
  return [...new Set(values)].sort();
}

function normalizeRoute(route) {
  return route.replace(/\$\{[^}]+\}/g, ":param");
}

function collectFrontendRoutes(source) {
  const routes = [];
  const routeLiteral = /["'`]((?:\/api\/)[^"'`\s)]+)["'`]/g;
  let match;
  while ((match = routeLiteral.exec(source))) {
    const route = normalizeRoute(match[1]);
    if (!route.includes(":param")) routes.push(route);
  }
  return unique(routes);
}

function collectBackendRoutes(source) {
  const routes = [];
  const routeCheck = /url\.pathname\s*===\s*["'`](\/api\/[^"'`]+)["'`]/g;
  let match;
  while ((match = routeCheck.exec(source))) routes.push(match[1]);
  return unique(routes);
}

const frontendRoutes = collectFrontendRoutes(frontend);
const backendRoutes = collectBackendRoutes(backend);
const backendSet = new Set(backendRoutes);
const missing = frontendRoutes.filter((route) => !backendSet.has(route));

if (missing.length) {
  console.error("Frontend calls API routes that backend does not register:");
  for (const route of missing) console.error(`- ${route}`);
  process.exit(1);
}

console.log(`api route coverage passed: ${frontendRoutes.length} frontend routes covered by ${backendRoutes.length} backend routes`);
