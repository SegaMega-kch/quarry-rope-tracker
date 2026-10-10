import { getCurrentUser } from "@/lib/auth";
import { canUseProductionOcr, limitedBody, maximumPhotoBytes, OcrError, recognizeProductionPhoto } from "@/lib/production-ocr";
import { isMobilePhotoRequest } from "@/lib/production-mobile-photo";

export const runtime = "nodejs";
export const maxDuration = 100;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return Response.json({ message: "Войдите на сайт для проверки фото" }, { status: 401, headers });
  if (!canUseProductionOcr(actor)) return Response.json({ message: "Распознавание доступно только разрешённым пользователям" }, { status: 403, headers });
  // Browser calls must originate from the same site. No CORS or public OCR endpoint.
  let sameSite = false;
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    // Next's internal request.url may use localhost behind a reverse proxy; Host is the browser-facing host.
    sameSite = ["http:", "https:"].includes(origin.protocol) && origin.host === request.headers.get("host");
  } catch {}
  if (!sameSite) return Response.json({ message: "Запрос должен быть отправлен со страницы rapmas" }, { status: 403, headers });
  if (!isMobilePhotoRequest(request)) return Response.json({ message: "Фотографию можно прикрепить только с телефона или планшета" }, { status: 403, headers });
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.startsWith("multipart/form-data;")) throw new OcrError("Выберите фотографию через форму сайта", 400);
    const bytes = await limitedBody(request, maximumPhotoBytes + 64 * 1024);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) throw new OcrError("Прикрепите фотографию", 400);
    const result = await recognizeProductionPhoto(Buffer.from(await photo.arrayBuffer()));
    return Response.json(result, { headers });
  } catch (error) {
    // Raw OCR/provider errors can include production data or tokens; return safe messages only.
    return Response.json({ message: error instanceof OcrError ? error.message : "Не удалось обработать фото. Попробуйте ещё раз." }, { status: error instanceof OcrError ? error.status : 500, headers });
  }
}
