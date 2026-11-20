#!/usr/bin/env node
// Checks that a live deployment serves exactly the files in a dist-hashes.txt.
//   node tools/verify-deployment.mjs <url> [--hashes dist-hashes.txt] [--all] [--retries 5]
// Default: fetch the live index.html and every local asset it references, and compare each sha256.
// --all: fetch every file listed in the hashes file (except _headers, which Cloudflare consumes).
// Also fails if index.html references a local file that the hashes file does not list.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHashes, sha256Hex } from "./hash-build.mjs";

/** Local (same-origin, absolute-path) URLs referenced by src/href attributes, without query or fragment. */
export function extractRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/<(?:script|link|img|source)\b[^>]*>/gi)) {
    for (const a of m[0].matchAll(/\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      const url = a[1] ?? a[2];
      if (url.startsWith("/") && !url.startsWith("//")) refs.add(url.split(/[?#]/)[0]);
    }
  }
  return [...refs].sort();
}

/**
 * Returns { ok, results: [{ path, ok, detail }] }.
 * `hashes` is the Map from parseHashes; `fetchImpl` defaults to global fetch.
 */
export async function verify({ baseUrl, hashes, all = false, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/+$/, "");
  const results = [];
  const check = async (path, urlPath) => {
    const expected = hashes.get(path);
    if (!expected) return { path, ok: false, detail: "not listed in the hashes file" };
    let res;
    try {
      res = await fetchImpl(base + urlPath, { redirect: "follow" });
    } catch (e) {
      return { path, ok: false, detail: `fetch failed: ${e.message}` };
    }
    if (!res.ok) return { path, ok: false, detail: `HTTP ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const actual = sha256Hex(bytes);
    return actual === expected ? { path, ok: true, detail: actual } : { path, ok: false, detail: `expected ${expected}, got ${actual}` };
  };

  const index = await check("index.html", "/");
  results.push(index);
  if (index.ok) {
    const html = await (await fetchImpl(base + "/", { redirect: "follow" })).text();
    for (const ref of extractRefs(html)) {
      const path = ref.slice(1);
      if (path === "" || path === "index.html") continue;
      results.push(await check(path, ref));
    }
  }
  if (all) {
    const done = new Set(results.map((r) => r.path));
    for (const path of hashes.keys()) {
      if (path === "_headers" || done.has(path)) continue;
      results.push(await check(path, "/" + path.split("/").map(encodeURIComponent).join("/")));
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

function parseArgs(argv) {
  const opts = { url: null, hashes: "dist-hashes.txt", all: false, retries: 1 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") opts.all = true;
    else if (a === "--hashes") opts.hashes = argv[++i];
    else if (a === "--retries") opts.retries = Number(argv[++i]);
    else if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
    else if (opts.url === null) opts.url = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  if (!opts.url) throw new Error("Usage: verify-deployment.mjs <url> [--hashes file] [--all] [--retries n]");
  if (!/^https?:\/\//.test(opts.url)) throw new Error("The URL must start with https://");
  if (!opts.hashes) throw new Error("--hashes needs a file");
  if (!Number.isInteger(opts.retries) || opts.retries < 1) throw new Error("--retries must be a positive integer");
  return opts;
}
export { parseArgs };

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const { files } = parseHashes(readFileSync(resolve(opts.hashes), "utf8"));
  let outcome;
  for (let attempt = 1; attempt <= opts.retries; attempt++) {
    outcome = await verify({ baseUrl: opts.url, hashes: files, all: opts.all });
    if (outcome.ok) break;
    if (attempt < opts.retries) {
      console.log(`Attempt ${attempt} did not match; retrying in 5s (a new deploy can take a moment to spread)...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  for (const r of outcome.results) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.path}${r.ok ? "" : `  ${r.detail}`}`);
  console.log(outcome.ok ? `\nVerified: ${outcome.results.length} files match ${opts.hashes}.` : "\nMISMATCH: the live site does not match the hashes file.");
  process.exit(outcome.ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
