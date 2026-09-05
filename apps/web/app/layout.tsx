import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./styles.css";

export const metadata: Metadata = {
  title: "Ourchival",
  description: "A private archive for the images that stay with you.",
  icons: { icon: "/archive-cat.png", apple: "/archive-cat.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className={GeistSans.className}>{children}</body>
    </html>
  );
}
