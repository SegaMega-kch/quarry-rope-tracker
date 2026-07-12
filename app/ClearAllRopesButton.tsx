"use client";

import { clearAllRopesAction } from "@/app/actions";

export function ClearAllRopesButton() {
  return (
    <form
      action={clearAllRopesAction}
      onSubmit={(event) => {
        if (!window.confirm("Удалить канат?")) event.preventDefault();
      }}
    >
      <button className="danger big" type="submit">Удалить весь канат</button>
    </form>
  );
}
