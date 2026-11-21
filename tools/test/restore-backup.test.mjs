import { describe, expect, it } from "vitest";
import { apiBase, CF_API, parseArgs, plan, run } from "../restore-backup.mjs";

const V = "AAAAAAAAAAAAAAAAAAAAAA";
const W = "BBBBBBBBBBBBBBBBBBBBBB";

function fake(backup, data) {
  const store = { b: new Map(backup), d: new Map(data) };
  const which = (n) => (n === "backup" ? store.b : store.d);
  return {
    store,
    async list(bucket, prefix = "", delimiter = "") {
      const keys = [...which(bucket).keys()].filter((k) => k.startsWith(prefix));
      if (!delimiter) return { keys, prefixes: [] };
      return { keys: [], prefixes: [...new Set(keys.map((k) => prefix + k.slice(prefix.length).split("/")[0] + "/"))] };
    },
    async get(bucket, key) {
      return which(bucket).get(key);
    },
    async put(bucket, key, bytes) {
      if (which(bucket).has(key)) return false;
      which(bucket).set(key, bytes);
      return true;
    },
  };
}
const text = (t) => new TextEncoder().encode(t);
const opts = (extra = {}) => ({ ...parseArgs([]), data: "d", backup: "backup", ...extra });
const bytes = (n) => new Uint8Array([n]);

describe("restore-backup", () => {
  it("dry run writes nothing, apply copies only missing objects without the prefix", async () => {
    const c = fake([[`vault/${V}/meta/claimed`, bytes(1)], [`vault/${V}/e/1`, bytes(2)]], [["e/1", bytes(9)]]);
    const out = [];
    expect(await run(opts(), c, (l) => out.push(l))).toMatchObject({ copied: 0, missing: 1 });
    expect(c.store.d.has("meta/claimed")).toBe(false);
    expect(await run(opts({ apply: true }), c, () => {})).toMatchObject({ copied: 1 });
    expect(c.store.d.get("meta/claimed")).toEqual(bytes(1));
    expect(c.store.d.get("e/1")).toEqual(bytes(9)); // never overwritten
    expect(await run(opts({ apply: true }), c, () => {})).toMatchObject({ copied: 0, missing: 0 });
  });
  it("needs --vault when there are several, and refuses an unknown one", async () => {
    const c = fake([[`vault/${V}/a`, bytes(1)], [`vault/${W}/a`, bytes(2)]], []);
    await expect(plan(c, opts())).rejects.toThrow(/Choose one/);
    expect((await plan(c, opts({ vault: W }))).missing).toEqual(["a"]);
    await expect(plan(c, opts({ vault: "CCCCCCCCCCCCCCCCCCCCCC" }))).rejects.toThrow(/not found/);
  });
  it("fails clearly with no backups and bad arguments", async () => {
    await expect(plan(fake([], []), opts())).rejects.toThrow(/No backups/);
    expect(() => parseArgs(["--vault", "x"])).toThrow(/22-character/);
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown/);
  });

  // Security review 4: keys like recovery/<n>, cred/<id> and epoch/<n>/... are not per-vault. Copying an OLD vault
  // into a bucket that holds the CURRENT one made the old vault's newer recovery record "current" and gave its
  // passkeys sign-in.
  describe("never mixes two vaults", () => {
    const OLD = V;
    const CUR = W;
    const backup = () => [
      [`vault/${OLD}/meta/claimed`, text(`{"vaultId":"${OLD}"}`)],
      [`vault/${OLD}/recovery/000003`, text("old-recovery-v3")],
      [`vault/${OLD}/cred/old-passkey`, text("old-cred")],
      [`vault/${CUR}/meta/claimed`, text(`{"vaultId":"${CUR}"}`)],
      [`vault/${CUR}/recovery/000001`, text("cur-recovery-v1")],
    ];
    const current = () => [
      ["meta/claimed", text(`{"vaultId":"${CUR}"}`)],
      ["recovery/000001", text("cur-recovery-v1")],
      ["cred/cur-passkey", text("cur-cred")],
    ];

    it("refuses --apply into a bucket claimed by a different vault, and writes nothing", async () => {
      const c = fake(backup(), current());
      const before = [...c.store.d.keys()].sort();
      await expect(run(opts({ vault: OLD, apply: true }), c, () => {})).rejects.toThrow(/different vault .*Refusing to copy/s);
      expect([...c.store.d.keys()].sort()).toEqual(before);
      expect(c.store.d.has("recovery/000003")).toBe(false);
      expect(c.store.d.has("cred/old-passkey")).toBe(false);
    });

    it("refuses when any vault object is there, even without meta/claimed", async () => {
      for (const key of ["cred/x", "recovery/000001", "epoch/000001/history", "meta/other"]) {
        const c = fake(backup(), [[key, bytes(1)]]);
        await expect(run(opts({ vault: OLD, apply: true }), c, () => {})).rejects.toThrow(/already holds 1 vault object/);
        expect(c.store.d.size).toBe(1);
      }
    });

    it("the dry run warns; blobs alone (e/) are not a vault", async () => {
      const out = [];
      await run(opts({ vault: OLD }), fake(backup(), current()), (l) => out.push(l));
      expect(out.join("\n")).toMatch(/WARNING: .*different vault.*--apply will refuse/);
      const c = fake(backup(), [["e/1", bytes(1)]]);
      expect(await run(opts({ vault: OLD, apply: true }), c, () => {})).toMatchObject({ copied: 3 });
    });

    it("--force copies anyway, with a loud warning", async () => {
      expect(parseArgs(["--force"]).force).toBe(true);
      const c = fake(backup(), current());
      const out = [];
      expect(await run(opts({ vault: OLD, apply: true, force: true }), c, (l) => out.push(l))).toMatchObject({ copied: 2 });
      expect(out.join("\n")).toMatch(/WARNING \(--force\)/);
      expect(new TextDecoder().decode(c.store.d.get("meta/claimed"))).toContain(CUR); // never overwritten
    });
  });

  it("uses Cloudflare's API unless a test explicitly allows another base", () => {
    expect(apiBase({})).toBe(CF_API);
    expect(apiBase({ BB_CF_API: "https://evil.example" })).toBe(CF_API);
    expect(apiBase({ BB_CF_API: "https://evil.example", BB_TEST_ALLOW_CF_API: "0" })).toBe(CF_API);
    expect(apiBase({ BB_CF_API: "http://127.0.0.1:9", BB_TEST_ALLOW_CF_API: "1" })).toBe("http://127.0.0.1:9");
  });
});
