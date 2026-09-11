import Link from "next/link";
import { listMigrations } from "@/lib/db";
export const dynamic = "force-dynamic";
export default function History() {
  const list = listMigrations();
  return (<div><p className="eyebrow mb-3">Migrations</p><div className="panel">
    {list.length === 0 && <div className="row" style={{ color: "var(--muted)" }}>Nothing yet.</div>}
    {list.map((m) => (<Link key={m.id} href={`/migrations/${m.id}`} className="row">
      <span className={`dot ${m.status === "done" ? "ok" : m.status === "failed" ? "bad" : "run"}`} />
      <span className="flex-1">{m.title}</span><span className="mono" style={{ color: "var(--muted)" }}>{m.status} · {m.created_at}</span></Link>))}
  </div></div>);
}
