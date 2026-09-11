import { NextResponse } from "next/server";
import { hasRunningMigration } from "@/lib/db";

export async function POST(req: Request) {
  const { force } = await req.json().catch(() => ({ force: false }));
  if (hasRunningMigration() && !force) return NextResponse.json({ error: "a migration is still running" }, { status: 409 });
  setTimeout(() => process.exit(0), 300); // let the response leave first
  return NextResponse.json({ ok: true });
}
