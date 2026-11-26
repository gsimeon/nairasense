import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NairaSense",
  description: "Accessible financial information companion",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#174a79",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
