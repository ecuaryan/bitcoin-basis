#!/usr/bin/env node
// Adds Subresource Integrity to app/dist/index.html after the build: every <script src>, stylesheet and
// modulepreload link that points at a local file gets integrity="sha384-..." and crossorigin.
// Dynamic imports (lazy route chunks) cannot carry SRI; the CSP `script-src 'self'` covers them.
// Run it BEFORE tools/hash-build.mjs, because it changes index.html. Idempotent.
//   node tools/sri.mjs [distDir=app/dist]
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const sriHash = (bytes) => `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

const attr = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
const stripAttr = (tag, name) => tag.replace(new RegExp(`\\s${name}(\\s*=\\s*("[^"]*"|'[^']*'))?(?=[\\s/>])`, "gi"), "");

/**
 * Returns { html, count }. `read(path)` returns the bytes of a local file ("/assets/x.js") or null.
 * Throws if a local reference points at a file that does not exist.
 */
export function addSri(html, read) {
  let count = 0;
  const rewrite = (tag, urlAttr) => {
    const m = attr(tag, urlAttr);
    const url = m && (m[2] ?? m[3]);
    if (!url || !url.startsWith("/") || url.startsWith("//")) return tag; // remote or inline: leave alone
    const path = url.split(/[?#]/)[0];
    const bytes = read(path);
    if (!bytes) throw new Error(`SRI: ${path} is referenced by index.html but not found in the build`);
    let t = stripAttr(stripAttr(tag, "integrity"), "crossorigin");
    t = t.replace(/\s*\/?>$/, (end) => ` integrity="${sriHash(bytes)}" crossorigin${end.trim() === "/>" ? " />" : ">"}`);
    count++;
    return t;
  };
  const out = html
    .replace(/<script\b[^>]*>/gi, (tag) => (attr(tag, "src") ? rewrite(tag, "src") : tag))
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const rel = attr(tag, "rel");
      const relValue = ((rel && (rel[2] ?? rel[3])) || "").toLowerCase().split(/\s+/);
      return relValue.includes("stylesheet") || relValue.includes("modulepreload") ? rewrite(tag, "href") : tag;
    });
  return { html: out, count };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = resolve(process.argv[2] ?? join(root, "app", "dist"));
  const indexPath = join(dist, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`${indexPath} not found. Build the app first.`);
    process.exit(1);
  }
  const read = (p) => {
    const file = resolve(dist, "." + p);
    if (!file.startsWith(dist + sep) || !existsSync(file)) return null;
    return readFileSync(file);
  };
  const { html, count } = addSri(readFileSync(indexPath, "utf8"), read);
  writeFileSync(indexPath, html);
  console.log(`SRI: added integrity to ${count} tags in ${indexPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
