"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function PendingButton({
  children,
  pendingText = "...",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pendingText?: ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button {...props} disabled={disabled || pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
