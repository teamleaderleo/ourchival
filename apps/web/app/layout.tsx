import type { Metadata } from "next";
import { ConvexClientProvider } from "./ConvexClientProvider";
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
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
