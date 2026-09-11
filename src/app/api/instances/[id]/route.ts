import { NextResponse } from "next/server";
import { deleteInstance } from "@/lib/db";
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  deleteInstance(Number((await params).id));
  return NextResponse.json({ ok: true });
}
