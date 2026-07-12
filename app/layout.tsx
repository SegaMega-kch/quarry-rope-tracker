import type { Metadata, Viewport } from "next";
import type React from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "Учет канатов",
  description: "Мобильный учет канатов на карьере"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f7f6f2"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
