/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { listMigrations } from "@/lib/db";
import { startMigration, type MigrateRequest } from "@/lib/migrate";

export async function GET() { return NextResponse.json(listMigrations()); }
export async function POST(req: Request) {
  const b = (await req.json()) as MigrateRequest;
  if (!b.sourceInstanceId || !b.destInstanceId || !b.destServerUuid || !b.destProjectUuid || !b.destEnvironmentName)
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  if (!b.appUuid && !b.dbUuids?.length) return NextResponse.json({ error: "pick an app or at least one database" }, { status: 400 });
  try { return NextResponse.json({ id: startMigration(b) }); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
