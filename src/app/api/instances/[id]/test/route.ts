/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getInstance } from "@/lib/db";
import { api } from "@/lib/coolify";
import { connect, exec, sshConfig } from "@/lib/ssh";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const inst = getInstance(Number((await params).id));
  if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
  const out: Record<string, string> = {};
  try { out.api = `ok, Coolify ${await api(inst).get("/version")}`; } catch (e: any) { out.api = `fail: ${e.message}`; }
  try {
    const c = await connect(sshConfig(inst));
    const r = await exec(c, "docker --version"); c.end();
    out.ssh = r.code === 0 ? `ok, ${r.out.trim()}` : `fail: ${r.err || r.out}`;
  } catch (e: any) { out.ssh = `fail: ${e.message}`; }
  return NextResponse.json(out);
}
