"use server";

import { readFileSync } from "node:fs";
import { requireUser } from "@/lib/auth";
import { createMaxClient } from "@/lib/max-api";
import { openReferenceSource } from "@/lib/max-reference-config";
import { loadPpDeliveryConfig } from "@/lib/pp-delivery-config";
import { deliverPpSnapshot, openPpDeliveryState, type PpSendResult } from "@/lib/pp-delivery";
import { collectPpSnapshot } from "@/lib/pp-snapshot";

export async function sendPpSnapshotAction(requestId: string): Promise<PpSendResult> {
  const user = await requireUser();
  if (!process.env.MAX_REFERENCE_CONFIG || !process.env.MAX_PP_STATE_DATABASE) {
    return { state: "failed", message: "Отправка MAX на этом сервере не настроена. Сообщение не отправлено." };
  }
  let state: Awaited<ReturnType<typeof openPpDeliveryState>> | undefined;
  let source: Awaited<ReturnType<typeof openReferenceSource>> | undefined;
  try {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification required");
    const config = loadPpDeliveryConfig();
    state = await openPpDeliveryState(config.manualStateDatabase, config);
    source = await openReferenceSource(config.sourceDatabase);
    const snapshot = await collectPpSnapshot(source);
    const client = createMaxClient(readFileSync(config.tokenFile, "utf8").trim());
    return await deliverPpSnapshot(state, client, requestId, user.id, snapshot.messages);
  } catch {
    return { state: "review", message: "Не удалось подтвердить отправку. Проверьте группу перед повтором; обратитесь к администратору." };
  } finally {
    await source?.$disconnect();
    await state?.close();
  }
}
