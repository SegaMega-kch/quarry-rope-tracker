import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { loadReferenceConfig } from "./max-reference-config";

export function loadPpDeliveryConfig() {
  const referencePath = process.env.MAX_REFERENCE_CONFIG;
  const stateDatabase = process.env.MAX_PP_STATE_DATABASE;
  if (!referencePath || !stateDatabase) throw new Error("PP delivery is not configured");
  const reference = loadReferenceConfig(referencePath);
  if (!isAbsolute(stateDatabase) || /[?#]/.test(stateDatabase)) throw new Error("Invalid PP state path");
  for (const protectedPath of [referencePath, reference.sourceDatabase, reference.stateDatabase, reference.tokenFile, reference.webhookSecretFile]) {
    if (resolve(stateDatabase) === resolve(protectedPath)) throw new Error("PP state must be separate");
    if (!existsSync(stateDatabase) || !existsSync(protectedPath)) continue;
    const a = statSync(stateDatabase), b = statSync(protectedPath);
    if (realpathSync(stateDatabase) === realpathSync(protectedPath) || (a.dev === b.dev && a.ino === b.ino)) throw new Error("PP paths alias each other");
  }
  return { ...reference, manualStateDatabase: stateDatabase };
}
