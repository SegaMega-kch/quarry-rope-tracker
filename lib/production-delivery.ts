import { createMaxClient, MaxApiError } from "./max-api";
import { loadProductionDeliveryConfiguration, readProductionDeliveryToken } from "./production-delivery-config";
import { renderProductionReportImages } from "./production-report-image";
import type { Actor, ProductionStore } from "./production-store";

export async function deliverProductionVersion(store: ProductionStore, versionId: string, operation: string, actor: Actor) {
  const config = loadProductionDeliveryConfiguration();
  const client = createMaxClient(readProductionDeliveryToken(config));
  const [bot, chat, membership] = await Promise.all([
    client.getBotInfo(), client.getChatInfo(config.chatId), client.getBotMembership(config.chatId)
  ]);
  if (bot.id !== config.botId || bot.username !== config.botUsername || chat.id !== config.chatId || chat.type !== "chat" || chat.status !== "active" ||
    chat.title?.trim() !== config.chatTitle.trim() || membership.botId !== config.botId) throw new Error("Проверенная учётная запись или группа MAX не совпадает с настройкой");

  const destination = { id: config.chatId, label: config.chatTitle };
  const claim = await store.claimDelivery(versionId, operation, actor, destination);
  if (claim.status === "sent") return { status: "sent" as const, message: "Эта итоговая версия уже отправлена в MAX" };
  if (claim.status === "attention") return { status: "attention" as const, message: claim.state === "unknown"
    ? "Не удалось подтвердить прошлую отправку. Проверьте группу MAX; повтор автоматически заблокирован."
    : "Предыдущая отправка не завершена. Повтор заблокирован, чтобы не создать дубликат." };

  let messagePosted = false;
  try {
    const images = await renderProductionReportImages(claim.version);
    if (images.length > 12) throw new Error("Отчёт получился длиннее 12 изображений. Сократите причины или разделите отчёт вручную");
    const tokens: string[] = [];
    for (let index = 0; index < images.length; index++) tokens.push((await client.uploadImage(images[index], `shift-report-${versionId}-${index + 1}.png`)).token);
    // Small PNGs usually process immediately; this bounded pause avoids the documented attachment.not.ready race.
    await new Promise(resolve => setTimeout(resolve, 1200));
    const sent = await client.sendImages({ kind: "chat", id: config.chatId }, tokens);
    messagePosted = true;
    if (!await store.finishDelivery(versionId, config.chatId, { state: "sent", messageId: sent.messageId })) {
      throw new Error("MAX подтвердил отправку, но локальное подтверждение не сохранилось. Повтор запрещён до проверки группы");
    }
    return { status: "sent" as const, message: images.length === 1 ? "Итоговый отчёт отправлен в MAX одной картинкой" : `Итоговый отчёт отправлен в MAX: ${images.length} картинки` };
  } catch (error) {
    const state = messagePosted || (error instanceof MaxApiError && error.delivery === "unknown") ? "unknown" : "failed";
    try { await store.finishDelivery(versionId, config.chatId, { state, code: state === "unknown" ? "max-delivery-unknown" : "max-delivery-failed" }); } catch {}
    if (state === "unknown") return { status: "attention" as const, message: "MAX не подтвердил результат отправки. Проверьте группу; автоматический повтор заблокирован." };
    return { status: "failed" as const, message: "Картинки не отправлены. Повторите после проверки связи с MAX." };
  }
}
