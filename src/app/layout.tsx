import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontdesk",
  description: "Support tickets for Arvo Systems",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
