"use client";

import { useState } from "react";

export function SummaryShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      // If the browser blocks Web Share, fall back to copy/manual text below.
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setOpen(true);
    }
  }

  return (
    <div className="summary-share-wrap">
      <button className="summary-share-button" type="button" onClick={share}>
        {copied ? "Скопировано" : "Поделиться"}
      </button>
      {open ? (
        <div className="summary-share-panel">
          <div className="quick-menu-head">
            <strong>Текст сводки</strong>
            <button type="button" onClick={() => setOpen(false)}>Закрыть</button>
          </div>
          <textarea readOnly value={text} onFocus={(event) => event.currentTarget.select()} />
          <p>Если кнопка не отправляет, выдели этот текст и отправь в мессенджер.</p>
        </div>
      ) : null}
    </div>
  );
}
