import { describe, expect, it } from "vitest";
import { parseArgs, plan, run } from "../restore-backup.mjs";

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
});
