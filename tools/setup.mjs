#!/usr/bin/env node
// One-time self-hosting setup for Bitcoin Basis on a free Cloudflare account.
//   node tools/setup.mjs [--dry-run] [--rotate-secrets] [--subdomain <name>] [--account-id <id>] [--retention-days 365]
// Idempotent: safe to run again. Never writes a secret to disk or to a command line.
// Test hook: BB_WRANGLER=<path> replaces the wrangler binary (used by the unit tests).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkOrigin } from "./check-origin.mjs";

export const WORKER_NAME = "bitcoin-basis";
export const BUCKETS = { data: "bitcoin-basis-data", backup: "bitcoin-basis-backup" };
export const LOCK_RULE = "keep-backups";

export function parseArgs(argv) {
  const o = { dryRun: false, rotateSecrets: false, subdomain: null, accountId: null, retentionDays: 365, help: false };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--rotate-secrets") o.rotateSecrets = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--subdomain") o.subdomain = value(i++, a).toLowerCase();
    else if (a === "--account-id") o.accountId = value(i++, a);
    else if (a === "--retention-days") {
      o.retentionDays = Number(value(i++, a));
      if (!Number.isInteger(o.retentionDays) || o.retentionDays < 1) throw new Error("--retention-days must be a positive whole number");
    } else throw new Error(`Unknown option ${a}`);
  }
  if (o.subdomain !== null && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(o.subdomain)) throw new Error("--subdomain must be just the name, like 'myname' (not the full .workers.dev host)");
  if (o.accountId !== null && !/^[0-9a-f]{32}$/.test(o.accountId)) throw new Error("--account-id must be the 32-character account id");
  return o;
}

/** 128 random bits as 8 groups of 4 uppercase hex characters: ABCD-1234-... (typed exactly as shown). */
export function generateSetupCode(bytes = randomBytes(16)) {
  return bytes.toString("hex").toUpperCase().match(/.{4}/g).join("-");
}
export const generateSessionSecret = (bytes = randomBytes(32)) => bytes.toString("base64url");

export function computeOrigin(subdomain) {
  return checkOrigin(`https://${WORKER_NAME}.${subdomain}.workers.dev`);
}

const HELP = `Bitcoin Basis setup (free Cloudflare plan)

  node tools/setup.mjs [options]

  --dry-run            Print every command without running anything
  --rotate-secrets     Replace an existing SESSION_SECRET / SETUP_CODE (signs everyone out)
  --subdomain <name>   Your workers.dev subdomain, if it cannot be looked up automatically
  --account-id <id>    Pick the Cloudflare account when you have several
  --retention-days <n> Backup bucket lock retention (default 365)
`;

