import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

import fs from "node:fs";

// Data lives outside the repo: ~/.coolmigrate by default (see bin/coolmigrate.js), COOLMIGRATE_HOME to override.
export const HOME = process.env.COOLMIGRATE_HOME || path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), ".coolmigrate");
fs.mkdirSync(HOME, { recursive: true });
const secretFile = path.join(HOME, "secret");
if (!process.env.APP_SECRET && !fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
const db = new Database(path.join(HOME, "app.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, token TEXT NOT NULL,
    ssh_host TEXT NOT NULL, ssh_user TEXT NOT NULL DEFAULT 'root', ssh_password TEXT, ssh_key TEXT
  );
  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'running', title TEXT NOT NULL,
    request TEXT NOT NULL, log TEXT NOT NULL DEFAULT '', result TEXT, state TEXT NOT NULL DEFAULT '{}'
  );
`);
try { db.exec("ALTER TABLE migrations ADD COLUMN state TEXT NOT NULL DEFAULT '{}'"); } catch { /* column exists */ }

const secret = process.env.APP_SECRET || fs.readFileSync(secretFile, "utf8").trim();
if (secret.length < 16) throw new Error("APP_SECRET too short (16+ chars)");
const key = crypto.createHash("sha256").update(secret).digest();

export function enc(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), out]).toString("base64");
}
export function dec(blob: string | null | undefined): string | null {
  if (!blob) return null;
  const b = Buffer.from(blob, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

export type Instance = {
  id: number; name: string; url: string; token: string;
  ssh_host: string; ssh_user: string; ssh_password: string | null; ssh_key: string | null;
};

function decryptRow(r: Instance): Instance {
  return { ...r, token: dec(r.token)!, ssh_password: dec(r.ssh_password), ssh_key: dec(r.ssh_key) };
}
export function listInstances(): Instance[] {
  return (db.prepare("SELECT * FROM instances ORDER BY id").all() as Instance[]).map(decryptRow);
}
export function getInstance(id: number): Instance | undefined {
  const r = db.prepare("SELECT * FROM instances WHERE id=?").get(id) as Instance | undefined;
  return r && decryptRow(r);
}
export function upsertInstance(i: Partial<Instance>) {
  const row = {
    name: i.name, url: (i.url ?? "").replace(/\/+$/, ""), token: enc(i.token), ssh_host: i.ssh_host,
    ssh_user: i.ssh_user || "root", ssh_password: enc(i.ssh_password), ssh_key: enc(i.ssh_key),
  };
  if (i.id) {
    // blank secret field on edit = keep existing
    const old = db.prepare("SELECT * FROM instances WHERE id=?").get(i.id) as Instance;
    const merged = {
      ...row,
      token: i.token ? row.token : old.token,
      ssh_password: i.ssh_password ? row.ssh_password : old.ssh_password,
      ssh_key: i.ssh_key ? row.ssh_key : old.ssh_key,
      id: i.id,
    };
    db.prepare(`UPDATE instances SET name=@name,url=@url,token=@token,ssh_host=@ssh_host,ssh_user=@ssh_user,
      ssh_password=@ssh_password,ssh_key=@ssh_key WHERE id=@id`).run(merged);
    return i.id;
  }
  return db.prepare(`INSERT INTO instances (name,url,token,ssh_host,ssh_user,ssh_password,ssh_key)
    VALUES (@name,@url,@token,@ssh_host,@ssh_user,@ssh_password,@ssh_key)`).run(row).lastInsertRowid;
}
export function deleteInstance(id: number) { db.prepare("DELETE FROM instances WHERE id=?").run(id); }

export type Migration = { id: number; created_at: string; status: string; title: string; request: string; log: string; result: string | null; state: string };
export function createMigration(title: string, request: unknown): number {
  return Number(db.prepare("INSERT INTO migrations (title, request) VALUES (?, ?)").run(title, JSON.stringify(request)).lastInsertRowid);
}
export function appendLog(id: number, line: string) {
  db.prepare("UPDATE migrations SET log = log || ? WHERE id=?").run(`[${new Date().toISOString().slice(11, 19)}] ${line}\n`, id);
}
export function finishMigration(id: number, status: "done" | "failed", result?: unknown) {
  db.prepare("UPDATE migrations SET status=?, result=? WHERE id=?").run(status, result ? JSON.stringify(result) : null, id);
}
export function saveState(id: number, state: unknown) { db.prepare("UPDATE migrations SET state=? WHERE id=?").run(JSON.stringify(state), id); }
export function reopenMigration(id: number) { db.prepare("UPDATE migrations SET status='running', result=NULL WHERE id=? AND status='failed'").run(id); }
export function getMigration(id: number) { return db.prepare("SELECT * FROM migrations WHERE id=?").get(id) as Migration | undefined; }
export function hasRunningMigration() { return !!db.prepare("SELECT 1 FROM migrations WHERE status='running' LIMIT 1").get(); }
export function listMigrations() { return db.prepare("SELECT id,created_at,status,title FROM migrations ORDER BY id DESC LIMIT 50").all() as Migration[]; }
