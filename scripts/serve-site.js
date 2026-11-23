#!/usr/bin/env node
// Preview the built site: npm run serve-site [-- --dir _site --port 8080]. Local only (127.0.0.1).
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./lib/site/serve.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const dir = resolve(opt("--dir", join(root, "_site")));
const port = Number(opt("--port", "8080"));
const { url } = await startServer(dir, port);
console.log(`Serving ${dir} at ${url}/ (Ctrl-C to stop)`);
