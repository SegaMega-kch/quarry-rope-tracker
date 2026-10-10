"use client";
import { createProductionReportDocument } from "@/lib/production-report-model";
import type { Version } from "@/lib/production-domain";

export function ProductionReportPreview({ version, delivery, busy, onSend, onClose }: {
  version: Version; delivery: { ready: boolean; message: string }; busy: boolean; onSend: () => void; onClose: () => void;
}) {
  const document = createProductionReportDocument(version);
  return <section className="sp-report-preview" aria-labelledby="sp-report-preview-title">
    <div className="sp-preview-heading">
      <div><h3 id="sp-report-preview-title">Картинка итогового отчёта</h3><p>Версия {version.number} · {document.pages.length === 1 ? "одна картинка" : `${document.pages.length} картинки`}</p></div>
      <button type="button" className="ghost" disabled={busy} onClick={onClose}>Закрыть просмотр</button>
    </div>
    {document.incomplete > 0 && <div className="sp-preview-warning" role="status"><strong>Можно отправить неполный отчёт</strong><span>Незаполненных показателей: {document.incomplete}. На картинке они выделены красным и отмечены прочерком. Закройте просмотр, если хотите исправить данные и сохранить новую итоговую версию.</span></div>}
    <div className="sp-preview-pages">{document.pages.map((_, index) => <figure key={index}>
      <a href={`/api/production/report-image/${version.id}?part=${index + 1}`} target="_blank" rel="noreferrer" aria-label={`Открыть картинку ${index + 1} крупно`}>
        <img src={`/api/production/report-image/${version.id}?part=${index + 1}`} alt={`Итоговый отчёт за смену, страница ${index + 1} из ${document.pages.length}`} />
      </a>
      <figcaption>Картинка {index + 1} из {document.pages.length} · открыть крупно</figcaption>
    </figure>)}</div>
    <div className="sp-preview-send">
      <p>{delivery.message} В сообщение попадут только изображения, без текстовой расшифровки.</p>
      <button type="button" className="primary" disabled={busy || !delivery.ready} onClick={onSend}>{busy ? "Отправляем…" : "Отправить в MAX"}</button>
    </div>
  </section>;
}
