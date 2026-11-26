// Which build code made the committed index (issue #95).
//
// The npm package ships the committed index (data/index/), and release.yml publishes whatever
// is committed at the tag. The index is rebuilt by the daily refresh, not by the pull request
// that changes the build code, so for up to a day the code on main can say one thing and the
// index another: after #89 the code mapped Symbol-font "³" to "≥" while the committed index,
// built the morning before, still read "For s ³ 4t".
//
// build-index.js writes data/index-build.json beside the index: a fingerprint of the code that
// built it, and the sha256 of each index file it wrote. scripts/check-index-build.js recomputes
// the fingerprint from the code at the current commit and compares, and release.yml runs it
// before publishing. The record is not in the npm package (package.json `files`), and the
// refresh commits it like the site structure: a change to it alone needs no release.
//
// What the fingerprint covers:
//   - scripts/build-index.js and every repo file it imports, followed through relative imports;
//   - the data files those modules read when they load (BUILD_DATA_FILES, kept honest by a test
//     that fails when a module in the build reads a file it does not declare);
//   - the version, from package-lock.json, of each npm package the build imports, and of the
//     packages those depend on.
// Text files are read with CRLF taken as LF, so a checkout's line endings do not matter.
//
// Node built-ins only: release.yml and the test workflow run this without npm ci.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";

export const RECORD_FORMAT = 1;
/** Where build-index.js writes the record, from the repo root. */
export const RECORD_PATH = "data/index-build.json";
/** The build's entry point, from the repo root. */
export const BUILD_ENTRY = "scripts/build-index.js";
/** The index files and the versions file whose sha256 they carry, from the repo root. */
export const INDEX_JSON_DIR = "data/index/json";

/**
 * Data files a module in the build reads when it runs, by module. A module in the build that
 * calls readFileSync must be listed here (test/index-build-record.test.js), so a new data file
 * cannot change the index without changing the fingerprint. build-index.js itself reads only
 * its inputs (the ZIPs) and the previous versions.json, which are not code.
 */
export const BUILD_DATA_FILES = {
  "scripts/build-index.js": [],
  "scripts/lib/symbol-font.js": ["scripts/vendor/unicode-adobe-symbol/symbol.txt"],
};

const toPosix = (p) => p.split(sep).join("/");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const readText = (abs) => readFileSync(abs, "utf8").replace(/\r\n/g, "\n");

