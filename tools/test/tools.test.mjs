import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkOrigin } from "../check-origin.mjs";
import { formatHashes, hashDir, parseHashes, sha256Hex } from "../hash-build.mjs";
import { parseArgs, generateSetupCode, generateSessionSecret, run } from "../setup.mjs";
import { addSri, sriHash } from "../sri.mjs";
import { extractRefs, parseArgs as parseVerifyArgs, verify } from "../verify-deployment.mjs";
import { smoke } from "../smoke-test.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), "bb-tools-"));
const enc = (s) => new TextEncoder().encode(s);

describe("hash-build", () => {
  it("hashes every file sorted, with a combined hash that parses back", () => {
    const dir = tmp();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "b.txt"), "b");
    writeFileSync(join(dir, "assets", "a.js"), "a");
    writeFileSync(join(dir, "index.html"), "i");
    const r = hashDir(dir);
    expect(r.files.map((f) => f.path)).toEqual(["assets/a.js", "b.txt", "index.html"]);
    expect(r.files[1].sha256).toBe(createHash("sha256").update("b").digest("hex"));
    const parsed = parseHashes(formatHashes(r));
    expect(parsed.combined).toBe(r.combined);
    expect([...parsed.files.keys()]).toEqual(["assets/a.js", "b.txt", "index.html"]);
  });
  it("detects an edited file list via the combined hash", () => {
    const dir = tmp();
    writeFileSync(join(dir, "a"), "a");
    writeFileSync(join(dir, "b"), "b");
    const lines = formatHashes(hashDir(dir)).split("\n");
    const tampered = lines.filter((l) => !l.endsWith("  b")).join("\n");
    expect(() => parseHashes(tampered)).toThrow(/Combined hash/);
    expect(() => parseHashes("garbage\n")).toThrow(/Malformed/);
    expect(() => parseHashes("# only a comment\n")).toThrow(/No hashes/);
  });
});

