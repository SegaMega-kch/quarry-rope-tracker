"use client";

import { ReactNode, useEffect, useId, useRef, useState, useTransition } from "react";
import { Plus, Settings2, Trash2, X } from "lucide-react";
import { useExclusiveMenu } from "./OperationMenus";

export function ManagementSection({ children }: { children: ReactNode }) {
  const id = useId();
  return <section className="management-section" aria-labelledby={id}>
    <h2 id={id}>Управление</h2>
    <div className="management-actions">{children}</div>
  </section>;
}

export function ManagementDialog({ title, children, kind = "edit" }: {
  title: string; children: ReactNode; kind?: "add" | "edit" | "delete";
}) {
  const [open, setOpen] = useExclusiveMenu();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const Icon = kind === "add" ? Plus : kind === "delete" ? Trash2 : Settings2;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) { if (element.open) element.close(); return; }
    element.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  return <>
    <button type="button" className="management-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Icon size={19} aria-hidden="true" /><span>{title}</span>
    </button>
    <dialog ref={dialog} className="management-dialog" aria-labelledby={id}
      onClose={() => setOpen(false)} onCancel={(event) => { event.preventDefault(); setOpen(false); }}>
      <header className="management-dialog-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="management-close" aria-label="Закрыть" title="Закрыть" onClick={() => setOpen(false)}><X size={22} /></button>
      </header>
      <div className="management-dialog-body">{children}</div>
    </dialog>
  </>;
}

export function ManagementForm({ action, children, className = "form", message }: {
  action: (data: FormData) => Promise<void | { error?: string; success?: boolean }>; children: ReactNode; className?: string; message?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  return <form className={className} aria-busy={pending} onSubmit={(event) => {
    event.preventDefault();
    if (pending || (message && !window.confirm(message))) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("");
    startTransition(async () => {
      try {
        const result = await action(data);
        if (result?.error) { setFailed(true); setStatus(result.error); return; }
        form.reset();
        setFailed(false);
        setStatus("Сохранено");
      } catch {
        setFailed(true);
        setStatus("Не удалось сохранить. Проверьте данные и повторите попытку.");
      }
    });
  }}>
    <fieldset disabled={pending} className="management-fields">{children}</fieldset>
    {pending || status ? <p className={failed ? "management-error" : "management-status"} role={failed ? "alert" : "status"}>{pending ? "Сохранение…" : status}</p> : null}
  </form>;
}
