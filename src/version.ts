import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The server reports the package's own version in serverInfo, read from the
// package.json that ships alongside dist/ (it was hard-coded "0.1.0" through
// 0.2.0 — issue #26).
export const PACKAGE_VERSION: string = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf8")
).version;
