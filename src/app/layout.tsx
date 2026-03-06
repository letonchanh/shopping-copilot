import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shopping Copilot",
  description:
    "Connect your Amazon and Shopify orders. Get AI-powered insights, catch waste, and unlock your Shopping Wrapped.",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
