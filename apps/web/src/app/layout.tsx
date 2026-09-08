import "@pushdocs/ui/styles.css";
import "./globals.css";
import "./workbench.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  description: "Self-hosted Docusaurus CMS for GitHub and GitLab",
  title: {
    default: "PushDocs",
    template: "%s | PushDocs",
  },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
