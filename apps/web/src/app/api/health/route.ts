import { checkDatabase } from "@pushdocs/db";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    await checkDatabase();
    return NextResponse.json({ database: "ready", status: "ok" });
  } catch {
    return NextResponse.json({ database: "unavailable", status: "error" }, { status: 503 });
  }
}
