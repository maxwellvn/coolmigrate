/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { appendLog, getInstance, getMigration } from "@/lib/db";
import { api } from "@/lib/coolify";

type Side = "source" | "destination";
type Op = "stop" | "start" | "delete";

/** Post-migration controls. Source resources come from the request, destination ones from the checkpoint state. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const m = getMigration(id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { side, op, confirm } = (await req.json()) as { side: Side; op: Op; confirm?: string };
  if (op === "delete" && confirm !== "DELETE") return NextResponse.json({ error: "type DELETE to confirm" }, { status: 400 });
  const r = JSON.parse(m.request), st = JSON.parse(m.state);
  const inst = getInstance(side === "source" ? r.sourceInstanceId : r.destInstanceId);
  if (!inst) return NextResponse.json({ error: "instance missing" }, { status: 400 });
  const A = api(inst);
  const apps: string[] = side === "source" ? (r.appUuid ? [r.appUuid] : []) : st.newAppUuid ? [st.newAppUuid] : [];
  const dbs: string[] = side === "source" ? r.dbUuids : Object.values(st.dbs ?? {}).map((d: any) => d.newUuid);
  const results: string[] = [];
  const call = async (label: string, path: string, method: "get" | "delete" = "get") => {
    try { await A[method](path); results.push(`${label}: ok`); }
    catch (e: any) { results.push(`${label}: ${e.message}`); }
  };
  // apps first so nothing writes to a DB being stopped or removed
  for (const u of apps) {
    if (op === "delete") await call(`app ${u}`, `/applications/${u}?delete_volumes=true&delete_configurations=true&docker_cleanup=true`, "delete");
    else await call(`app ${u}`, `/applications/${u}/${op}${op === "start" ? "?instant_deploy=true" : ""}`);
  }
  for (const u of dbs) {
    if (op === "delete") await call(`db ${u}`, `/databases/${u}?delete_volumes=true&delete_configurations=true&docker_cleanup=true`, "delete");
    else await call(`db ${u}`, `/databases/${u}/${op}`);
  }
  appendLog(id, `[action] ${op} ${side} (${inst.name}): ${results.join("; ") || "nothing to do"}`);
  return NextResponse.json({ results });
}
