import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createMaxClient } from "../lib/max-api";
import { saveBlankTokenFile, startMaxSetup } from "../lib/max-setup";

async function main() {
  const { values } = parseArgs({ options: { "token-file": { type: "string" }, "state-file": { type: "string" }, "expected-username": { type: "string" } }, strict: true });
  if (!values["token-file"] || !values["state-file"] || !values["expected-username"]) throw new Error("Specify token-file, state-file and expected-username");
  const tokenFile = resolve(values["token-file"]);
  const stateFile = resolve(values["state-file"]);
  if (tokenFile === stateFile) throw new Error("State file must be separate from credentials");
  if (!statSync(tokenFile).isFile() || statSync(tokenFile).size > 8) throw new Error("Use the existing empty protected credential file");
  const assets = new Map([
    ["/avatar", { type: "image/png", data: readFileSync("public/max-bot-avatar.png") }],
    ["/font-info", { type: "font/woff2", data: readFileSync("public/fonts/IBMPlexSans-Regular.woff2") }],
    ["/font-action", { type: "font/woff2", data: readFileSync("public/fonts/IBMPlexSansCondensed-SemiBold.woff2") }]
  ]);
  const server = await startMaxSetup({
    expectedUsername: values["expected-username"],
    page: readFileSync("scripts/max-setup.html", "utf8"), assets,
    verify: (token) => createMaxClient(token).getBotInfo(),
    persist: (token) => saveBlankTokenFile(tokenFile, token),
    onComplete: (bot) => {
      writeFileSync(stateFile, JSON.stringify({ pid: process.pid, origin: server.origin, connected: true, bot, messagesSent: 0 }, null, 2) + "\n", { mode: 0o600 });
      console.log("MAX bot checked. Token stored. Messages sent: 0.");
    }
  });
  try {
    writeFileSync(stateFile, JSON.stringify({ pid: process.pid, origin: server.origin, expiresAt: server.expiresAt.toISOString(), connected: false, messagesSent: 0 }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) { await server.close(); throw error; }
  console.log(`Local MAX setup: ${server.origin}`);
}

main().catch(() => { console.error("MAX setup could not start. Check local paths and file permissions; no credentials are logged."); process.exitCode = 1; });
