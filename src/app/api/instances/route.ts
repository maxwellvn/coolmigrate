import { NextResponse } from "next/server";
import { listInstances, upsertInstance } from "@/lib/db";

const safe = (i: ReturnType<typeof listInstances>[number]) =>
  ({ id: i.id, name: i.name, url: i.url, ssh_host: i.ssh_host, ssh_user: i.ssh_user, hasToken: !!i.token, hasPassword: !!i.ssh_password, hasKey: !!i.ssh_key });

export async function GET() { return NextResponse.json(listInstances().map(safe)); }

export async function POST(req: Request) {
  const b = await req.json();
  if (!b.name || !b.url || !b.ssh_host || (!b.id && !b.token)) return NextResponse.json({ error: "name, url, ssh_host, token required" }, { status: 400 });
  if (!/^https?:\/\//.test(b.url)) return NextResponse.json({ error: "url must start with http(s)://" }, { status: 400 });
  const id = upsertInstance(b);
  return NextResponse.json({ id });
}