describe("sri", () => {
  const files = { "/assets/a.js": enc("console.log(1)"), "/assets/s.css": enc("a{}"), "/assets/c.js": enc("c") };
  const read = (p) => files[p] ?? null;
  const html = `<script type="module" crossorigin src="/assets/a.js"></script>
<link rel="modulepreload" crossorigin href="/assets/c.js">
<link rel="stylesheet" crossorigin href="/assets/s.css">
<link rel="icon" href="/icons/x.png"><script src="https://cdn.example/x.js"></script><script>inline()</script>`;
  it("adds sha384 integrity and crossorigin to local scripts, stylesheets and modulepreloads only", () => {
    const { html: out, count } = addSri(html, read);
    expect(count).toBe(3);
    expect(out).toContain(`src="/assets/a.js" integrity="${sriHash(files["/assets/a.js"])}" crossorigin>`);
    expect(out).toContain(`href="/assets/s.css" integrity="${sriHash(files["/assets/s.css"])}" crossorigin>`);
    expect(out).toContain('<link rel="icon" href="/icons/x.png">');
    expect(out).toContain('<script src="https://cdn.example/x.js"></script>');
    expect(out.match(/crossorigin/g)).toHaveLength(3);
  });
  it("is idempotent and refreshes a stale hash", () => {
    const once = addSri(html, read).html;
    expect(addSri(once, read).html).toBe(once);
    const stale = once.replace(/sha384-[^"]+/, "sha384-AAAA");
    expect(addSri(stale, read).html).toBe(once);
  });
  it("fails when a referenced file is missing", () => {
    expect(() => addSri('<script src="/assets/missing.js"></script>', read)).toThrow(/missing\.js/);
  });
});

describe("check-origin", () => {
  it("accepts workers.dev and https custom origins", () => {
    expect(checkOrigin("https://bitcoin-basis.me.workers.dev")).toEqual({ origin: "https://bitcoin-basis.me.workers.dev", rpId: "bitcoin-basis.me.workers.dev" });
    expect(checkOrigin("https://basis.example.com").rpId).toBe("basis.example.com");
  });
  it.each(["", "http://x.workers.dev", "https://localhost", "https://127.0.0.1", "https://a.workers.dev/", "https://a.b.workers.dev/x", "https://a.b:8443", "https://user@a.b.com", "nonsense", "https://intranet"])("rejects %j", (v) => {
    expect(() => checkOrigin(v)).toThrow();
  });
  it("rejects a missing value", () => {
    expect(() => checkOrigin(undefined)).toThrow(/not set/);
  });
});

describe("verify-deployment", () => {
  const index = '<html><script src="/assets/a.js"></script><link rel="stylesheet" href="/assets/s.css?x=1"><img src="//evil/x.png"></html>';
  const site = { "/": index, "/assets/a.js": "A", "/assets/s.css": "S", "/assets/lazy.js": "L" };
  const hashes = new Map([
    ["index.html", sha256Hex(enc(index))],
    ["assets/a.js", sha256Hex(enc("A"))],
    ["assets/s.css", sha256Hex(enc("S"))],
    ["assets/lazy.js", sha256Hex(enc("L"))],
    ["_headers", sha256Hex(enc("h"))],
  ]);
  const fakeFetch = (s) => async (url) => {
    const path = new URL(url).pathname;
    return path in s ? new Response(s[path]) : new Response("nope", { status: 404 });
  };
  it("extracts only local references", () => {
    expect(extractRefs(index)).toEqual(["/assets/a.js", "/assets/s.css"]);
  });
  it("passes when everything matches, and --all also checks lazy chunks", async () => {
    const r = await verify({ baseUrl: "https://x.test/", hashes, fetchImpl: fakeFetch(site) });
    expect(r.ok).toBe(true);
    expect(r.results.map((x) => x.path)).toEqual(["index.html", "assets/a.js", "assets/s.css"]);
    const all = await verify({ baseUrl: "https://x.test", hashes, all: true, fetchImpl: fakeFetch(site) });
    expect(all.results.map((x) => x.path)).toContain("assets/lazy.js");
    expect(all.results.map((x) => x.path)).not.toContain("_headers");
  });
  it("fails on a modified asset, a missing asset, and an unlisted reference", async () => {
    const bad = await verify({ baseUrl: "https://x.test", hashes, fetchImpl: fakeFetch({ ...site, "/assets/a.js": "EVIL" }) });
    expect(bad.ok).toBe(false);
    expect(bad.results.find((r) => r.path === "assets/a.js").detail).toMatch(/expected/);
    const gone = await verify({ baseUrl: "https://x.test", hashes, fetchImpl: fakeFetch({ "/": index }) });
    expect(gone.results.some((r) => r.detail === "HTTP 404")).toBe(true);
    const extra = '<script src="/assets/injected.js"></script>';
    const h2 = new Map([["index.html", sha256Hex(enc(extra))]]);
    const un = await verify({ baseUrl: "https://x.test", hashes: h2, fetchImpl: fakeFetch({ "/": extra, "/assets/injected.js": "x" }) });
    expect(un.results.find((r) => r.path === "assets/injected.js").detail).toMatch(/not listed/);
  });
  it("parses arguments", () => {
    expect(parseVerifyArgs(["https://x.test", "--all", "--hashes", "h.txt", "--retries", "3"])).toMatchObject({ url: "https://x.test", all: true, hashes: "h.txt", retries: 3 });
    expect(() => parseVerifyArgs([])).toThrow(/Usage/);
    expect(() => parseVerifyArgs(["x.test"])).toThrow(/https/);
    expect(() => parseVerifyArgs(["https://x", "--nope"])).toThrow(/Unknown/);
  });
});

describe("smoke-test", () => {
  const headers = {
    "content-security-policy": "default-src 'self'; script-src 'self'",
    "strict-transport-security": "max-age=1",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
  };
  const make = (h) => async (url) => new Response(new URL(url).pathname === "/api/status" ? '{"claimed":false}' : '<div id="root"></div>', { headers: h });
  it("passes with all headers", async () => {
    expect(await smoke("https://x.test", make(headers))).toEqual([]);
  });
  it("reports a missing header and a bad status body", async () => {
    const rest = { ...headers };
    delete rest["strict-transport-security"];
    const p = await smoke("https://x.test", make(rest));
    expect(p.some((x) => x.includes("strict-transport-security"))).toBe(true);
    const bad = await smoke("https://x.test", async () => new Response("<html>", { headers }));
    expect(bad.some((x) => x.includes("claimed"))).toBe(true);
  });
});

describe("setup", () => {
  it("parses arguments", () => {
    expect(parseArgs([])).toMatchObject({ dryRun: false, rotateSecrets: false, retentionDays: 365 });
    expect(parseArgs(["--dry-run", "--rotate-secrets", "--subdomain", "Me", "--retention-days", "30"])).toMatchObject({ dryRun: true, rotateSecrets: true, subdomain: "me", retentionDays: 30 });
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown/);
    expect(() => parseArgs(["--subdomain"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--subdomain", "a.workers.dev"])).toThrow(/just the name/);
    expect(() => parseArgs(["--retention-days", "0"])).toThrow();
    expect(() => parseArgs(["--account-id", "abc"])).toThrow();
  });
  it("generates a 128-bit grouped code and a 32-byte secret", () => {
    expect(generateSetupCode()).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
    expect(generateSetupCode()).not.toBe(generateSetupCode());
    expect(Buffer.from(generateSessionSecret(), "base64url")).toHaveLength(32);
  });

  const capture = () => {
    const lines = [];
    return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } };
  };

  it("--dry-run prints the full command plan and runs nothing", async () => {
    const state = join(tmp(), "state.json");
    const { lines, io } = capture();
    const code = await run(["--dry-run", "--subdomain", "me"], { BB_WRANGLER: join(here, "mock-wrangler.mjs"), MOCK_STATE: state }, io);
    const text = lines.join("\n");
    expect(code).toBe(0);
    for (const needle of ["wrangler whoami --json", "r2 bucket create bitcoin-basis-data", "r2 bucket create bitcoin-basis-backup", "r2 bucket lock add bitcoin-basis-backup keep-backups '' --retention-days 365 -y", "r2 bucket lifecycle add bitcoin-basis-data expire-used-challenges used/ --expire-days 30 -y", "r2 bucket lifecycle add bitcoin-basis-data expire-revoked-sessions revoked/ --expire-days 30 -y", "secret put SESSION_SECRET", "secret put SETUP_CODE", "ORIGIN = https://bitcoin-basis.me.workers.dev", "CF_ACCOUNT_ID", "APP_ORIGIN", "CLOUDFLARE_API_TOKEN", "/api/status"]) {
      expect(text).toContain(needle);
    }
    expect(text).not.toMatch(/([0-9A-F]{4}-){7}[0-9A-F]{4}/);
    expect(() => readFileSync(state)).toThrow(); // mock never ran
  });

  const env = (state, extra = {}) => ({ BB_WRANGLER: join(here, "mock-wrangler.mjs"), MOCK_STATE: state, PATH: process.env.PATH, ...extra });

  it("runs against a mock wrangler: creates, locks, sets secrets via stdin only, prints the code once; second run is a no-op", async () => {
    const state = join(tmp(), "state.json");
    const first = capture();
    expect(await run(["--subdomain", "me"], env(state), first.io)).toBe(0);
    const s1 = JSON.parse(readFileSync(state, "utf8"));
    expect(s1.buckets).toEqual(["bitcoin-basis-data", "bitcoin-basis-backup"]);
    expect(s1.locks).toEqual(["keep-backups"]);
    expect(s1.lifecycle).toEqual([
      { bucket: "bitcoin-basis-data", name: "expire-used-challenges", prefix: "used/", days: "30" },
      { bucket: "bitcoin-basis-data", name: "expire-revoked-sessions", prefix: "revoked/", days: "30" },
      { bucket: "bitcoin-basis-data", name: "expire-backup-progress", prefix: "backup-progress/", days: "30" },
    ]);
    expect(s1.secrets).toEqual(["SESSION_SECRET", "SETUP_CODE"]);
    const puts = s1.calls.filter((c) => c.args[0] === "secret" && c.args[1] === "put");
    expect(puts).toHaveLength(2);
    expect(Buffer.from(puts[0].stdin.trim(), "base64url")).toHaveLength(32);
    const code = puts[1].stdin.trim();
    expect(code).toMatch(/^([0-9A-F]{4}-){7}[0-9A-F]{4}$/);
    expect(JSON.stringify(s1.calls.map((c) => c.args))).not.toContain(code); // never on a command line
    const out1 = first.lines.join("\n");
    expect(out1.split(code).length - 1).toBe(1); // printed exactly once
    expect(out1).not.toContain(puts[0].stdin.trim());

    const second = capture();
    expect(await run(["--subdomain", "me"], env(state), second.io)).toBe(0);
    const s2 = JSON.parse(readFileSync(state, "utf8"));
    expect(s2.calls.filter((c) => c.args[1] === "put" || c.args[2] === "create" || c.args[3] === "add")).toHaveLength(puts.length + 2 + 1 + 3);
    expect(second.lines.join("\n")).toContain("already set, keeping it");
    expect(second.lines.join("\n")).not.toContain(code);

    const rotate = capture();
    expect(await run(["--subdomain", "me", "--rotate-secrets"], env(state), rotate.io)).toBe(0);
    const s3 = JSON.parse(readFileSync(state, "utf8"));
    expect(s3.calls.filter((c) => c.args[1] === "put")).toHaveLength(4);
  });

  it("prints a manual fallback when the bucket lock command is unavailable", async () => {
    const state = join(tmp(), "state.json");
    const { lines, io } = capture();
    expect(await run(["--subdomain", "me"], env(state, { MOCK_NO_LOCK: "1" }), io)).toBe(0);
    expect(lines.join("\n")).toContain("Add it by hand");
  });

  it("prints a dashboard fallback when lifecycle rules can't be added", async () => {
    const state = join(tmp(), "state.json");
    const { lines, io } = capture();
    expect(await run(["--subdomain", "me"], env(state, { MOCK_NO_LIFECYCLE: "1" }), io)).toBe(0);
    expect(lines.join("\n")).toContain("Object lifecycle rules");
  });
});
