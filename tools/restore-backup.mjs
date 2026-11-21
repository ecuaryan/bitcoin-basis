#!/usr/bin/env node
// Disaster recovery: copy a vault's backup (vault/<vaultId>/<key> in the backup bucket) back into the data
// bucket under its original key. Dry run by default; nothing is written without --apply. Existing objects in
// the data bucket are never overwritten (only-if-new).
//   node tools/restore-backup.mjs --account-id <id> [--vault <vaultId>] [--apply] [--force]
//        [--data-bucket bitcoin-basis-data] [--backup-bucket bitcoin-basis-backup]
// --apply refuses when the data bucket already holds a vault (any meta/, cred/, recovery/ or epoch/ object):
// keys like recovery/<n> and cred/<id> are not per-vault, so mixing two vaults would let the old vault's newer
// recovery record and passkeys take over the current one. --force overrides that (resuming a restore that stopped
// partway), with a warning.
// Uses the Cloudflare API with your `wrangler login` (or CLOUDFLARE_API_TOKEN). The token is never printed.
// Object names are printed; nothing else about the data is. The objects stay encrypted.
// Test hooks: BB_WRANGLER=<path> replaces the wrangler binary; BB_CF_API=<url> replaces the API base, but only
// together with BB_TEST_ALLOW_CF_API=1 (so a stray variable can never send your token elsewhere).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULTS = { data: "bitcoin-basis-data", backup: "bitcoin-basis-backup" };
export const VAULT_PREFIX = "vault/";
/** Objects that make up a vault's identity and keys. Any of them in the data bucket means a vault is there. */
export const VAULT_KEY_PREFIXES = ["meta/", "cred/", "recovery/", "epoch/"];

export function parseArgs(argv) {
  const o = { apply: false, force: false, help: false, accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? null, vault: null, data: DEFAULTS.data, backup: DEFAULTS.backup };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") o.apply = true;
    else if (a === "--force") o.force = true;
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

export const CF_API = "https://api.cloudflare.com/client/v4";

/** The API base: Cloudflare's, unless a test sets both BB_TEST_ALLOW_CF_API=1 and BB_CF_API. */
export function apiBase(env = process.env) {
  return env.BB_TEST_ALLOW_CF_API === "1" && env.BB_CF_API ? env.BB_CF_API : CF_API;
}

export function makeClient(accountId, token, base = apiBase()) {
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
  const existing = [...have].filter((k) => VAULT_KEY_PREFIXES.some((p) => k.startsWith(p))).sort();
  let claimedBy = null;
  if (have.has("meta/claimed")) {
    try {
      const bytes = await client.get(o.data, "meta/claimed");
      const id = JSON.parse(new TextDecoder().decode(bytes)).vaultId;
      claimedBy = typeof id === "string" ? id : "(unreadable)";
    } catch {
      claimedBy = "(unreadable)";
    }
  }
  return { vault, root, total: backed.length, missing: backed.filter((k) => !have.has(k)).sort(), existing, claimedBy };
}

/** Why copying into this data bucket could mix two vaults, or `null`. */
function conflict(p, o) {
  if (p.claimedBy !== null && p.claimedBy !== p.vault) return `${o.data} is claimed by a different vault (${p.claimedBy}), not ${p.vault}.`;
  if (p.existing.length > 0) return `${o.data} already holds ${p.existing.length} vault object(s) (${p.existing.slice(0, 3).join(", ")}${p.existing.length > 3 ? ", ..." : ""}).`;
  return null;
}

export async function run(o, client, out = console.log) {
  const p = await plan(client, o);
  out(`Vault ${p.vault}: ${p.total} object(s) in ${o.backup}, ${p.missing.length} missing from ${o.data}.`);
  const clash = p.missing.length === 0 ? null : conflict(p, o);
  if (!o.apply) {
    if (clash !== null) out(`WARNING: ${clash} --apply will refuse; restore only into an emptied data bucket.`);
    for (const k of p.missing) out(`  would copy ${k}`);
    out(p.missing.length === 0 ? "Nothing to restore." : "Dry run: nothing was written. Run again with --apply to copy.");
    return { copied: 0, skipped: 0, missing: p.missing.length };
  }
  if (p.missing.length === 0) {
    out("Nothing to restore.");
    return { copied: 0, skipped: 0, missing: 0 };
  }
  if (clash !== null) {
    if (!o.force) {
      throw new Error(
        `${clash} Refusing to copy: recovery/, cred/ and epoch/ keys are shared by every vault, so an old vault's objects would take over the current one (its newer recovery code and its passkeys would work). Empty the data bucket first, or, only to resume a restore of this same vault that stopped partway, run again with --force.`,
      );
    }
    out("!".repeat(72));
    out(`WARNING (--force): ${clash}`);
    out("Copying anyway. If this is not the same vault, its recovery code and passkeys may now open this instance.");
    out("!".repeat(72));
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

const HELP = `Usage: node tools/restore-backup.mjs --account-id <id> [--vault <vaultId>] [--apply] [--force]
  [--data-bucket ${DEFAULTS.data}] [--backup-bucket ${DEFAULTS.backup}]
Copies vault/<vaultId>/<key> from the backup bucket into the data bucket as <key>. Dry run unless --apply.
Never overwrites an existing object. Refuses when the data bucket already holds a vault (meta/, cred/,
recovery/ or epoch/ objects) unless --force. Needs \`npx wrangler login\` (or CLOUDFLARE_API_TOKEN).`;

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
