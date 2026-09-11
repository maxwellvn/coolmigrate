/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getInstance, getMigration } from "@/lib/db";
import { api } from "@/lib/coolify";

/** Live state of every resource on both sides, straight from Coolify. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const m = getMigration(Number((await params).id));
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = JSON.parse(m.request), st = JSON.parse(m.state || "{}");
  const side = async (instId: number, apps: string[], dbs: string[]) => {
    const inst = getInstance(instId); if (!inst) return [];
    const A = api(inst);
    const one = (kind: "app" | "db", uuid: string) =>
      A.get(`/${kind === "app" ? "applications" : "databases"}/${uuid}`)
        .then((x: any) => ({ kind, uuid, name: x.name, status: String(x.status ?? "unknown") }))
        .catch((e: any) => ({ kind, uuid, name: uuid, status: /404/.test(e.message) ? "deleted" : "unreachable" }));
    return Promise.all([...apps.map((u) => one("app", u)), ...dbs.map((u) => one("db", u))]);
  };
  const [source, destination] = await Promise.all([
    side(r.sourceInstanceId, r.appUuid ? [r.appUuid] : [], r.dbUuids),
    side(r.destInstanceId, st.newAppUuid ? [st.newAppUuid] : [], Object.values(st.dbs ?? {}).map((d: any) => d.newUuid)),
  ]);
  return NextResponse.json({ source, destination });
}
