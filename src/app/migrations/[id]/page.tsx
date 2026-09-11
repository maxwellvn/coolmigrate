"use client";
import { use, useEffect, useRef, useState } from "react";
import { Skeleton, Spinner, useUI } from "../../ui";

type M = { id: number; status: string; title: string; log: string; result: string | null; request: string; state: string };
const cls = (l: string) =>
  /FAILED|MISMATCH|^\[[\d:]+\]\s+! |error/i.test(l) ? "var(--bad)" :
  /^\[[\d:]+\] \[\d\/\d\]|\[action\]/.test(l) ? "var(--fg)" :
  /done\.|copied|created|engine ready|status: running/.test(l) ? "var(--ok)" :
  /^\[[\d:]+\]\s{4}/.test(l) ? "var(--dim)" : "var(--muted)";

export default function MigrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ui = useUI();
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

  const resume = async () => { const r = await fetch(`/api/migrations/${id}/resume`, { method: "POST" }); if (!r.ok) ui.toast("bad", (await r.json()).error); else ui.toast("info", "Resuming from the last checkpoint"); setGen((g) => g + 1); };
  const act = async (side: "source" | "destination", op: "stop" | "start" | "delete") => {
    let confirmWord: string | undefined;
    if (op === "delete") {
      const v = await ui.prompt({ title: `Delete ${side} permanently?`, body: `Removes the ${side} app and its databases, including volumes, from Coolify. There is no undo.`, confirmText: "Delete", danger: true, input: { placeholder: "DELETE", mustEqual: "DELETE" } });
      if (v !== "DELETE") return; confirmWord = v;
    } else if (!(await ui.confirm({ title: `${op === "stop" ? "Stop" : "Start"} ${side}?`, body: op === "stop" ? "Containers stop; data and config stay. Start brings them back." : "Containers start again with their existing data.", confirmText: op === "stop" ? "Stop" : "Start", danger: op === "stop" }))) return;
    setBusy(`${op} ${side}`);
    const j = await fetch(`/api/migrations/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ side, op, confirm: confirmWord }) }).then((r) => r.json());
    setBusy(""); ui.toast(j.error ? "bad" : "ok", j.error ?? `${op} ${side}: ${(j.results ?? []).length} resource(s)`); setGen((g) => g + 1);
    // Coolify applies stop/start asynchronously; poll a few times so the badges catch up
    for (const t of [2000, 6000, 12000]) setTimeout(refreshLive, t);
  };
  useEffect(() => { if (status !== "running") refreshLive(); }, [status, gen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return <div><div className="page-head"><div><Skeleton w={90} h={11} /><div className="mt-3"><Skeleton w={320} h={24} /></div></div></div><div className="log"><div className="panel-head"><Skeleton w={40} /></div><div className="p-4 space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i}><Skeleton w={`${55 + (i * 17) % 40}%`} h={12} /></div>)}</div></div></div>;
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
    return <button key={op} className={`btn ${danger ? "btn-danger" : ""}`} disabled={off} onClick={() => act(side, op)}>{busy === `${op} ${side}` && <Spinner />}{op}</button>;
  };
  const badge = (x: Res) => (
    <div key={x.uuid} className="flex items-center gap-2 text-sm py-1">
      <span className={`dot ${running(x) ? "ok" : x.status === "deleted" ? "" : "bad"}`} />
      <span className="flex-1 truncate">{x.name}</span>
      <span className="pill">{x.kind}</span>
      <span className={`pill ${running(x) ? "ok" : x.status === "deleted" ? "" : "bad"}`}>{x.status}</span>
    </div>
  );
  return (<div>
    <div className="page-head">
      <div><p className="eyebrow mb-2">Migration #{m.id}</p><h1 className="flex items-center gap-3"><span className={`dot ${dot}`} />{m.title}</h1></div>
      <div className="flex items-center gap-2">
        <span className={`pill ${dot}`}>{status}</span>
        {status === "failed" && <button className="btn btn-primary" onClick={resume}>Resume from last step</button>}
      </div>
    </div>
    <div className="log">
      <div className="panel-head"><span className="panel-title">Log</span><span className="mono" style={{ color: "var(--dim)" }}>{lines.length} lines{status === "running" ? " · live" : ""}</span></div>
      <pre ref={pre} className="mono max-h-[60vh] overflow-auto">
        {lines.length === 0 && <span style={{ color: "var(--dim)" }}>waiting for first log line…</span>}
        {lines.map((l, i) => <div key={i} style={{ color: cls(l) }}>{l}</div>)}
        {status === "running" && <div style={{ color: "var(--warn)" }}>▍</div>}
      </pre>
    </div>
    {status !== "running" && (
      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2"><span className="panel-title">Source</span><span className="mono" style={{ color: "var(--dim)" }}>{req.appUuid ? "app + " : ""}{req.dbUuids.length} db</span></div>
          <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Stop once the new copy is verified and DNS has moved. Start again to roll back. Delete only after a few quiet days.</p>
          <div className="mb-3">{live ? live.source.map(badge) : <span className="text-sm flex items-center gap-2" style={{ color: "var(--dim)" }}><Spinner /> checking state</span>}</div>
          <div className="flex gap-2">{btn("source", "stop")}{btn("source", "start")}{btn("source", "delete", true)}</div>
        </div>
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2"><span className="panel-title">Destination copy</span></div>
          <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>{hasDest ? "Delete removes everything this migration created, for a clean rerun." : "Nothing was created on the destination."}</p>
          <div className="mb-3">{live ? live.destination.map(badge) : hasDest && <span className="text-sm flex items-center gap-2" style={{ color: "var(--dim)" }}><Spinner /> checking state</span>}</div>
          {hasDest && <div className="flex gap-2">{btn("destination", "stop")}{btn("destination", "start")}{btn("destination", "delete", true)}</div>}
        </div>
      </div>
    )}
  </div>);
}
