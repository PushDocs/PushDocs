import type { ReactNode } from "react";
import { PushDocsLogo } from "./pushdocs-logo";

export function AuthPanel({
  children,
  description,
  title,
  wide = false,
}: {
  children: ReactNode;
  description?: string;
  title: string;
  wide?: boolean;
}) {
  return (
    <main className="auth-page">
      <section className="auth-main">
        <div className={`auth-card${wide ? " auth-card--wide" : ""}`}>
          <PushDocsLogo />
          <h1>{title}</h1>
          {description ? <p className="auth-description">{description}</p> : null}
          {children}
        </div>
      </section>
    </main>
  );
}
