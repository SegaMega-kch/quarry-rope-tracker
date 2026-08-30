"use client";

import { cloneElement, createContext, Dispatch, ReactElement, ReactNode, SetStateAction, useContext, useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";

const MenuContext = createContext<{
  activeId: string | null;
  setActiveId: Dispatch<SetStateAction<string | null>>;
} | null>(null);

const nativeMenuSelector = "details.assembly-menu-wrap, details.yakno-edit-wrap";

export function OperationMenus({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => { setActiveId(null); }, [pathname]);

  useEffect(() => {
    function onToggle(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || !target.matches(nativeMenuSelector) || !target.open) return;
      setActiveId(null);
      document.querySelectorAll<HTMLDetailsElement>(nativeMenuSelector).forEach((menu) => {
        if (menu !== target) menu.open = false;
      });
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setActiveId(null);
      document.querySelectorAll<HTMLDetailsElement>(nativeMenuSelector).forEach((menu) => { menu.open = false; });
    }
    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (activeId) document.querySelectorAll<HTMLDetailsElement>(nativeMenuSelector).forEach((menu) => { menu.open = false; });
  }, [activeId]);

  return <MenuContext.Provider value={{ activeId, setActiveId }}>{children}</MenuContext.Provider>;
}

export function useExclusiveMenu() {
  const context = useContext(MenuContext);
  const id = useId();
  if (!context) throw new Error("OperationMenus provider is missing");
  const { activeId, setActiveId } = context;
  const setOpen: Dispatch<SetStateAction<boolean>> = (next) => {
    setActiveId((current) => {
      const isOpen = current === id;
      const shouldOpen = typeof next === "function" ? next(isOpen) : next;
      return shouldOpen ? id : isOpen ? null : current;
    });
  };
  return [activeId === id, setOpen] as const;
}

// Keep visited forms mounted so closing a menu never discards an unfinished draft.
export function MenuPanel({ open, children }: { open: boolean; children: ReactElement<{ hidden?: boolean }> }) {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (open) setVisited(true); }, [open]);
  if (!open && !visited) return null;
  return cloneElement(children, { hidden: !open });
}
