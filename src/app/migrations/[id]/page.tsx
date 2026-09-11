"use client";
import { use, useEffect, useRef, useState } from "react";

type M = { id: number; status: string; title: string; log: string; result: string | null; request: string; state: string };
const cls = (l: string) =>
  /FAILED|MISMATCH|^\[[\d:]+\]\s+! |error/i.test(l) ? "var(--bad)" :
  /^\[[\d:]+\] \[\d\/\d\]|\[action\]/.test(l) ? "var(--fg)" :
  /done\.|copied|created|engine ready|status: running/.test(l) ? "var(--ok)" :
  /^\[[\d:]+\]\s{4}/.test(l) ? "var(--dim)" : "var(--muted)";

export default function MigrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [m, setM] = useState<M | null>(null);
  const [log, setLog] = useState("");
  const [status, setStatus] = useState("running");
  const [gen, setGen] = useState(0);
  const [busy, setBusy] = useState("");
  type Res = { kind: "app" | "db"; uuid: string; name: string; status: string };
  const [live, setLive] = useState<{ source: Res[]; destination: Res[] } | null>(null);
  const refreshLive = () => fetch(`/api/migrations/${id}/status`).then((r) => r.json()).then(setLive);
  const pre = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    fetch(`/api/migrations/${id}`).then((r) => r.json()).then((j: M) => {
      setM(j); setLog(j.log); setStatus(j.status);
      if (j.status !== "running") return;
      // stream continues from where the snapshot ended, so nothing duplicates or gets wiped
      es = new EventSource(`/api/migrations/${id}/stream?from=${j.log.length}`);
      es.addEventListener("log", (e) => setLog((l) => l + JSON.parse((e as MessageEvent).data)));
      es.addEventListener("status", (e) => { const s = JSON.parse((e as MessageEvent).data); setStatus(s); if (s !== "running") es?.close(); });
    });
    return () => es?.close();
  }, [id, gen]);
  useEffect(() => { pre.current?.scrollTo(0, pre.current.scrollHeight); }, [log]);

  const resume = async () => { await fetch(`/api/migrations/${id}/resume`, { method: "POST" }); setGen((g) => g + 1); };
  const act = async (side: "source" | "destination", op: "stop" | "start" | "delete") => {
    let confirmWord: string | undefined;
    if (op === "delete") {
      confirmWord = prompt(`This permanently deletes the ${side} app and its databases, including volumes. Type DELETE to confirm.`) ?? undefined;
      if (confirmWord !== "DELETE") return;
    } else if (!confirm(`${op} the ${side} app and databases?`)) return;
    setBusy(`${op} ${side}`);
    const j = await fetch(`/api/migrations/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ side, op, confirm: confirmWord }) }).then((r) => r.json());
    setBusy(""); if (j.error) alert(j.error); setGen((g) => g + 1);
    // Coolify applies stop/start asynchronously; poll a few times so the badges catch up
    for (const t of [2000, 6000, 12000]) setTimeout(refreshLive, t);
  };
  useEffect(() => { if (status !== "running") refreshLive(); }, [status, gen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return <p style={{ color: "var(--muted)" }}>Loading…</p>;
  const req = JSON.parse(m.request), st = JSON.parse(m.state || "{}");
  const hasDest = !!st.newAppUuid || Object.keys(st.dbs ?? {}).length > 0;
  const lines = log.split("\n").filter(Boolean);
  const dot = status === "done" ? "ok" : status === "failed" ? "bad" : "run";
  const running = (x: Res) => x.status.startsWith("running");
  const btn = (side: "source" | "destination", op: "stop" | "start" | "delete", danger?: boolean) => {
    const list = live?.[side] ?? [];
    const alive = list.filter((x) => x.status !== "deleted");
    const off = !live || !!busy || status === "running" || alive.length === 0 ||
      (op === "stop" && !alive.some(running)) || (op === "start" && alive.every(running));
    return <button key={op} className={`btn ${danger ? "btn-danger" : ""}`} disabled={off} onClick={() => act(side, op)}>{busy === `${op} ${side}` ? "…" : op}</button>;
  };
  const badge = (x: Res) => (
    <div key={x.uuid} className="flex items-center gap-2 text-sm py-1">
      <span className={`dot ${running(x) ? "ok" : x.status === "deleted" ? "" : "bad"}`} />
      <span className="flex-1 truncate">{x.name}</span>
      <span className="mono" style={{ color: "var(--muted)" }}>{x.kind} · {x.status}</span>
    </div>
  );
  return (<div>
    <p className="eyebrow mb-1">Migration #{m.id}</p>
    <h1 className="text-lg font-semibold mb-4"><span className={`dot ${dot}`} />{m.title} <span className="mono ml-2" style={{ color: "var(--muted)" }}>{status}</span></h1>
    {status === "failed" && <button className="btn btn-primary mb-3" onClick={resume}>Resume from last completed step</button>}
    <pre ref={pre} className="panel mono p-4 max-h-[60vh] overflow-auto whitespace-pre-wrap leading-5">
      {lines.length === 0 && <span style={{ color: "var(--dim)" }}>waiting for first log line…</span>}
      {lines.map((l, i) => <div key={i} style={{ color: cls(l) }}>{l}</div>)}
      {status === "running" && <div style={{ color: "var(--warn)" }}>▍</div>}
    </pre>
    {status !== "running" && (
      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div className="panel p-4">
          <p className="eyebrow mb-2">Source ({req.appUuid ? "app + " : ""}{req.dbUuids.length} db)</p>
          <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Stop once the new copy is verified and DNS has moved. Start again to roll back. Delete only after a few quiet days.</p>
          <div className="mb-3">{live ? live.source.map(badge) : <span className="text-sm" style={{ color: "var(--dim)" }}>checking state…</span>}</div>
          <div className="flex gap-2">{btn("source", "stop")}{btn("source", "start")}{btn("source", "delete", true)}</div>
        </div>
        <div className="panel p-4">
          <p className="eyebrow mb-2">Destination copy</p>
          <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>{hasDest ? "Delete removes everything this migration created, for a clean rerun." : "Nothing was created on the destination."}</p>
          <div className="mb-3">{live ? live.destination.map(badge) : hasDest && <span className="text-sm" style={{ color: "var(--dim)" }}>checking state…</span>}</div>
          {hasDest && <div className="flex gap-2">{btn("destination", "stop")}{btn("destination", "start")}{btn("destination", "delete", true)}</div>}
        </div>
      </div>
    )}
  </div>);
}
