import { NextResponse } from "next/server";
import { getInstance } from "@/lib/db";
import { api } from "@/lib/coolify";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const inst = getInstance(Number((await params).id));
  if (!inst) return NextResponse.json({ error: "not found" }, { status: 404 });
  const A = api(inst);
  try {
    const [apps, dbs, servers, projects, githubApps] = await Promise.all([
      A.get("/applications"), A.get("/databases"), A.get("/servers"), A.get("/projects"), A.get("/github-apps").catch(() => []),
    ]);
    const slim = (a: any) => ({ uuid: a.uuid, name: a.name, environment_id: a.environment_id, status: a.status, fqdn: a.fqdn ?? null, database_type: a.database_type ?? null, build_pack: a.build_pack ?? null, git_repository: a.git_repository ?? null, source_id: a.source_id ?? null });
    return NextResponse.json({
      apps: apps.map(slim), dbs: dbs.map(slim),
      servers: servers.map((s: any) => ({ uuid: s.uuid, name: s.name, ip: s.ip })),
      projects: projects.map((p: any) => ({ uuid: p.uuid, name: p.name })),
      githubApps: githubApps.map((g: any) => ({ uuid: g.uuid, name: g.name, id: g.id, is_public: g.is_public })),
    });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
