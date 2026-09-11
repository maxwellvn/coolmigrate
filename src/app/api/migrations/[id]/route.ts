import { NextResponse } from "next/server";
import { getMigration } from "@/lib/db";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const m = getMigration(Number((await params).id));
  return m ? NextResponse.json(m) : NextResponse.json({ error: "not found" }, { status: 404 });
}
