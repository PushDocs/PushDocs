import "server-only";
import { hashOpaqueToken } from "@pushdocs/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { repository, sessionCookieName } from "./server";

export class TwoFactorError extends Error {}

export async function authenticationSession() {
  const token = (await cookies()).get(sessionCookieName)?.value;
  const session = token
    ? await repository().getAuthenticationSession(hashOpaqueToken(token))
    : undefined;
  if (!session) redirect("/login");
  return session;
}

export async function requireTwoFactor(userId: string, formData: FormData): Promise<void> {
  const user = await repository().getSecurityUser(userId);
  if (!user?.totp_secret) throw new TwoFactorError("Сначала подключите 2FA в настройках профиля.");
  if (!(await repository().consumeTotp(userId, String(formData.get("otp") ?? "").trim()))) {
    throw new TwoFactorError(
      "Код 2FA неверен или уже использован. Введите новый код. После 10 попыток подождите 15 минут.",
    );
  }
}
