import { redirect } from "next/navigation";
import { optionalUser, repository } from "@/lib/server";

export default async function HomePage() {
  if (!(await repository().isBootstrapped())) redirect("/setup");
  if (!(await optionalUser())) redirect("/login");
  redirect("/projects");
}
