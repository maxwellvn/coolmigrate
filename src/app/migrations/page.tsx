import Link from "next/link";
import { listMigrations } from "@/lib/db";
export const dynamic = "force-dynamic";
export default function History() {
  const list = listMigrations();
  const n = (s: string) => list.filter((m) => m.status === s).length;
  return (<div>
    <div className="page-head"><div><h1>History</h1><p>Every migration with its log, checkpoint and post-migration controls.</p></div><Link href="/" className="btn btn-primary btn-sm">New migration</Link></div>
    <div className="stats mb-6">
      <div className="panel stat"><div className="k">Total</div><div className="v">{list.length}</div></div>
      <div className="panel stat"><div className="k">Done</div><div className="v" style={{ color: "var(--ok)" }}>{n("done")}</div></div>
      <div className="panel stat"><div className="k">Failed</div><div className="v" style={{ color: n("failed") ? "var(--bad)" : undefined }}>{n("failed")}</div></div>
      <div className="panel stat"><div className="k">Running</div><div className="v" style={{ color: n("running") ? "var(--warn)" : undefined }}>{n("running")}</div></div>
    </div>
    <div className="panel">
      {list.length === 0 && <div className="empty"><b>Nothing yet</b>Start a migration and it shows up here.</div>}
      {list.map((m) => (<Link key={m.id} href={`/migrations/${m.id}`} className="row">
        <span className={`dot ${m.status === "done" ? "ok" : m.status === "failed" ? "bad" : "run"}`} />
        <span className="mono" style={{ color: "var(--dim)", width: 36 }}>#{m.id}</span>
        <span className="flex-1 truncate">{m.title}</span>
        <span className={`pill ${m.status === "done" ? "ok" : m.status === "failed" ? "bad" : "run"}`}>{m.status}</span>
        <span className="mono" style={{ color: "var(--dim)" }}>{m.created_at}</span></Link>))}
    </div>
  </div>);
}
