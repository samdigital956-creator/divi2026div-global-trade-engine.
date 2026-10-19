import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Global Trade & Customs AI Engine", template: "%s · Global Trade" },
  description: "Shipment documentation and review workspace for global importers.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#070d1a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
