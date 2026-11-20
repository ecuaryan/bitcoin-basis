#!/usr/bin/env node
// Post-deploy smoke test: the status endpoint answers and security headers are present on the app and the API.
//   node tools/smoke-test.mjs <origin> [--retries 6]
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
];

/** Returns a list of problems (empty = healthy). */
export async function smoke(origin, fetchImpl = fetch) {
  const base = origin.replace(/\/+$/, "");
  const problems = [];
  const headerProblems = (label, res) => {
    for (const h of REQUIRED_HEADERS) if (!res.headers.get(h)) problems.push(`${label}: missing ${h} header`);
    if (res.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff") problems.push(`${label}: x-content-type-options is not nosniff`);
    if (!/script-src 'self'/.test(res.headers.get("content-security-policy") ?? "")) problems.push(`${label}: CSP lacks script-src 'self'`);
  };
  try {
    const res = await fetchImpl(`${base}/api/status`);
    if (res.status !== 200) problems.push(`/api/status returned HTTP ${res.status}`);
    else {
      const body = await res.json().catch(() => null);
      if (!body || typeof body.claimed !== "boolean") problems.push("/api/status did not return { claimed: boolean }");
    }
    headerProblems("/api/status", res);
  } catch (e) {
    problems.push(`/api/status unreachable: ${e.message}`);
  }
  try {
    const res = await fetchImpl(`${base}/`);
    if (res.status !== 200) problems.push(`/ returned HTTP ${res.status}`);
    else if (!/<div id="root">/.test(await res.text())) problems.push("/ does not look like the app");
    headerProblems("/", res);
  } catch (e) {
    problems.push(`/ unreachable: ${e.message}`);
  }
  return problems;
}

async function main() {
  const [origin, flag, n] = process.argv.slice(2);
  if (!origin || !/^https:\/\//.test(origin) || (flag !== undefined && (flag !== "--retries" || !(Number(n) >= 1)))) {
    console.error("Usage: smoke-test.mjs <https-origin> [--retries n]");
    process.exit(2);
  }
  const retries = flag ? Number(n) : 1;
  let problems = [];
  for (let attempt = 1; attempt <= retries; attempt++) {
    problems = await smoke(origin);
    if (problems.length === 0) break;
    if (attempt < retries) await new Promise((r) => setTimeout(r, 5000));
  }
  if (problems.length) {
    for (const p of problems) console.error(`::error::Smoke test: ${p}`);
    process.exit(1);
  }
  console.log(`Smoke test passed for ${origin}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
