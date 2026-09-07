import "server-only";

import { PushDocs } from "@pushdocs/core";
import { getDatabase, hashOpaqueToken, PushDocsRepository } from "@pushdocs/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const sessionCookieName = "pushdocs_session";

export interface CurrentUser {
  displayName: string;
  email: string;
  id: string;
  isInstanceOperator: boolean;
}

export function repository(): PushDocsRepository {
  return new PushDocsRepository(getDatabase());
}

export function application(): PushDocs {
  return new PushDocs(repository());
}

export async function optionalUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(sessionCookieName)?.value;
  if (!token) return null;
  const user = await repository().findUserBySessionHash(hashOpaqueToken(token));
  if (!user) return null;
  return {
    displayName: user.display_name,
    email: user.email,
    id: user.id,
    isInstanceOperator: user.is_instance_operator,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await optionalUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOperator(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isInstanceOperator) redirect("/projects");
  return user;
}

export function actor(user: CurrentUser) {
  return { id: user.id, isInstanceOperator: user.isInstanceOperator };
}
