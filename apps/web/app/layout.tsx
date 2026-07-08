import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Ourchival",
  description: "A private archive for the images that stay with you.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
