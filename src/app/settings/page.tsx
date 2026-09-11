"use client";
import { useEffect, useState } from "react";

type Inst = { id: number; name: string; url: string; ssh_host: string; ssh_user: string; hasToken: boolean; hasPassword: boolean; hasKey: boolean };
const empty = { id: 0, name: "", url: "", token: "", ssh_host: "", ssh_user: "root", ssh_password: "", ssh_key: "" };

export default function Settings() {
  const [list, setList] = useState<Inst[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [tests, setTests] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [stopped, setStopped] = useState(false);
  async function stopServer(force = false) {
    if (!force && !confirm("Stop the coolmigrate server? Run `coolmigrate` again to start it.")) return;
    const r = await fetch("/api/shutdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) });
    if (r.status === 409) { if (confirm("A migration is still running. Stop anyway? It can be resumed later.")) return stopServer(true); return; }
    setStopped(true);
  }
  const load = () => fetch("/api/instances").then((r) => r.json()).then(setList);
  useEffect(() => { load(); }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const r = await fetch("/api/instances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json();
    if (!r.ok) return setMsg(j.error);
    setForm({ ...empty }); load();
  }
  async function test(id: number) {
    setTests((t) => ({ ...t, [id]: "testing…" }));
    const j = await fetch(`/api/instances/${id}/test`, { method: "POST" }).then((r) => r.json());
    setTests((t) => ({ ...t, [id]: `API ${j.api} · SSH ${j.ssh}` }));
  }
  async function del(id: number) {
    if (!confirm("Remove this instance?")) return;
    await fetch(`/api/instances/${id}`, { method: "DELETE" }); load();
  }

  return (
    <div className="grid md:grid-cols-[1fr_380px] gap-8">
      <section>
        <p className="eyebrow mb-3">Coolify instances</p>
        <div className="panel">
          {list.length === 0 && <div className="row" style={{ color: "var(--muted)" }}>No instances yet. Add one on the right. Token: Coolify → Security → API Tokens (read/write). SSH: root password or a private key that can log in.</div>}
          {list.map((i) => (
            <div key={i.id} className="row flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{i.name}</div>
                <div className="mono" style={{ color: "var(--muted)" }}>{i.url} · {i.ssh_user}@{i.ssh_host} · {i.hasKey ? "key" : i.hasPassword ? "password" : "no ssh auth"}</div>
                {tests[i.id] && <div className="mono mt-1" style={{ color: tests[i.id].includes("fail") ? "var(--bad)" : "var(--ok)" }}>{tests[i.id]}</div>}
              </div>
              <button className="btn" onClick={() => test(i.id)}>Test</button>
              <button className="btn" onClick={() => setForm({ ...empty, id: i.id, name: i.name, url: i.url, ssh_host: i.ssh_host, ssh_user: i.ssh_user })}>Edit</button>
              <button className="btn btn-danger" onClick={() => del(i.id)}>Remove</button>
            </div>
          ))}
        </div>
        <div className="panel p-4 mt-6 flex items-center gap-4">
          <div className="flex-1">
            <p className="eyebrow mb-1">Server</p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{stopped ? "Stopped. Close this tab; run `coolmigrate` in a terminal to start again." : "Running locally. Stopping ends the process; data and settings stay on disk."}</p>
          </div>
          {!stopped && <button className="btn btn-danger" onClick={() => stopServer()}>Stop coolmigrate</button>}
        </div>
        <p className="mt-4 text-xs" style={{ color: "var(--dim)" }}>Secrets are AES-256-GCM encrypted at rest with APP_SECRET. Blank secret fields on edit keep the stored value. If a Coolify instance manages extra remote servers, add each remote server here too (its own SSH host, any token) so data on it can be reached.</p>
      </section>
      <form onSubmit={save} className="panel p-4 space-y-3 self-start">
        <p className="eyebrow">{form.id ? `Edit #${form.id}` : "Add instance"}</p>
        <div><label>Name</label><input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Server 97" /></div>
        <div><label>Coolify URL</label><input required value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="http://102.219.189.97:8000" /></div>
        <div><label>API token {form.id && "(blank = keep)"}</label><input type="password" value={form.token} onChange={(e) => set("token", e.target.value)} placeholder="1|…" /></div>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <div><label>SSH host</label><input required value={form.ssh_host} onChange={(e) => set("ssh_host", e.target.value)} placeholder="102.219.189.97" /></div>
          <div><label>User</label><input value={form.ssh_user} onChange={(e) => set("ssh_user", e.target.value)} /></div>
        </div>
        <div><label>SSH password {form.id && "(blank = keep)"}</label><input type="password" value={form.ssh_password} onChange={(e) => set("ssh_password", e.target.value)} /></div>
        <div><label>or SSH private key</label><textarea rows={3} className="mono" value={form.ssh_key} onChange={(e) => set("ssh_key", e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></div>
        {msg && <p style={{ color: "var(--bad)" }}>{msg}</p>}
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit">{form.id ? "Save" : "Add"}</button>
          {form.id ? <button type="button" className="btn" onClick={() => setForm({ ...empty })}>Cancel</button> : null}
        </div>
      </form>
    </div>
  );
}