export async function run(argv, env = process.env, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  const opts = parseArgs(argv);
  const say = io.out;
  if (opts.help) {
    say(HELP);
    return 0;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workerDir = join(root, "worker");
  const bin = env.BB_WRANGLER ?? join(root, "node_modules", ".bin", "wrangler");
  const dry = opts.dryRun;
  let step = 0;
  const heading = (t) => say(`\n${++step}. ${t}`);
  const show = (args, note = "") => say(`   $ wrangler ${args.join(" ")}${note ? `   ${note}` : ""}`);

  /** Runs wrangler in worker/. Never called in dry-run mode for anything but display. */
  const wrangler = (args, input) => {
    const r = spawnSync(bin, args, { cwd: workerDir, input, encoding: "utf8", env: { ...env, CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false" } });
    return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, stdout: r.stdout ?? "" };
  };

  say(`Bitcoin Basis setup${dry ? " (dry run: nothing will be executed)" : ""}`);
  if (!dry && !existsSync(bin) && !env.BB_WRANGLER) {
    io.err("wrangler is not installed. Run `npm ci --ignore-scripts` in the repo first.");
    return 1;
  }

  // 1. Login and account
  heading("Check the Cloudflare login");
  let accountId = opts.accountId ?? "<ACCOUNT_ID>";
  show(["whoami", "--json"]);
  if (!dry) {
    const who = wrangler(["whoami", "--json"]);
    let info = null;
    try {
      info = JSON.parse(who.stdout);
    } catch {
      /* not signed in */
    }
    if (!who.ok || !info?.loggedIn) {
      io.err("   Not signed in. Run `npx wrangler login` and try again.");
      return 1;
    }
    const accounts = info.accounts ?? [];
    if (opts.accountId) {
      if (!accounts.some((a) => a.id === opts.accountId)) {
        io.err("   That account id is not one of the accounts you are signed in to.");
        return 1;
      }
    } else if (accounts.length === 1) {
      accountId = accounts[0].id;
    } else {
      io.err(`   ${accounts.length === 0 ? "No accounts found." : "More than one account:"}`);
      for (const a of accounts) io.err(`     ${a.id}  ${a.name}`);
      io.err("   Re-run with --account-id <id>.");
      return 1;
    }
    say(`   Signed in. Account: ${accountId}`);
  }

  // 2. workers.dev subdomain -> ORIGIN and RP_ID
  heading("Find your workers.dev subdomain");
  let subdomain = opts.subdomain ?? "<SUBDOMAIN>";
  if (opts.subdomain) say(`   Using --subdomain ${opts.subdomain}`);
  else if (dry) {
    show(["auth", "token", "--json"], "(read the login token in memory)");
    say(`   GET https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`);
  } else {
    const tok = wrangler(["auth", "token", "--json"]);
    let token = null;
    try {
      token = JSON.parse(tok.stdout).token ?? null;
    } catch {
      /* fall through */
    }
    let found = null;
    if (token) {
      try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers: { authorization: `Bearer ${token}` } });
        found = (await res.json())?.result?.subdomain ?? null;
      } catch {
        /* fall through */
      }
    }
    if (!found) {
      io.err("   Could not look up a workers.dev subdomain for this account.");
      io.err("   If you have never used Workers: Cloudflare dashboard -> Workers & Pages -> pick a subdomain.");
      io.err("   Then re-run with --subdomain <name> (the part before .workers.dev).");
      return 1;
    }
    subdomain = found;
  }
  const { origin, rpId } = computeOrigin(subdomain === "<SUBDOMAIN>" ? "subdomain" : subdomain);
  const shownOrigin = subdomain === "<SUBDOMAIN>" ? `https://${WORKER_NAME}.<SUBDOMAIN>.workers.dev` : origin;
  say(`   ORIGIN = ${shownOrigin}`);
  say(`   RP_ID  = ${subdomain === "<SUBDOMAIN>" ? `${WORKER_NAME}.<SUBDOMAIN>.workers.dev` : rpId}`);

  // 3. Buckets
  heading("Create the private R2 buckets");
  let existing = new Set();
  show(["r2", "bucket", "list"]);
  if (!dry) {
    const list = wrangler(["r2", "bucket", "list"]);
    if (!list.ok) {
      io.err(`   Could not list buckets:\n${list.out}`);
      return 1;
    }
    existing = new Set([...list.stdout.matchAll(/^name:\s+(\S+)/gm)].map((m) => m[1]));
  }
  for (const name of Object.values(BUCKETS)) {
    if (existing.has(name)) {
      say(`   ${name}: already exists, skipping`);
      continue;
    }
    const args = ["r2", "bucket", "create", name];
    show(args);
    if (!dry) {
      const r = wrangler(args);
      if (!r.ok) {
        io.err(`   Failed:\n${r.out}`);
        return 1;
      }
      say(`   ${name}: created`);
    }
  }

  // 4. Backup bucket lock
  heading(`Lock the backup bucket (${opts.retentionDays}-day retention)`);
  const lockList = ["r2", "bucket", "lock", "list", BUCKETS.backup];
  const lockAdd = ["r2", "bucket", "lock", "add", BUCKETS.backup, LOCK_RULE, "", "--retention-days", String(opts.retentionDays), "-y"];
  show(lockList);
  show(lockAdd.map((a) => (a === "" ? "''" : a)));
  if (!dry) {
    const has = wrangler(lockList);
    if (has.ok && has.out.includes(LOCK_RULE)) say(`   Lock rule '${LOCK_RULE}' already present, skipping`);
    else {
      const r = wrangler(lockAdd);
      if (r.ok) say(`   Lock rule '${LOCK_RULE}' added: backups cannot be deleted or overwritten for ${opts.retentionDays} days`);
      else {
        say("   Could not add the lock rule automatically (not fatal). Add it by hand:");
        say(`     Cloudflare dashboard -> R2 -> ${BUCKETS.backup} -> Settings -> Bucket lock rules -> Add rule`);
        say(`     Name: ${LOCK_RULE}, prefix: (all), retain for ${opts.retentionDays} days.`);
        say(`   Details: ${r.out.trim().split("\n").slice(-2).join(" ")}`);
      }
    }
  }

  // 5. Secrets
  heading("Set the Worker secrets");
  let present = new Set();
  const listArgs = ["secret", "list", "--format", "json"];
  show(listArgs);
  if (!dry) {
    const l = wrangler(listArgs);
    try {
      present = new Set(JSON.parse(l.stdout).map((s) => s.name));
    } catch {
      /* the Worker does not exist yet: no secrets */
    }
  }
  let printedCode = null;
  for (const [name, make] of [
    ["SESSION_SECRET", generateSessionSecret],
    ["SETUP_CODE", generateSetupCode],
  ]) {
    const args = ["secret", "put", name];
    if (present.has(name) && !opts.rotateSecrets) {
      say(`   ${name}: already set, keeping it (use --rotate-secrets to replace)`);
      continue;
    }
    if (dry) {
      show(args, `<- ${name === "SESSION_SECRET" ? "32 random bytes" : "128-bit code"} on stdin`);
      continue;
    }
    const value = make();
    const r = wrangler(args, `${value}\n`);
    if (!r.ok) {
      io.err(`   Failed to set ${name}:\n${r.out.replace(value, "[redacted]")}`);
      return 1;
    }
    say(`   ${name}: ${present.has(name) ? "replaced" : "set"}`);
    if (name === "SETUP_CODE") printedCode = value;
  }

  // 6. GitHub configuration
  heading("Add this to your GitHub repository (Settings -> Secrets and variables -> Actions)");
  say("   Variables tab:");
  say(`     CF_ACCOUNT_ID = ${accountId}`);
  say(`     APP_ORIGIN    = ${shownOrigin}`);
  say("   Secrets tab (use the 'production' environment secrets if you use that environment):");
  say("     CLOUDFLARE_API_TOKEN = a token you create at dash.cloudflare.com/profile/api-tokens");
  say("       Account > Workers Scripts: Edit, Account > Workers R2 Storage: Edit, Account > Account Settings: Read");
  say("       Limit it to this account. See docs/deploy.md.");
  say("   Also create the environment: Settings -> Environments -> New environment -> 'production'.");

  // 7. Final check
  heading("Check the deployment");
  say(`   After the first deploy (push to main, CI passes, Deploy runs), this should print {"claimed":false}:`);
  say(`     curl -s ${shownOrigin}/api/status`);
  if (!dry && !subdomain.startsWith("<")) {
    try {
      const res = await fetch(`${origin}/api/status`);
      const body = await res.text();
      say(res.ok && /"claimed"/.test(body) ? `   Right now: ${body}` : "   Right now: not deployed yet (expected before the first deploy).");
    } catch {
      say("   Right now: not reachable yet (expected before the first deploy).");
    }
  }

  if (printedCode) {
    say("\n==================================================================");
    say("  YOUR SETUP CODE (shown once; it is not stored anywhere readable):");
    say(`\n      ${printedCode}\n`);
    say("  Open the app, choose \"Set up\", and type it exactly as shown to create");
    say("  the first passkey. After that it is useless. Do not save it in the repo.");
    say("  Lost it before setting up? Run again with --rotate-secrets.");
    say("==================================================================");
  } else if (!dry) {
    say("\nNo new setup code was generated (SETUP_CODE already exists). Use --rotate-secrets to make a new one if the vault is still unclaimed.");
  }
  say(dry ? "\nDry run finished. Nothing was changed." : "\nSetup finished.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e.message);
      process.exit(2);
    },
  );
}
