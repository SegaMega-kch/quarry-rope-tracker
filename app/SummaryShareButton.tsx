"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

export function SummaryShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      // If the browser blocks Web Share, fall back to copy/manual text below.
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setManual(true);
    }
  }

  return (
    <div className="form">
      <textarea aria-label="Текст сводки" rows={12} readOnly value={text} onFocus={(event) => event.currentTarget.select()} />
      <button className="summary-share-button" type="button" onClick={share}>
        <Share2 size={18} aria-hidden="true" />{" "}
        {copied ? "Скопировано" : "Поделиться"}
      </button>
      {manual ? <p role="status">Автоматическая отправка недоступна. Текст готов к копированию.</p> : null}
    </div>
  );
}
