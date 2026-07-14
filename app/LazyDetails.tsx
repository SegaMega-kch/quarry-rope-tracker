"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactNode } from "react";

export function LazyDetails({
  label,
  queryKey,
  open,
  className = "history-details",
  children
}: {
  label: string;
  queryKey: string;
  open: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleToggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    const nextOpen = event.currentTarget.open;
    if (nextOpen === open) return;

    const params = new URLSearchParams(searchParams.toString());
    if (nextOpen) params.set(queryKey, "1");
    else params.delete(queryKey);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <details className={className} open={open} onToggle={handleToggle}>
      <summary><span>{label}</span></summary>
      {open ? children : null}
    </details>
  );
}
