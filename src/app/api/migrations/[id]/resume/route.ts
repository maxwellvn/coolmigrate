import { NextResponse } from "next/server";
import { resumeMigration } from "@/lib/migrate";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try { resumeMigration(Number((await params).id)); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
