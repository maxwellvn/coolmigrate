"use client";
import { useEffect, useState } from "react";
import { Empty, SkeletonRows, Spinner, useUI } from "../ui";

type Inst = { id: number; name: string; url: string; ssh_host: string; ssh_user: string; hasToken: boolean; hasPassword: boolean; hasKey: boolean };
const empty = { id: 0, name: "", url: "", token: "", ssh_host: "", ssh_user: "root", ssh_password: "", ssh_key: "" };

export default function Settings() {
  const ui = useUI();
  const [list, setList] = useState<Inst[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [tests, setTests] = useState<Record<number, { api: string; ssh: string } | "testing">>({});
  const [msg, setMsg] = useState("");
  const [xfer, setXfer] = useState("");
  const [stopped, setStopped] = useState(false);
  const load = () => fetch("/api/instances").then((r) => r.json()).then(setList);
  useEffect(() => { load(); }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg(""); setSaving(true);
    const r = await fetch("/api/instances", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json(); setSaving(false);
    if (!r.ok) return setMsg(j.error);
    ui.toast("ok", form.id ? "Instance updated" : "Instance added");
    setForm({ ...empty }); load();
  }
  async function test(id: number) {
    setTests((t) => ({ ...t, [id]: "testing" }));
    const j = await fetch(`/api/instances/${id}/test`, { method: "POST" }).then((r) => r.json());
    setTests((t) => ({ ...t, [id]: j }));
    ui.toast(ok(j.api) && ok(j.ssh) ? "ok" : "bad", ok(j.api) && ok(j.ssh) ? "API and SSH reachable" : "Connection check failed, see details");
  }
  async function del(id: number) {
    if (!(await ui.confirm({ title: "Remove instance?", body: "Its token and SSH credentials are deleted from this machine. Migration history stays.", confirmText: "Remove", danger: true }))) return;
    await fetch(`/api/instances/${id}`, { method: "DELETE" }); load(); ui.toast("info", "Instance removed");
  }
  async function exportConfig() {
    const passphrase = await ui.prompt({ title: "Encrypt export", body: "Choose a passphrase (8+ characters). Send it to the recipient separately from the file.", confirmText: "Export", input: { type: "password", placeholder: "passphrase", minLength: 8 } });
    if (!passphrase) return;
    const r = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "export", passphrase }) });
    const j = await r.json(); if (!r.ok) return setXfer(j.error);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 2)], { type: "application/json" }));
    a.download = `coolmigrate-config-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    setXfer(""); ui.toast("ok", `Exported ${list?.length ?? 0} instance(s)`);
  }
  async function importConfig(f: File | undefined) {
    if (!f) return;
    const passphrase = await ui.prompt({ title: "Import config", body: `Passphrase that ${f.name} was exported with.`, confirmText: "Import", input: { type: "password", placeholder: "passphrase", minLength: 1 } });
    if (!passphrase) return;
    let file; try { file = JSON.parse(await f.text()); } catch { return ui.toast("bad", "Not a JSON file"); }
    const r = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", passphrase, file }) });
    const j = await r.json(); ui.toast(r.ok ? "ok" : "bad", r.ok ? `Imported: ${j.added} added, ${j.updated} updated` : j.error); load();
  }
  async function stopServer(force = false) {
    if (!force && !(await ui.confirm({ title: "Stop coolmigrate?", body: "The local server exits. Run `coolmigrate` in a terminal to start it again. Settings and history stay on disk.", confirmText: "Stop server", danger: true }))) return;
    const r = await fetch("/api/shutdown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }) });
    if (r.status === 409) { if (await ui.confirm({ title: "A migration is still running", body: "Stopping now interrupts it. It can be resumed from its page later.", confirmText: "Stop anyway", danger: true })) return stopServer(true); return; }
    setStopped(true);
  }
  const ok = (s?: string) => s?.startsWith("ok");

  return (
    <div>
      <div className="page-head"><div><h1>Settings</h1><p>Coolify instances this tool can talk to. A Coolify that manages remote servers needs each remote server added too.</p></div></div>
      <div className="grid md:grid-cols-[1fr_400px] gap-6 items-start">
        <div className="space-y-6">
          <div className="panel">
            <div className="panel-head"><span className="panel-title">Instances</span><span className="mono" style={{ color: "var(--muted)" }}>{list?.length ?? ""}</span></div>
            {list === null && <SkeletonRows n={3} />}
            {list?.length === 0 && <Empty title="No instances yet">Add one on the right, or import a config from a colleague.<br />Token: Coolify → Security → API Tokens. SSH: root password or a private key.</Empty>}
            {list?.map((i) => { const t = tests[i.id]; return (
              <div key={i.id} className="row flex-wrap" style={{ padding: "14px 16px" }}>
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 font-medium">{i.name}
                    {t && t !== "testing" && <span className={`pill ${ok(t.api) && ok(t.ssh) ? "ok" : "bad"}`}>{ok(t.api) && ok(t.ssh) ? "healthy" : "check failed"}</span>}
                    {t === "testing" && <span className="pill run">testing</span>}
                  </div>
                  <div className="mono mt-1" style={{ color: "var(--muted)" }}>{i.url} · {i.ssh_user}@{i.ssh_host} · {i.hasKey ? "ssh key" : i.hasPassword ? "password" : "no ssh auth"}</div>
                  {t && t !== "testing" && <div className="mono mt-1" style={{ color: "var(--dim)" }}><span style={{ color: ok(t.api) ? "var(--ok)" : "var(--bad)" }}>API</span> {t.api} · <span style={{ color: ok(t.ssh) ? "var(--ok)" : "var(--bad)" }}>SSH</span> {t.ssh}</div>}
                </div>
                <button className="btn btn-sm" onClick={() => test(i.id)} disabled={t === "testing"}>{t === "testing" ? <Spinner /> : null}Test</button>
                <button className="btn btn-sm" onClick={() => setForm({ ...empty, id: i.id, name: i.name, url: i.url, ssh_host: i.ssh_host, ssh_user: i.ssh_user })}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => del(i.id)}>Remove</button>
              </div>); })}
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Share configuration</span></div>
            <div className="p-4">
              <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Export writes every instance, tokens and SSH credentials included, into one file encrypted with a passphrase. A colleague imports it and gets the same servers. Same URL updates, new URL adds.</p>
              <div className="flex gap-2 items-center flex-wrap">
                <button className="btn" onClick={exportConfig} disabled={!list?.length}>Export config</button>
                <label className="btn" style={{ cursor: "pointer", margin: 0, color: "var(--fg)" }}>Import config<input type="file" accept="application/json,.json" hidden onChange={(e) => { importConfig(e.target.files?.[0]); e.target.value = ""; }} /></label>
                {xfer && <span className="mono" style={{ color: /wrong|not a|error/.test(xfer) ? "var(--bad)" : "var(--ok)" }}>{xfer}</span>}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><span className="panel-title">Server</span><span className={`pill ${stopped ? "bad" : "ok"}`}>{stopped ? "stopped" : "running"}</span></div>
            <div className="p-4 flex items-center gap-4 flex-wrap">
              <p className="text-sm flex-1 min-w-[240px]" style={{ color: "var(--muted)", margin: 0 }}>{stopped ? "Stopped. Close this tab; run `coolmigrate` in a terminal to start again." : "Bound to localhost. Stopping ends the process; settings and history stay in ~/.coolmigrate. Secrets are AES-256-GCM encrypted at rest."}</p>
              {!stopped && <button className="btn btn-danger" onClick={() => stopServer()}>Stop coolmigrate</button>}
            </div>
          </div>
        </div>

        <form onSubmit={save} className="panel">
          <div className="panel-head"><span className="panel-title">{form.id ? `Edit instance #${form.id}` : "Add instance"}</span></div>
          <div className="p-4 space-y-3">
            <div><label>Name</label><input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Production EU" /></div>
            <div><label>Coolify URL</label><input required value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="http://1.2.3.4:8000" /></div>
            <div><label>API token {form.id ? "(blank keeps current)" : ""}</label><input type="password" value={form.token} onChange={(e) => set("token", e.target.value)} placeholder="1|…" /></div>
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <div><label>SSH host</label><input required value={form.ssh_host} onChange={(e) => set("ssh_host", e.target.value)} placeholder="1.2.3.4" /></div>
              <div><label>User</label><input value={form.ssh_user} onChange={(e) => set("ssh_user", e.target.value)} /></div>
            </div>
            <div><label>SSH password {form.id ? "(blank keeps current)" : ""}</label><input type="password" value={form.ssh_password} onChange={(e) => set("ssh_password", e.target.value)} /></div>
            <div><label>or SSH private key</label><textarea rows={3} className="mono" value={form.ssh_key} onChange={(e) => set("ssh_key", e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></div>
            {msg && <p className="text-sm" style={{ color: "var(--bad)" }}>{msg}</p>}
          </div>
          <div className="p-4 flex gap-2" style={{ borderTop: "1px solid var(--line)" }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>{saving && <Spinner />}{form.id ? "Save changes" : "Add instance"}</button>
            {form.id ? <button type="button" className="btn" onClick={() => setForm({ ...empty })}>Cancel</button> : null}
          </div>
        </form>
      </div>
    </div>
  );
}
