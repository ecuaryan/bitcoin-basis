#!/usr/bin/env node
// Supply-chain hygiene check for package-lock.json and package.json files.
// No dependencies. Run from anywhere: `node tools/check-lockfile.mjs`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org/";
const errors = [];
const fail = (msg) => errors.push(msg);

const readJson = (rel) => JSON.parse(readFileSync(join(root, rel), "utf8"));

const lockPath = join(root, "package-lock.json");
if (!existsSync(lockPath)) {
  console.error("FAIL: package-lock.json is missing. Run `npm install` and commit it.");
  process.exit(1);
}

let lock;
try {
  lock = readJson("package-lock.json");
} catch (e) {
  console.error(`FAIL: package-lock.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (lock.lockfileVersion !== 3) {
  fail(`package-lock.json lockfileVersion is ${lock.lockfileVersion}; expected 3.`);
}

const packages = lock.packages ?? {};
for (const [path, pkg] of Object.entries(packages)) {
  if (path === "") continue; // root project
  // Workspace members: the folder entry and its node_modules symlink entry.
  if (pkg.link === true) continue;
  if (!path.includes("node_modules/")) continue; // workspace source folder
  const name = path || "(root)";
  if (typeof pkg.resolved !== "string") {
    fail(`${name}: missing "resolved" URL.`);
  } else if (!pkg.resolved.startsWith(REGISTRY)) {
    fail(`${name}: resolved URL is not ${REGISTRY} (got ${pkg.resolved}).`);
  }
  if (typeof pkg.integrity !== "string" || pkg.integrity === "") {
    fail(`${name}: missing "integrity" hash.`);
  }
}

// Collect manifests: root plus each workspace.
const rootPkg = readJson("package.json");
const manifests = [["package.json", rootPkg]];
const ws = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : (rootPkg.workspaces?.packages ?? []);
for (const w of ws) {
  if (/[*?[\]{}]/.test(w)) {
    fail(`Workspace pattern "${w}" uses a glob; list workspaces explicitly so this check can read them.`);
    continue;
  }
  const rel = join(w, "package.json");
  if (!existsSync(join(root, rel))) {
    fail(`Workspace "${w}" has no package.json.`);
    continue;
  }
  manifests.push([rel, readJson(rel)]);
}

const workspaceNames = new Set(manifests.map(([, m]) => m.name).filter(Boolean));
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

for (const [rel, manifest] of manifests) {
  for (const section of SECTIONS) {
    for (const [dep, spec] of Object.entries(manifest[section] ?? {})) {
      if (workspaceNames.has(dep)) continue; // workspace-local package
      if (typeof spec === "string" && spec.startsWith("workspace:")) continue;
      if (!EXACT.test(spec)) {
        fail(`${rel}: ${section}.${dep} is "${spec}"; use an exact version (e.g. "1.2.3"), no ranges, tags or URLs.`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`check-lockfile: ${errors.length} problem(s) found:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-lockfile: OK (${Object.keys(packages).length - 1} lock entries, ${manifests.length} manifest(s)).`);
