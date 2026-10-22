import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GitAI Collector", template: "%s · GitAI Collector" },
  description: "Огляд даних GitAI Collector. Лише читання.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
