import { getCurrentUser } from "@/lib/auth";
import { canUseProduction, productionStore } from "@/lib/production-store";
import { renderProductionReportImages } from "@/lib/production-report-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ message: "Войдите на сайт" }, { status: 401, headers });
  if (!canUseProduction(actor.role)) return Response.json({ message: "Нет доступа к отчётам" }, { status: 403, headers });
  try {
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ message: "Некорректная версия отчёта" }, { status: 400, headers });
    const version = await (await productionStore()).version(id);
    if (version.kind !== "final") return Response.json({ message: "Изображение формируется только для итоговой версии" }, { status: 409, headers });
    const images = await renderProductionReportImages(version);
    const part = Number(new URL(request.url).searchParams.get("part") ?? "1");
    if (!Number.isInteger(part) || part < 1 || part > images.length) return Response.json({ message: "Такой страницы отчёта нет" }, { status: 404, headers });
    return new Response(new Uint8Array(images[part - 1]), { headers: { ...headers, "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="shift-report-${version.snapshot.period.date}-${part}.png"` } });
  } catch {
    return Response.json({ message: "Не удалось сформировать изображение отчёта" }, { status: 500, headers });
  }
}
