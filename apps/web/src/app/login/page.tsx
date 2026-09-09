import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions";
import { AuthPanel } from "@/components/auth-panel";
import { optionalUser, repository } from "@/lib/server";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!(await repository().isBootstrapped())) redirect("/setup");
  if (await optionalUser()) redirect("/projects");
  const query = await searchParams;
  return (
    <AuthPanel title="Вход">
      {query.error === "credentials" ? (
        <p className="form-error" role="alert">
          Email или пароль не подошли.
        </p>
      ) : null}
      <form action={loginAction} className="auth-form">
        <label>
          Email
          <input name="email" required type="email" autoComplete="email" />
        </label>
        <label>
          Пароль
          <input name="password" required type="password" autoComplete="current-password" />
        </label>
        <button className="pd-button pd-button--primary auth-submit" type="submit">
          Войти
        </button>
      </form>
      <details className="auth-help">
        <summary>Не получается войти?</summary>
        <p>Для восстановления доступа обратитесь к оператору установки.</p>
      </details>
    </AuthPanel>
  );
}
