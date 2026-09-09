import type { Metadata } from "next";
import { ConnectionSettings } from "@/components/connection-settings";
export const metadata: Metadata = { title: "Подключения" };
export default function ConnectionsPage() {
  return <ConnectionSettings />;
}
