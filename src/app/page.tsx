"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Inst = { id: number; name: string };
type Res = {
  apps: { uuid: string; name: string; environment_id: number; status: string; fqdn: string | null; build_pack: string; git_repository: string | null; source_id: number | null }[];
  dbs: { uuid: string; name: string; environment_id: number; status: string; database_type: string }[];
  servers: { uuid: string; name: string; ip: string }[];
  projects: { uuid: string; name: string }[];
  githubApps: { uuid: string; name: string; id: number; is_public: boolean }[];
};

export default function Migrate() {
  const router = useRouter();
  const [insts, setInsts] = useState<Inst[]>([]);
  const [srcId, setSrcId] = useState(0); const [dstId, setDstId] = useState(0);
  const [src, setSrc] = useState<Res | null>(null); const [dst, setDst] = useState<Res | null>(null);
  const [appUuid, setAppUuid] = useState(""); const [dbUuids, setDbUuids] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [server, setServer] = useState(""); const [project, setProject] = useState("new"); const [projectName, setProjectName] = useState("");
  const [env, setEnv] = useState("production"); const [ghApp, setGhApp] = useState("");
  const [deploy, setDeploy] = useState(true); const [copyDomains, setCopyDomains] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  useEffect(() => { fetch("/api/instances").then((r) => r.json()).then(setInsts); }, []);
  const loadRes = (id: number, setter: (r: Res | null) => void, after?: (r: Res) => void) => {
    setter(null); if (!id) return;
    fetch(`/api/instances/${id}/resources`).then((r) => r.json()).then((j) => { if (j.error) return setErr(j.error); setter(j); after?.(j); });
  };
  const pickSrc = (id: number) => { setSrcId(id); setAppUuid(""); setDbUuids([]); setSrc(null); loadRes(id, setSrc); };
  const pickDst = (id: number) => {
    setDstId(id); setServer(""); setGhApp("");
    loadRes(id, setDst, (r) => { setServer(r.servers[0]?.uuid ?? ""); setGhApp(r.githubApps.find((g) => !g.is_public)?.uuid ?? ""); });
  };
  const pickApp = (a: Res["apps"][number]) => {
    setAppUuid(a.uuid); setProjectName(a.name);
    // DBs in the same environment as the app are its likely dependencies: preselect them
    setDbUuids((src?.dbs ?? []).filter((d) => d.environment_id === a.environment_id).map((d) => d.uuid));
  };
  const app = src?.apps.find((a) => a.uuid === appUuid);
  const apps = useMemo(() => (src?.apps ?? []).filter((a) => a.name.toLowerCase().includes(filter.toLowerCase())), [src, filter]);
  const sameEnvDbs = src?.dbs.filter((d) => !app || d.environment_id === app.environment_id) ?? [];
  const otherDbs = src?.dbs.filter((d) => app && d.environment_id !== app.environment_id) ?? [];
  const isPublicSource = app && src?.githubApps.find((g) => g.id === app.source_id)?.is_public;

  async function go() {
    setBusy(true); setErr("");
    const r = await fetch("/api/migrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      sourceInstanceId: srcId, destInstanceId: dstId, appUuid: appUuid || null, dbUuids, destServerUuid: server,
      destProjectUuid: project, destProjectName: projectName, destEnvironmentName: env, destGithubAppUuid: isPublicSource ? null : ghApp || null, deploy, copyDomains,
    }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setErr(j.error);
    router.push(`/migrations/${j.id}`);
  }

  const DbRow = ({ d }: { d: Res["dbs"][number] }) => (
    <label className="row cursor-pointer" style={{ marginBottom: 0 }}>
      <input type="checkbox" style={{ width: "auto" }} checked={dbUuids.includes(d.uuid)} onChange={(e) => setDbUuids((x) => e.target.checked ? [...x, d.uuid] : x.filter((u) => u !== d.uuid))} />
      <span className={`dot ${d.status?.startsWith("running") ? "ok" : "bad"}`} />
      <span className="flex-1" style={{ color: "var(--fg)" }}>{d.name}</span>
      <span className="mono" style={{ color: "var(--muted)" }}>{d.database_type.replace("standalone-", "")}</span>
    </label>
  );

  if (insts.length < 1) return <p style={{ color: "var(--muted)" }}>Add at least one Coolify instance in <a href="/settings" className="underline">Settings</a> first.</p>;

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <section className="space-y-4">
        <div><p className="eyebrow mb-2">1 · Source</p>
          <select value={srcId} onChange={(e) => pickSrc(+e.target.value)}><option value={0}>Pick instance…</option>{insts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        {srcId > 0 && !src && <p style={{ color: "var(--muted)" }}>Loading…</p>}
        {src && (<>
          <div><p className="eyebrow mb-2">Application <span style={{ color: "var(--dim)" }}>(optional, databases only if none)</span></p>
            <input placeholder="Filter apps" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-2" />
            <div className="panel max-h-72 overflow-auto">
              {apps.map((a) => (
                <label key={a.uuid} className="row cursor-pointer" style={{ marginBottom: 0 }}>
                  <input type="radio" name="app" style={{ width: "auto" }} checked={appUuid === a.uuid} onChange={() => pickApp(a)} />
                  <span className={`dot ${a.status?.startsWith("running") ? "ok" : "bad"}`} />
                  <span className="flex-1 truncate" style={{ color: "var(--fg)" }}>{a.name}</span>
                  <span className="mono" style={{ color: "var(--muted)" }}>{a.build_pack}</span>
                </label>))}
            </div>
            {app && <p className="mono mt-1" style={{ color: "var(--muted)" }}>{app.git_repository} · {app.fqdn ?? "no domain"}</p>}
          </div>
          <div><p className="eyebrow mb-2">Databases {app ? "in same environment" : ""}</p>
            <div className="panel max-h-56 overflow-auto">{sameEnvDbs.map((d) => <DbRow key={d.uuid} d={d} />)}{sameEnvDbs.length === 0 && <div className="row" style={{ color: "var(--dim)" }}>none</div>}</div>
            {otherDbs.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-xs" style={{ color: "var(--muted)" }}>Other databases on this instance ({otherDbs.length})</summary>
              <div className="panel max-h-56 overflow-auto mt-2">{otherDbs.map((d) => <DbRow key={d.uuid} d={d} />)}</div></details>}
          </div>
        </>)}
      </section>

      <section className="space-y-4">
        <div><p className="eyebrow mb-2">2 · Destination</p>
          <select value={dstId} onChange={(e) => pickDst(+e.target.value)}><option value={0}>Pick instance…</option>{insts.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
        {dst && (<>
          <div><label>Server</label><select value={server} onChange={(e) => setServer(e.target.value)}>{dst.servers.map((s) => <option key={s.uuid} value={s.uuid}>{s.name} ({s.ip})</option>)}</select></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label>Project</label><select value={project} onChange={(e) => setProject(e.target.value)}><option value="new">＋ New project</option>{dst.projects.map((p) => <option key={p.uuid} value={p.uuid}>{p.name}</option>)}</select></div>
            {project === "new" ? <div><label>New project name</label><input value={projectName} onChange={(e) => setProjectName(e.target.value)} /></div>
              : <div><label>Environment</label><input value={env} onChange={(e) => setEnv(e.target.value)} /></div>}
          </div>
          {app && !isPublicSource && <div><label>GitHub App on destination (must have access to {app.git_repository})</label>
            <select value={ghApp} onChange={(e) => setGhApp(e.target.value)}>{dst.githubApps.filter((g) => !g.is_public).map((g) => <option key={g.uuid} value={g.uuid}>{g.name}</option>)}</select>
            {dst.githubApps.filter((g) => !g.is_public).length === 0 && <p className="text-xs mt-1" style={{ color: "var(--warn)" }}>No GitHub App on destination. Install one in Coolify → Sources first.</p>}
          </div>}
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" style={{ width: "auto" }} checked={deploy} onChange={(e) => setDeploy(e.target.checked)} />Deploy after create</label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" style={{ width: "auto" }} checked={copyDomains} onChange={(e) => setCopyDomains(e.target.checked)} />Copy domains</label>
          </div>
          <div className="panel p-4 space-y-1 text-sm" style={{ color: "var(--muted)" }}>
            <p className="eyebrow mb-2">What happens</p>
            <p>Creates {dbUuids.length} database(s) on destination, streams dumps over SSH, {app ? `recreates "${app.name}" with env vars (DB hosts rewritten)${deploy ? ", deploys" : ""}` : "no app"}.</p>
            <p>Source is never modified. Flip DNS after verifying, then stop source yourself.</p>
          </div>
          {err && <p style={{ color: "var(--bad)" }}>{err}</p>}
          <button className="btn btn-primary w-full py-3" disabled={busy || !server || (!appUuid && !dbUuids.length) || srcId === dstId && !server} onClick={go}>
            {busy ? "Starting…" : "Migrate"}
          </button>
        </>)}
      </section>
    </div>
  );
}
