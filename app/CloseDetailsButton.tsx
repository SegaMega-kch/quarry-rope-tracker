"use client";

export function CloseDetailsButton({ children = "Закрыть" }: { children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        const details = event.currentTarget.closest("details");
        if (details) details.open = false;
      }}
    >
      {children}
    </button>
  );
}
