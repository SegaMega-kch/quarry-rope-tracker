import { parseArgs } from "node:util";
import { loadPpDeliveryConfig } from "../lib/pp-delivery-config";
import { openPpDeliveryState } from "../lib/pp-delivery";
import { openReferenceSource } from "../lib/max-reference-config";
import { collectPpSnapshot } from "../lib/pp-snapshot";

async function main() {
  const { values } = parseArgs({ options: { mode: { type: "string" }, id: { type: "string" }, "confirm-checked": { type: "boolean" } } });
  if (!["init", "status", "preview", "inspect", "acknowledge"].includes(values.mode ?? "")) throw new Error("Choose a PP mode");
  const config = loadPpDeliveryConfig();
  if (values.mode === "preview") {
    const db = await openReferenceSource(config.sourceDatabase);
    try { console.log(JSON.stringify(await collectPpSnapshot(db), null, 2)); }
    finally { await db.$disconnect(); }
    return;
  }
  const state = await openPpDeliveryState(config.manualStateDatabase, config, values.mode === "init");
  try {
    if (values.mode === "acknowledge") {
      if (!values.id || !values["confirm-checked"]) throw new Error("Inspect the group and confirm before acknowledging");
      await state.acknowledge(values.id);
      console.log("PP delivery reviewed. No messages sent or retried.");
    }
    if (values.mode === "inspect") {
      if (!values.id) throw new Error("Choose a request ID");
      console.log(JSON.stringify(await state.parts(values.id), (_, value) => typeof value === "bigint" ? Number(value) : value, 2));
    } else console.log(JSON.stringify(await state.status()));
  } finally { await state.close(); }
}
main().catch(() => { console.error("PP operation stopped. Check private configuration and delivery status. Do not reset the state."); process.exitCode = 1; });
