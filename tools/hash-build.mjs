#!/usr/bin/env node
// Writes dist-hashes.txt: the sha256 of every file in app/dist, sorted by path, plus one combined hash.
// Format is `sha256sum` compatible: "<hex>  <path>" per line, with "#" comment lines first.
//   node tools/hash-build.mjs [distDir=app/dist] [outFile=dist-hashes.txt]
// The combined hash is the sha256 of the sorted "<hex>  <path>\n" lines (comments excluded).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** All files under dir, as forward-slash relative paths, sorted bytewise. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function hashDir(dir) {
  const files = listFiles(dir).map((path) => ({ path, sha256: sha256Hex(readFileSync(join(dir, path))) }));
  const body = files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
  return { files, body, combined: sha256Hex(body) };
}

export function formatHashes({ body, combined, files }) {
  return `# Bitcoin Basis build hashes (sha256), ${files.length} files\n# combined: ${combined}\n${body}`;
}

/** Parse a hashes file into { files: Map(path -> hex), combined }. Throws on malformed lines. */
export function parseHashes(text) {
  const files = new Map();
  let combined = null;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const meta = /^# combined: ([0-9a-f]{64})$/.exec(line);
    if (meta) combined = meta[1];
    if (line.startsWith("#")) continue;
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) throw new Error(`Malformed hashes line: ${line}`);
    files.set(m[2], m[1]);
  }
  if (files.size === 0) throw new Error("No hashes found");
  if (combined) {
    const body = [...files].map(([p, h]) => `${h}  ${p}\n`).join("");
    if (sha256Hex(body) !== combined) throw new Error("Combined hash does not match the file list (file edited or not sorted)");
  }
  return { files, combined };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = resolve(process.argv[2] ?? join(root, "app", "dist"));
  const out = resolve(process.argv[3] ?? join(root, "dist-hashes.txt"));
  const result = hashDir(dist);
  if (result.files.length === 0) {
    console.error(`No files in ${dist}. Run \`npm run build\` first.`);
    process.exit(1);
  }
  writeFileSync(out, formatHashes(result));
  console.log(`Hashed ${result.files.length} files. Combined sha256: ${result.combined}`);
  console.log(`Wrote ${out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
