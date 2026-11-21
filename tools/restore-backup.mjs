#!/usr/bin/env node
// Disaster recovery: copy a vault's backup (vault/<vaultId>/<key> in the backup bucket) back into the data
// bucket under its original key. Dry run by default; nothing is written without --apply. Existing objects in
// the data bucket are never overwritten (only-if-new), so it is safe to run twice.
//   node tools/restore-backup.mjs --account-id <id> [--vault <vaultId>] [--apply]
//        [--data-bucket bitcoin-basis-data] [--backup-bucket bitcoin-basis-backup]
// Uses the Cloudflare API with your `wrangler login` (or CLOUDFLARE_API_TOKEN). The token is never printed.
// Object names are printed; nothing else about the data is. The objects stay encrypted.
// Test hooks: BB_WRANGLER=<path> replaces the wrangler binary; BB_CF_API=<url> replaces the API base.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = { data: "bitcoin-basis-data", backup: "bitcoin-basis-backup" };
export const VAULT_PREFIX = "vault/";

export function parseArgs(argv) {
  const o = { apply: false, help: false, accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? null, vault: null, data: DEFAULTS.data, backup: DEFAULTS.backup };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") o.apply = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--account-id") o.accountId = value(i++, a);
    else if (a === "--vault") o.vault = value(i++, a);
    else if (a === "--data-bucket") o.data = value(i++, a);
    else if (a === "--backup-bucket") o.backup = value(i++, a);
    else throw new Error(`Unknown option ${a}`);
  }
  if (o.vault !== null && !/^[A-Za-z0-9_-]{22}$/.test(o.vault)) throw new Error("--vault must be the 22-character vault id (the folder name under vault/ in the backup bucket)");
  if (o.data === o.backup) throw new Error("data and backup bucket must differ");
  return o;
}

function findWrangler() {
  if (process.env.BB_WRANGLER) return process.env.BB_WRANGLER;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "..", "node_modules", ".bin", "wrangler"), join(here, "..", "worker", "node_modules", ".bin", "wrangler")]) if (existsSync(p)) return p;
  return "wrangler";
}

function getToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const r = spawnSync(findWrangler(), ["auth", "token", "--json"], { encoding: "utf8" });
  if (r.status === 0) {
    try {
      const t = JSON.parse(r.stdout).token;
      if (typeof t === "string" && t !== "") return t;
    } catch {
      /* fall through */
    }
  }
  throw new Error("No Cloudflare login found. Run `npx wrangler login` (or set CLOUDFLARE_API_TOKEN) and try again.");
}

export function makeClient(accountId, token, base = process.env.BB_CF_API ?? "https://api.cloudflare.com/client/v4") {
  const root = (bucket) => `${base}/accounts/${accountId}/r2/buckets/${bucket}/objects`;
  const headers = { authorization: `Bearer ${token}` };
  return {
    /** Every key under `prefix`. With `delimiter`, also returns the sub-prefixes. */
    async list(bucket, prefix = "", delimiter = "") {
      const keys = [];
      const prefixes = [];
      let cursor = "";
      for (;;) {
        const q = new URLSearchParams({ per_page: "1000", prefix });
        if (delimiter) q.set("delimiter", delimiter);
        if (cursor) q.set("cursor", cursor);
        const res = await fetch(`${root(bucket)}?${q}`, { headers });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success !== true) throw new Error(`Listing ${bucket} failed (${res.status}). Check the bucket name and --account-id.`);
        for (const o of body.result) keys.push(o.key);
        for (const p of body.result_info?.delimited ?? []) prefixes.push(p);
        if (body.result_info?.is_truncated !== true || !body.result_info.cursor) break;
        cursor = body.result_info.cursor;
      }
      return { keys, prefixes };
    },
    async get(bucket, key) {
      const res = await fetch(`${root(bucket)}/${encodeURIComponent(key)}`, { headers });
      if (!res.ok) throw new Error(`Reading ${key} failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(bucket, key, bytes) {
      const res = await fetch(`${root(bucket)}/${encodeURIComponent(key)}`, { method: "PUT", headers: { ...headers, "content-type": "application/octet-stream", "if-none-match": "*" }, body: bytes });
      if (res.status === 412) return false; // already there
      if (!res.ok) throw new Error(`Writing ${key} failed (${res.status})`);
      return true;
    },
  };
}

/** Plan: which backup keys are missing from the data bucket. */
export async function plan(client, o) {
  const { prefixes } = await client.list(o.backup, VAULT_PREFIX, "/");
  const vaults = prefixes.map((p) => p.slice(VAULT_PREFIX.length).replace(/\/$/, "")).filter((v) => v !== "");
  if (vaults.length === 0) throw new Error(`No backups found: ${o.backup} has nothing under ${VAULT_PREFIX}`);
  let vault = o.vault;
  if (vault === null) {
    if (vaults.length > 1) throw new Error(`${vaults.length} vaults in ${o.backup}: ${vaults.join(", ")}. Choose one with --vault <id> (the one you are restoring; older ones are earlier vaults from this instance).`);
    vault = vaults[0];
  } else if (!vaults.includes(vault)) {
    throw new Error(`Vault ${vault} not found in ${o.backup}. Found: ${vaults.join(", ")}`);
  }
  const root = `${VAULT_PREFIX}${vault}/`;
  const backed = (await client.list(o.backup, root)).keys.map((k) => k.slice(root.length)).filter((k) => k !== "");
  const have = new Set((await client.list(o.data)).keys);
  return { vault, root, total: backed.length, missing: backed.filter((k) => !have.has(k)).sort() };
}

export async function run(o, client, out = console.log) {
  const p = await plan(client, o);
  out(`Vault ${p.vault}: ${p.total} object(s) in ${o.backup}, ${p.missing.length} missing from ${o.data}.`);
  if (!o.apply) {
    for (const k of p.missing) out(`  would copy ${k}`);
    out(p.missing.length === 0 ? "Nothing to restore." : "Dry run: nothing was written. Run again with --apply to copy.");
    return { copied: 0, skipped: 0, missing: p.missing.length };
  }
  if (p.missing.length === 0) {
    out("Nothing to restore.");
    return { copied: 0, skipped: 0, missing: 0 };
  }
  let copied = 0;
  let skipped = 0;
  for (const k of p.missing) {
    const bytes = await client.get(o.backup, p.root + k);
    if (await client.put(o.data, k, bytes)) {
      copied++;
      out(`  copied ${k}`);
    } else {
      skipped++;
      out(`  kept   ${k} (already in ${o.data})`);
    }
  }
  out(`Done: ${copied} copied, ${skipped} already present. Now clear site data in your browsers and open the app; restore with your recovery code or a passkey.`);
  return { copied, skipped, missing: p.missing.length };
}

const HELP = `Usage: node tools/restore-backup.mjs --account-id <id> [--vault <vaultId>] [--apply]
  [--data-bucket ${DEFAULTS.data}] [--backup-bucket ${DEFAULTS.backup}]
Copies vault/<vaultId>/<key> from the backup bucket into the data bucket as <key>. Dry run unless --apply.
Never overwrites an existing object. Needs \`npx wrangler login\` (or CLOUDFLARE_API_TOKEN).`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.help) {
      console.log(HELP);
    } else {
      if (!o.accountId) throw new Error("Give your account id with --account-id <id> (or CLOUDFLARE_ACCOUNT_ID). `npx wrangler whoami` shows it.");
      await run(o, makeClient(o.accountId, getToken()));
    }
  } catch (e) {
    console.error(`restore-backup: ${e.message}`);
    process.exit(1);
  }
}
