"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Empty, SkeletonRows, Spinner, useUI } from "./ui";

type Inst = { id: number; name: string; url: string; ssh_host: string };
type App = { uuid: string; name: string; environment_id: number; status: string; fqdn: string | null; build_pack: string; git_repository: string | null; source_id: number | null };
type Db = { uuid: string; name: string; environment_id: number; status: string; database_type: string };
type Res = { apps: App[]; dbs: Db[]; servers: { uuid: string; name: string; ip: string }[]; projects: { uuid: string; name: string }[]; githubApps: { uuid: string; name: string; id: number; is_public: boolean }[] };
type Recent = { id: number; status: string; title: string; created_at: string };

const running = (s: string) => String(s).startsWith("running");

export default function Migrate() {
  const router = useRouter();
  const ui = useUI();
  const [insts, setInsts] = useState<Inst[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [srcId, setSrcId] = useState(0); const [dstId, setDstId] = useState(0);
  const [src, setSrc] = useState<Res | null>(null); const [dst, setDst] = useState<Res | null>(null);
  const [loading, setLoading] = useState<"src" | "dst" | "">("");
  const [appUuid, setAppUuid] = useState(""); const [dbUuids, setDbUuids] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [server, setServer] = useState(""); const [project, setProject] = useState("new"); const [projectName, setProjectName] = useState("");
  const [env, setEnv] = useState("production"); const [ghApp, setGhApp] = useState("");
  const [deploy, setDeploy] = useState(true); const [copyDomains, setCopyDomains] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/instances").then((r) => r.json()).then(setInsts);
    fetch("/api/migrations").then((r) => r.json()).then((l) => setRecent(l.slice(0, 5)));
  }, []);

  const loadRes = async (id: number, which: "src" | "dst") => {
    setLoading(which); setErr("");
    const j = await fetch(`/api/instances/${id}/resources`).then((r) => r.json());
    setLoading("");
    if (j.error) { setErr(`${which === "src" ? "Source" : "Destination"}: ${j.error}`); return null; }
    return j as Res;
  };
  const pickSrc = async (id: number) => { setSrcId(id); setSrc(null); setAppUuid(""); setDbUuids([]); if (id) setSrc(await loadRes(id, "src")); };
  const pickDst = async (id: number) => {
    setDstId(id); setDst(null); setServer(""); setGhApp("");
    if (!id) return;
    const r = await loadRes(id, "dst"); if (!r) return;
    setDst(r); setServer(r.servers[0]?.uuid ?? ""); setGhApp(r.githubApps.find((g) => !g.is_public)?.uuid ?? "");
  };
  const pickApp = (a: App) => {
    setAppUuid(a.uuid); setProjectName(a.name);
    setDbUuids((src?.dbs ?? []).filter((d) => d.environment_id === a.environment_id).map((d) => d.uuid));
  };

  const app = src?.apps.find((a) => a.uuid === appUuid);
  const apps = useMemo(() => (src?.apps ?? []).filter((a) => a.name.toLowerCase().includes(filter.toLowerCase())), [src, filter]);
  const sameEnvDbs = src?.dbs.filter((d) => !app || d.environment_id === app.environment_id) ?? [];
  const otherDbs = src?.dbs.filter((d) => app && d.environment_id !== app.environment_id) ?? [];
  const isPublicSource = !!app && !!src?.githubApps.find((g) => g.id === app.source_id)?.is_public;
  const privateGh = dst?.githubApps.filter((g) => !g.is_public) ?? [];
  const stoppedSelected = dbUuids.filter((u) => !running(src?.dbs.find((d) => d.uuid === u)?.status ?? ""));
  const ready = !!server && (!!appUuid || dbUuids.length > 0) && stoppedSelected.length === 0 && (!app || isPublicSource || !!ghApp);
  const step = !srcId ? 1 : !appUuid && !dbUuids.length ? 2 : !dstId ? 3 : 4;

  async function go() {
    setBusy(true); setErr("");
    const r = await fetch("/api/migrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sourceInstanceId: srcId, destInstanceId: dstId, appUuid: appUuid || null, dbUuids, destServerUuid: server,
      destProjectUuid: project, destProjectName: projectName, destEnvironmentName: env, destGithubAppUuid: isPublicSource ? null : ghApp || null, deploy, copyDomains,
    }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error); ui.toast("bad", j.error); return; }
    ui.toast("ok", "Migration started");
    router.push(`/migrations/${j.id}`);
  }

  const dbRow = (d: Db) => (
    <label key={d.uuid} className="row cursor-pointer" style={{ marginBottom: 0 }}>
      <input type="checkbox" checked={dbUuids.includes(d.uuid)} onChange={(e) => setDbUuids((x) => e.target.checked ? [...x, d.uuid] : x.filter((u) => u !== d.uuid))} />
      <span className={`dot ${running(d.status) ? "ok" : "bad"}`} />
      <span className="flex-1 truncate">{d.name}</span>
      <span className="pill">{d.database_type.replace("standalone-", "")}</span>
      {!running(d.status) && <span className="pill bad">stopped</span>}
    </label>
  );

  if (insts === null) return <div><div className="page-head"><div><h1>Migrate</h1><p>Pick what to move and where.</p></div></div><div className="grid md:grid-cols-2 gap-6"><div className="panel"><SkeletonRows n={2} /></div><div className="panel"><SkeletonRows n={2} /></div></div></div>;
  if (insts.length === 0) return (
    <div>
      <div className="page-head"><div><h1>Migrate</h1><p>Copy an app and its databases to another Coolify server.</p></div></div>
      <div className="panel"><Empty title="No Coolify instances yet" action={<Link href="/settings" className="btn btn-primary">Open Settings</Link>}>Add your first one in Settings, or import a config file from a colleague.</Empty></div>
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <div><h1>Migrate</h1><p>Pick what to move and where. The source is never modified.</p></div>
        {recent.length > 0 && <Link href="/migrations" className="btn btn-sm">History</Link>}
      </div>
      <div className="steps">
        {["Source", "Select", "Destination", "Review"].map((s, i) => <span key={s} className={`step ${step === i + 1 ? "on" : step > i + 1 ? "done" : ""}`}><b>{i + 1}</b>{s}</span>)}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="space-y-4">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Source instance</span>{loading === "src" && <span className="pill run">loading</span>}</div>
            <div className="p-4"><select value={srcId} onChange={(e) => pickSrc(+e.target.value)}><option value={0}>Choose an instance…</option>{insts.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.url.replace(/^https?:\/\//, "")}</option>)}</select></div>
          </div>
          {loading === "src" && <div className="panel"><SkeletonRows n={5} /></div>}
          {src && (<>
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Application <span style={{ color: "var(--dim)", fontWeight: 400 }}>optional</span></span><span className="mono" style={{ color: "var(--muted)" }}>{src.apps.length}</span></div>
              <div className="px-4 pt-3 pb-2"><input placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
              <div className="max-h-72 overflow-auto">
                {apps.length === 0 && <Empty title={filter ? "No apps match" : "No applications"}>{filter ? "Try another name." : "This instance has no apps. You can still move databases."}</Empty>}
                {apps.map((a) => (
                  <label key={a.uuid} className="row cursor-pointer" style={{ marginBottom: 0 }}>
                    <input type="radio" name="app" checked={appUuid === a.uuid} onChange={() => pickApp(a)} />
                    <span className={`dot ${running(a.status) ? "ok" : "bad"}`} />
                    <span className="flex-1 truncate">{a.name}</span>
                    <span className="pill">{a.build_pack}</span>
                  </label>))}
              </div>
              {app && <div className="px-4 py-3 mono" style={{ borderTop: "1px solid var(--line)", color: "var(--muted)" }}>{app.git_repository ?? "no repo"} · {app.fqdn ?? "no domain"}</div>}
            </div>
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Databases {app ? "in the same environment" : ""}</span><span className="mono" style={{ color: "var(--muted)" }}>{dbUuids.length} selected</span></div>
              <div className="max-h-56 overflow-auto">{sameEnvDbs.map(dbRow)}{sameEnvDbs.length === 0 && <div className="empty">None here.</div>}</div>
              {otherDbs.length > 0 && <details><summary className="row cursor-pointer text-xs" style={{ color: "var(--muted)" }}>Other databases on this instance ({otherDbs.length})</summary><div className="max-h-56 overflow-auto">{otherDbs.map(dbRow)}</div></details>}
              {stoppedSelected.length > 0 && <div className="px-4 py-3 text-xs" style={{ borderTop: "1px solid var(--line)", color: "var(--warn)" }}>{stoppedSelected.length} selected database(s) are stopped on the source. Start them in Coolify or deselect them.</div>}
            </div>
          </>)}
        </section>

        <section className="space-y-4">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Destination instance</span>{loading === "dst" && <span className="pill run">loading</span>}</div>
            <div className="p-4"><select value={dstId} onChange={(e) => pickDst(+e.target.value)}><option value={0}>Choose an instance…</option>{insts.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.url.replace(/^https?:\/\//, "")}</option>)}</select></div>
          </div>
          {loading === "dst" && <div className="panel"><SkeletonRows n={4} /></div>}
          {dst && (<>
            <div className="panel p-4 space-y-4">
              <div><label>Server</label><select value={server} onChange={(e) => setServer(e.target.value)}>{dst.servers.map((s) => <option key={s.uuid} value={s.uuid}>{s.name} ({s.ip})</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label>Project</label><select value={project} onChange={(e) => setProject(e.target.value)}><option value="new">New project</option>{dst.projects.map((p) => <option key={p.uuid} value={p.uuid}>{p.name}</option>)}</select></div>
                {project === "new" ? <div><label>Project name</label><input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={app?.name ?? "migrated"} /></div>
                  : <div><label>Environment</label><input value={env} onChange={(e) => setEnv(e.target.value)} /></div>}
              </div>
              {app && !isPublicSource && <div>
                <label>GitHub App on destination</label>
                {privateGh.length ? <select value={ghApp} onChange={(e) => setGhApp(e.target.value)}>{privateGh.map((g) => <option key={g.uuid} value={g.uuid}>{g.name}</option>)}</select>
                  : <p className="text-xs" style={{ color: "var(--warn)" }}>No GitHub App on this instance. Install one in Coolify → Sources first.</p>}
                <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>Must have access to {app.git_repository}.</p>
              </div>}
              <div className="flex gap-6 text-sm pt-1">
                <label className="flex items-center gap-2 cursor-pointer" style={{ margin: 0, color: "var(--fg)" }}><input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} />Deploy after create</label>
                <label className="flex items-center gap-2 cursor-pointer" style={{ margin: 0, color: "var(--fg)" }}><input type="checkbox" checked={copyDomains} onChange={(e) => setCopyDomains(e.target.checked)} />Copy domains</label>
              </div>
            </div>
            <div className="panel">
              <div className="panel-head"><span className="panel-title">Review</span></div>
              <div className="p-4 text-sm space-y-2" style={{ color: "var(--muted)" }}>
                <div className="flex justify-between"><span>Application</span><span style={{ color: "var(--fg)" }}>{app?.name ?? "none"}</span></div>
                <div className="flex justify-between"><span>Databases</span><span style={{ color: "var(--fg)" }}>{dbUuids.length}</span></div>
                <div className="flex justify-between"><span>Target</span><span style={{ color: "var(--fg)" }}>{dst.servers.find((s) => s.uuid === server)?.name ?? "—"} · {project === "new" ? `new "${projectName || app?.name || "migrated"}"` : dst.projects.find((p) => p.uuid === project)?.name}</span></div>
                <div className="flex justify-between"><span>After create</span><span style={{ color: "var(--fg)" }}>{deploy ? "deploy and stream build log" : "leave undeployed"}</span></div>
                <p className="text-xs pt-2" style={{ color: "var(--dim)" }}>Preflight checks disk, memory and server reachability before anything is created. Source stays untouched; stop it from the migration page once verified.</p>
              </div>
              <div className="p-4" style={{ borderTop: "1px solid var(--line)" }}>
                {err && <p className="mb-3 text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
                <button className="btn btn-primary btn-lg w-full" disabled={busy || !ready} onClick={go}>{busy && <Spinner />}{busy ? "Starting" : "Start migration"}</button>
              </div>
            </div>
          </>)}
          {!dst && err && <p className="text-sm" style={{ color: "var(--bad)" }}>{err}</p>}
        </section>
      </div>

      {recent.length > 0 && (
        <div className="panel mt-8">
          <div className="panel-head"><span className="panel-title">Recent migrations</span><Link href="/migrations" className="text-xs" style={{ color: "var(--muted)" }}>All</Link></div>
          {recent.map((m) => (<Link key={m.id} href={`/migrations/${m.id}`} className="row">
            <span className={`dot ${m.status === "done" ? "ok" : m.status === "failed" ? "bad" : "run"}`} />
            <span className="flex-1 truncate">{m.title}</span><span className={`pill ${m.status === "done" ? "ok" : m.status === "failed" ? "bad" : "run"}`}>{m.status}</span><span className="mono" style={{ color: "var(--dim)" }}>{m.created_at}</span></Link>))}
        </div>
      )}
    </div>
  );
}
