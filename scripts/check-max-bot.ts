import { readFileSync, statSync } from "node:fs";
import { parseArgs } from "node:util";
import { createMaxClient } from "../lib/max-api";

async function main() {
  const { values } = parseArgs({ options: { "token-file": { type: "string" } }, strict: true });
  let token = process.env.MAX_BOT_TOKEN;
  if (values["token-file"]) {
    const path = values["token-file"];
    try {
      const file = statSync(path);
      if (!file.isFile() || file.size > 4096 || !file.size) throw new Error();
      token = readFileSync(path, "utf8").trim();
    } catch { throw new Error("Cannot read MAX token file (expected a small, non-empty text file)"); }
  }
  if (!token) throw new Error("Set MAX_BOT_TOKEN or use --token-file with a private file outside the repository. Do not pass the token as an argument.");
  const bot = await createMaxClient(token).getBotInfo();
  console.log(JSON.stringify({ connected: true, bot, messagesSent: 0 }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "MAX bot check failed");
  process.exitCode = 1;
});
