#!/usr/bin/env node
// Fake wrangler for tests. State and call log live in the file named by MOCK_STATE.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = process.env.MOCK_STATE;
const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { buckets: [], locks: [], lifecycle: [], secrets: [], calls: [] };
const args = process.argv.slice(2);
let stdin = "";
if (args[0] === "secret" && args[1] === "put") stdin = readFileSync(0, "utf8");
state.calls.push({ args, stdin });
const save = () => writeFileSync(file, JSON.stringify(state));
const cmd = args.slice(0, 2).join(" ");
let code = 0;
if (args[0] === "whoami") console.log(JSON.stringify({ loggedIn: true, accounts: [{ id: "a".repeat(32), name: "Test" }] }));
else if (cmd === "r2 bucket" && args[2] === "list") console.log(state.buckets.map((b) => `name:           ${b}\ncreation_date:  x\n`).join("\n"));
else if (cmd === "r2 bucket" && args[2] === "create") state.buckets.push(args[3]);
else if (cmd === "r2 bucket" && args[2] === "lock" && args[3] === "list") console.log(state.locks.map((l) => `name: ${l}`).join("\n") || "No lock rules");
else if (cmd === "r2 bucket" && args[2] === "lock" && args[3] === "add") {
  if (process.env.MOCK_NO_LOCK) {
    console.error("unknown command");
    code = 1;
  } else state.locks.push(args[5]);
} else if (cmd === "r2 bucket" && args[2] === "lifecycle" && args[3] === "list") console.log((state.lifecycle ?? []).map((l) => `name: ${l.name}`).join("\n") || "No lifecycle rules");
else if (cmd === "r2 bucket" && args[2] === "lifecycle" && args[3] === "add") {
  if (process.env.MOCK_NO_LIFECYCLE) {
    console.error("unknown command");
    code = 1;
  } else (state.lifecycle ??= []).push({ bucket: args[4], name: args[5], prefix: args[6], days: args[args.indexOf("--expire-days") + 1] });
} else if (cmd === "secret list") console.log(JSON.stringify(state.secrets.map((name) => ({ name, type: "secret_text" }))));
else if (cmd === "secret put") state.secrets.push(args[2]);
save();
process.exit(code);
