import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { bootstrapAction } from "@/app/actions";
import { AuthPanel } from "@/components/auth-panel";
import { repository } from "@/lib/server";

export const metadata: Metadata = { title: "Первый запуск" };

export default async function SetupPage() {
  if (await repository().isBootstrapped()) redirect("/login");
  return (
    <AuthPanel
      eyebrow="Первый запуск"
      title="Создайте оператора установки"
      description="Оператор подключает Git-провайдеры и создаёт проекты. Роли участников назначаются отдельно в каждом проекте."
    >
      <form action={bootstrapAction} className="auth-form">
        <label>
          Имя
          <input name="displayName" required minLength={2} autoComplete="name" />
        </label>
        <label>
          Email
          <input name="email" required type="email" autoComplete="email" />
        </label>
        <label>
          Пароль
          <input
            name="password"
            required
            minLength={12}
            type="password"
            autoComplete="new-password"
          />
          <span className="field-note">Не менее 12 символов</span>
        </label>
        <button className="pd-button pd-button--primary auth-submit" type="submit">
          Создать установку
        </button>
      </form>
    </AuthPanel>
  );
}
