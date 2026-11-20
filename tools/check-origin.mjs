#!/usr/bin/env node
// Deploy guard: the production ORIGIN must be https://<name>.workers.dev or an https custom origin.
// Never localhost, never http, no path/port/credentials. Prints the RP_ID (hostname) on success.
//   node tools/check-origin.mjs https://bitcoin-basis.you.workers.dev
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Returns { origin, rpId } or throws an Error with the reason. */
export function checkOrigin(input) {
  if (typeof input !== "string" || input.trim() === "") throw new Error("APP_ORIGIN is empty or not set");
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`APP_ORIGIN is not a valid URL: ${input}`);
  }
  if (url.protocol !== "https:") throw new Error(`APP_ORIGIN must be https, got ${url.protocol}//`);
  if (url.username || url.password) throw new Error("APP_ORIGIN must not contain credentials");
  if (url.port) throw new Error("APP_ORIGIN must not contain a port");
  if (url.pathname !== "/" || url.search || url.hash || input.trim().endsWith("/")) {
    throw new Error("APP_ORIGIN must be a bare origin like https://bitcoin-basis.you.workers.dev (no trailing slash or path)");
  }
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("APP_ORIGIN must not be localhost");
  if (/^[\d.]+$/.test(host) || host.includes(":")) throw new Error("APP_ORIGIN must be a hostname, not an IP address");
  if (!host.includes(".")) throw new Error("APP_ORIGIN hostname must be a full domain name");
  if (host === "workers.dev") throw new Error("APP_ORIGIN must be <name>.<subdomain>.workers.dev");
  return { origin: url.origin, rpId: host };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(checkOrigin(process.argv[2]).rpId);
  } catch (e) {
    console.error(`::error::Refusing to deploy: ${e.message}`);
    process.exit(1);
  }
}