// A relative import anywhere in the file (comments included: following one too many is safe).
const RELATIVE_IMPORT = /(?:\bfrom|\bimport\(|^\s*import)\s*["'](\.{1,2}\/[^"']+)["']/gm;
// A package import: an import or export statement whose specifier is not a path.
const PACKAGE_IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"'./][^"']*)["']|^\s*import\s*["']([^"'./][^"']*)["']|\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/gm;

/** "@scope/name/sub" → "@scope/name"; "name/sub" → "name". */
function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * The repo files and npm packages the build imports, followed from `entry` through relative
 * imports. Throws when an import cannot be followed: a missing file, or a dynamic import of a
 * computed name.
 * @returns {{ files: string[], packages: string[] }} sorted; files are repo-relative paths.
 */
export function importClosure(root, entry = BUILD_ENTRY) {
  const files = new Set();
  const packages = new Set();
  const walk = (abs) => {
    const rel = toPosix(relative(root, abs));
    if (files.has(rel)) return;
    if (!existsSync(abs)) throw new Error(`the build imports ${rel}, which does not exist`);
    files.add(rel);
    const src = readText(abs);
    if (/\bimport\(\s*[^"'\s)]/.test(src)) {
      throw new Error(`${rel} imports a module by a computed name, which the build record cannot follow`);
    }
    for (const m of src.matchAll(RELATIVE_IMPORT)) walk(resolve(dirname(abs), m[1]));
    for (const m of src.matchAll(PACKAGE_IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!isBuiltin(spec)) packages.add(packageName(spec));
    }
  };
  walk(resolve(root, entry));
  return { files: [...files].sort(), packages: [...packages].sort() };
}

/**
 * Each package's version in package-lock.json (lockfileVersion 2 or 3), with the packages it
 * depends on, followed the way Node resolves them (a nested node_modules first).
 * @returns {Record<string, string>} "name" or "parent>name" for a nested copy → version
 */
export function lockedVersions(lock, names) {
  const pkgs = lock?.packages;
  if (!pkgs || typeof pkgs !== "object") throw new Error("package-lock.json has no \"packages\" (lockfileVersion 2 or later)");
  const out = {};
  const seen = new Set();
  const visit = (name, fromPath) => {
    // Node's lookup: <from>/node_modules/<name>, then each parent's, then the top level.
    let path = null;
    for (let base = fromPath; ; ) {
      const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
      if (pkgs[candidate]) {
        path = candidate;
        break;
      }
      if (!base) break;
      const at = base.lastIndexOf("/node_modules/");
      base = at >= 0 ? base.slice(0, at) : "";
    }
    if (!path) throw new Error(`package-lock.json has no entry for ${name}, which the index build needs`);
    if (seen.has(path)) return;
    seen.add(path);
    const entry = pkgs[path];
    out[path.replace(/^node_modules\//, "").replace(/\/node_modules\//g, ">")] = String(entry.version);
    for (const dep of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) visit(dep, path);
  };
  for (const name of names) visit(name, "");
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * What the build is made of at `root`, and its fingerprint.
 * @returns {{ fingerprint: string, files: Record<string, string>, packages: Record<string, string> }}
 *          files: repo path → sha256 of its text; packages: name → locked version
 */
export function buildInputs(root) {
  const closure = importClosure(root);
  const paths = new Set(closure.files);
  for (const f of closure.files) for (const d of BUILD_DATA_FILES[f] ?? []) paths.add(d);
  const files = {};
  for (const p of [...paths].sort()) {
    const abs = join(root, p);
    if (!existsSync(abs)) throw new Error(`the build reads ${p}, which does not exist`);
    files[p] = sha256(readText(abs));
  }
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const packages = lockedVersions(lock, closure.packages);
  const lines = [
    `format ${RECORD_FORMAT}`,
    ...Object.entries(files).map(([p, h]) => `file ${p} ${h}`),
    ...Object.entries(packages).map(([n, v]) => `package ${n} ${v}`),
  ];
  return { fingerprint: sha256(lines.join("\n") + "\n"), files, packages };
}

/**
 * The record build-index.js writes: the build's fingerprint and inputs, and the sha256 of each
 * index file it wrote (the same values as versions.json). Stable key order, so a rebuild with the
 * same code and the same text writes the same bytes.
 * @param {string} root
 * @param {Record<string, { sha256: string }>} versions  the corpora this run built
 */
export function makeRecord(root, versions) {
  const { fingerprint, files, packages } = buildInputs(root);
  const index = Object.fromEntries(
    Object.keys(versions)
      .sort()
      .map((k) => [k, versions[k].sha256])
  );
  return { format: RECORD_FORMAT, fingerprint, files, packages, index };
}

export const recordJson = (record) => JSON.stringify(record, null, 2) + "\n";

/** The differences between two { key: value } maps, as readable lines. */
function diffLines(kind, was, now) {
  const out = [];
  for (const k of Object.keys({ ...was, ...now }).sort()) {
    if (!(k in now)) out.push(`${kind} ${k} is no longer part of the build`);
    else if (!(k in was)) out.push(`${kind} ${k} is new to the build`);
    else if (was[k] !== now[k]) out.push(kind === "package" ? `package ${k} is ${now[k]}, was ${was[k]}` : `${kind} ${k} changed`);
  }
  return out;
}

/**
 * Was the committed index built by the build code at `root`?
 * @returns {{ ok: boolean, problems: string[] }} problems: one plain line each
 */
export function checkIndexBuild(root) {
  const recordPath = join(root, RECORD_PATH);
  if (!existsSync(recordPath)) {
    return {
      ok: false,
      problems: [`${RECORD_PATH} is missing, so nothing says which build code made the committed index (an index built before the record existed has none)`],
    };
  }
  let record;
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8"));
  } catch (e) {
    return { ok: false, problems: [`${RECORD_PATH} is not valid JSON: ${e.message}`] };
  }
  if (record?.format !== RECORD_FORMAT || typeof record.fingerprint !== "string" || !record.index) {
    return { ok: false, problems: [`${RECORD_PATH} is not a format ${RECORD_FORMAT} build record`] };
  }

  const problems = [];
  const now = buildInputs(root);
  if (now.fingerprint !== record.fingerprint) {
    const changes = [...diffLines("file", record.files ?? {}, now.files), ...diffLines("package", record.packages ?? {}, now.packages)];
    problems.push(
      `the build code changed since the committed index was built` + (changes.length ? `: ${changes.join("; ")}` : "")
    );
  }

  // The record must describe this index: the sha256s it wrote, versions.json's, and the files'.
  const versionsPath = join(root, INDEX_JSON_DIR, "versions.json");
  const versions = existsSync(versionsPath) ? JSON.parse(readFileSync(versionsPath, "utf8")) : {};
  const corpora = [...new Set([...Object.keys(record.index), ...Object.keys(versions)])].sort();
  for (const c of corpora) {
    const recorded = record.index[c];
    if (recorded === undefined) {
      problems.push(`${INDEX_JSON_DIR}/versions.json lists ${c}, which ${RECORD_PATH} does not: the record is from another build`);
      continue;
    }
    if (versions[c]?.sha256 !== recorded) {
      problems.push(`${INDEX_JSON_DIR}/versions.json does not have the ${c} sha256 that ${RECORD_PATH} records: the record is from another build`);
    }
    const file = join(root, INDEX_JSON_DIR, `${c}.json`);
    if (!existsSync(file)) problems.push(`${INDEX_JSON_DIR}/${c}.json is missing`);
    else if (sha256(readFileSync(file)) !== recorded) {
      problems.push(`${INDEX_JSON_DIR}/${c}.json is not the file the recorded build wrote (its sha256 differs)`);
    }
  }
  return { ok: problems.length === 0, problems };
}
