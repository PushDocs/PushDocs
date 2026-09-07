import { BookOpenText, GitBranch, MessagesSquare } from "lucide-react";
import type { ReactNode } from "react";
import { PushDocsLogo } from "./pushdocs-logo";

export function AuthPanel({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Возможности PushDocs">
        <PushDocsLogo />
        <div className="auth-story-copy">
          <p className="eyebrow">Документация остаётся в Git</p>
          <h2>Один редактор для всех веток и проектов</h2>
          <ul>
            <li>
              <GitBranch aria-hidden />
              GitHub и GitLab, включая свои серверы
            </li>
            <li>
              <BookOpenText aria-hidden />
              Markdown, MDX, файлы и компоненты Docusaurus
            </li>
            <li>
              <MessagesSquare aria-hidden />
              Комментарии, проверки и конфликты в одном интерфейсе
            </li>
          </ul>
        </div>
        <p className="auth-story-foot">Self-hosted. Без обязательных облачных сервисов.</p>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
