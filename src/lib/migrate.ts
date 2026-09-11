/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import type { Client } from "ssh2";
import { api, DB_KINDS, ID_RE, PW_RE, q, type Api } from "./coolify";
import { appendLog, createMigration, finishMigration, getInstance, getMigration, listInstances, reopenMigration, saveState, type Instance } from "./db";
import { connect, exec, pipe, sshConfig } from "./ssh";

export type MigrateRequest = {
  sourceInstanceId: number;
  destInstanceId: number;
  appUuid: string | null;          // null = databases only
  dbUuids: string[];
  destServerUuid: string;
  destProjectUuid: string | "new";
  destProjectName?: string;        // used when destProjectUuid === "new"
  destEnvironmentName: string;
  destGithubAppUuid: string | null; // null = public repo
  deploy: boolean;
  copyDomains: boolean;
};

// Fields copied verbatim from source app to destination app create call (all accepted by POST /applications/*).
const APP_FIELDS = [
  "git_repository", "git_branch", "git_commit_sha", "build_pack", "ports_exposes", "ports_mappings", "name", "description",
  "base_directory", "publish_directory", "dockerfile_location", "dockerfile_target_build", "docker_compose_location",
  "docker_compose_custom_start_command", "docker_compose_custom_build_command", "docker_compose_domains",
  "install_command", "build_command", "start_command", "static_image", "is_static",
  "health_check_enabled", "health_check_path", "health_check_port", "health_check_host", "health_check_method",
  "health_check_return_code", "health_check_scheme", "health_check_response_text", "health_check_interval",
  "health_check_timeout", "health_check_retries", "health_check_start_period",
  "limits_memory", "limits_memory_swap", "limits_memory_swappiness", "limits_memory_reservation", "limits_cpus", "limits_cpuset", "limits_cpu_shares",
  "custom_docker_run_options", "pre_deployment_command", "pre_deployment_command_container",
  "post_deployment_command", "post_deployment_command_container", "watch_paths",
];
const DB_COMMON = ["name", "description", "image", "is_public", "public_port", "limits_memory", "limits_memory_swap", "limits_memory_swappiness", "limits_memory_reservation", "limits_cpus", "limits_cpuset", "limits_cpu_shares"];
const LOCAL_IPS = new Set(["host.docker.internal", "localhost", "127.0.0.1"]);
const MIN_FREE_MB = 3000;

const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== "").map((k) => [k, o[k]]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (kb: number) => (kb / 1024).toFixed(0);

// Progress checkpoint, saved after every completed step so a failed run can resume without redoing work.
type State = {
  projectUuid?: string;
  dbs: Record<string, { newUuid: string; copied: boolean; dest: any }>; // keyed by source uuid
  rewrites: [string, string][];
  newAppUuid?: string;
  storagesDone?: boolean;
  envsDone?: boolean;
};

export function startMigration(req: MigrateRequest): number {
  const src = getInstance(req.sourceInstanceId), dst = getInstance(req.destInstanceId);
  if (!src || !dst) throw new Error("unknown instance");
  const id = createMigration(`${req.appUuid ?? "databases"} : ${src.name} -> ${dst.name}`, req);
  launch(id, req, { dbs: {}, rewrites: [] });
  return id;
}

export function resumeMigration(id: number) {
  const m = getMigration(id);
  if (!m) throw new Error("not found");
  if (m.status !== "failed") throw new Error(`cannot resume a migration that is ${m.status}`);
  reopenMigration(id);
  appendLog(id, "--- resuming, completed steps are skipped ---");
  launch(id, JSON.parse(m.request), JSON.parse(m.state));
}

function launch(id: number, req: MigrateRequest, state: State) {
  // ponytail: fire and forget in-process. Add a queue if the server restarts mid-migration often enough to hurt.
  run(id, req, state).then(
    (result) => finishMigration(id, "done", result),
    (e) => { appendLog(id, `FAILED: ${e?.message ?? e}`); finishMigration(id, "failed"); },
  );
  return id;
}

/** SSH credentials for the machine a resource actually runs on. A Coolify instance can manage remote servers. */
function sshFor(inst: Instance, serverIp: string): Instance {
  if (LOCAL_IPS.has(serverIp) || serverIp === inst.ssh_host) return inst;
  const other = listInstances().find((i) => i.ssh_host === serverIp);
  if (!other) throw new Error(`no SSH credentials for server ${serverIp}. Add it as an instance in Settings (any name, its own SSH host).`);
  return { ...other, name: `${inst.name}/${serverIp}` };
}

async function run(id: number, req: MigrateRequest, st: State) {
  const log = (s: string) => appendLog(id, s);
  const checkpoint = () => saveState(id, st);
  const srcInst = getInstance(req.sourceInstanceId)!, dstInst = getInstance(req.destInstanceId)!;
  const S = api(srcInst), D = api(dstInst);
  const created: { apps: string[]; dbs: string[] } = { apps: [], dbs: [] };
  const conns: Client[] = [];
  const ssh = async (i: Instance) => { const c = await connect(sshConfig(i)); conns.push(c); return c; };
  const sh = async (c: Client, cmd: string) => { const r = await exec(c, cmd); if (r.code) throw new Error(`${cmd.slice(0, 80)}… exit ${r.code}: ${(r.err || r.out).slice(-500)}`); return r.out.trim(); };

  try {
    // 0. resolve servers, gather what will move, preflight disk space on destination
    const destServers: any[] = await D.get("/servers");
    const destServer = destServers.find((s) => s.uuid === req.destServerUuid);
    if (!destServer) throw new Error("destination server not found");
    const dstSshInst = sshFor(dstInst, destServer.ip);
    const srv = await D.get(`/servers/${req.destServerUuid}`).catch(() => null);
    if (srv?.settings && (srv.settings.is_reachable === false || srv.settings.is_usable === false))
      throw new Error(`Coolify at ${dstInst.url} reports server "${destServer.name}" as not reachable/usable. Open Servers -> ${destServer.name} -> Validate & Configure in Coolify, then Resume.`);
    const dbs: any[] = await Promise.all(req.dbUuids.map((u) => S.get(`/databases/${u}`)));
    const app = req.appUuid ? await S.get(`/applications/${req.appUuid}`) : null;
    const storages = app ? await S.get(`/applications/${req.appUuid}/storages`) : { persistent_storages: [], file_storages: [] };
    const dirStorages: any[] = [...storages.persistent_storages, ...storages.file_storages.filter((f: any) => f.is_directory)];
    for (const d of dbs) if (!DB_KINDS[d.database_type]) throw new Error(`${d.name}: unsupported database type ${d.database_type}`);
    for (const d of dbs) if (!String(d.status).startsWith("running")) throw new Error(`${d.name} is not running on the source (status ${d.status}); start it first or deselect it`);

    const srcHosts = new Map<string, Client>();
    const srcSshOf = async (serverIp: string) => {
      if (!srcHosts.has(serverIp)) srcHosts.set(serverIp, await ssh(sshFor(srcInst, serverIp)));
      return srcHosts.get(serverIp)!;
    };
    let needKb = 0;
    for (const d of dbs) {
      const c = await srcSshOf(d.destination.server.ip);
      const vols = await sh(c, `docker inspect ${d.uuid} --format '{{range .Mounts}}{{.Source}} {{end}}'`);
      for (const v of vols.split(/\s+/).filter(Boolean)) needKb += Number((await sh(c, `du -sk ${q(v)} | cut -f1`)) || 0);
    }
    if (app) {
      const c = await srcSshOf(app.destination.server.ip);
      for (const s of dirStorages) {
        const p = s.fs_path ?? s.host_path ?? `/var/lib/docker/volumes/${s.name}/_data`;
        needKb += Number((await sh(c, `du -sk ${q(p)} 2>/dev/null | cut -f1 || echo 0`)) || 0);
      }
    }
    const dstSsh = await ssh(dstSshInst);
    const freeKb = Number(await sh(dstSsh, "df -Pk /var/lib/docker | tail -1 | awk '{print $4}'"));
    const memMb = await sh(dstSsh, "free -m | awk '/^Mem:/{print $7}'");
    log(`[1/6] preflight`); log(`destination ${destServer.name} (${dstSshInst.ssh_host}): ${mb(freeKb)} MB disk free, ${memMb} MB memory available. Data to move: ~${mb(needKb)} MB`);
    if (freeKb < needKb * 1.5 + MIN_FREE_MB * 1024) throw new Error(`not enough disk on destination: need ~${mb(needKb * 1.5)} MB plus ${MIN_FREE_MB} MB headroom, have ${mb(freeKb)} MB`);
    if (Number(memMb) < 512) throw new Error(`destination has only ${memMb} MB memory available; free some before migrating`);

    // 1. project + environment on destination
    log("[2/6] project and environment");
    let projectUuid = st.projectUuid ?? req.destProjectUuid;
    if (projectUuid === "new") {
      const p = await D.post("/projects", { name: req.destProjectName || app?.name || "migrated" });
      projectUuid = p.uuid; log(`created project "${req.destProjectName}" (${projectUuid})`);
    }
    st.projectUuid = projectUuid; checkpoint();
    const envs: any[] = await D.get(`/projects/${projectUuid}/environments`).catch(() => []);
    if (!envs.some?.((e: any) => e.name === req.destEnvironmentName)) {
      await D.post(`/projects/${projectUuid}/environments`, { name: req.destEnvironmentName });
      log(`created environment "${req.destEnvironmentName}"`);
    }
    const base = { server_uuid: req.destServerUuid, project_uuid: projectUuid, environment_name: req.destEnvironmentName };

    // 2. databases: create, wait until engine answers, stream dump, compare counts
    log(`[3/6] databases (${dbs.length})`);
    const rewrites = st.rewrites; // old -> new, applied to env values (uuid = internal hostname; sanitized names/passwords)
    for (const db of dbs) {
      const kind = DB_KINDS[db.database_type];
      const prev = st.dbs[db.uuid];
      if (prev?.copied) { log(`skip ${db.name}: already copied to ${prev.newUuid}`); created.dbs.push(prev.newUuid); continue; }
      const dest: any = prev?.dest ?? pick(db, [...DB_COMMON, ...kind.ids, ...kind.pws, ...kind.extra]);
      if (!prev) {
      for (const f of kind.ids) if (dest[f] && !ID_RE.test(dest[f])) {
        dest[f] = dest[f].replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?![A-Za-z_])/, "_").slice(0, 63);
        rewrites.push([db[f], dest[f]]); log(`  ${f} "${db[f]}" not allowed by API, using "${dest[f]}"`);
      }
      for (const f of kind.pws) if (dest[f] && !PW_RE.test(dest[f])) {
        dest[f] = crypto.randomBytes(24).toString("base64url");
        rewrites.push([encodeURIComponent(db[f]), encodeURIComponent(dest[f])], [db[f], dest[f]]); log(`  ${f} had characters the API rejects, generated a new one`);
      }
      }
      const r = prev ? { uuid: prev.newUuid } : await D.post(`/databases/${kind.path}`, { ...base, ...dest, instant_deploy: true });
      if (!prev) { rewrites.push([db.uuid, r.uuid]); st.dbs[db.uuid] = { newUuid: r.uuid, copied: false, dest }; checkpoint(); }
      created.dbs.push(r.uuid);
      log(`${prev ? "reusing" : "created"} ${db.database_type} "${db.name}" -> ${r.uuid}; waiting for container (image pull can take minutes)`);
      await waitFor(D, `/databases/${r.uuid}`, (x) => String(x.status).startsWith("running"), 900);
      const newDb = await D.get(`/databases/${r.uuid}`);
      log("  container up, waiting for the database engine to accept connections");
      await waitShell(dstSsh, `docker exec ${r.uuid} ${kind.ready(newDb)}`, 180);
      log("  engine ready");
      const srcSsh = await srcSshOf(db.destination.server.ip);
      log(`  copying data for ${db.name}`);
      const prog = progress(log);
      const { bytes, err } = await pipe(srcSsh, `docker exec ${db.uuid} ${kind.dump(db)}`, dstSsh, `docker exec -i ${r.uuid} ${kind.restore(newDb, db)}`, prog, toolLines(log));
      prog.done(bytes);
      const errors = (err.match(/ERROR/g) || []).length;
      log(`  ${db.name}: ${(bytes / 1048576).toFixed(2)} MB copied${errors ? `, ${errors} statement error(s), last: ${err.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}` : ""}`);
      if (kind.after) await sh(dstSsh, kind.after(newDb).replace("{uuid}", r.uuid));
      const [a, b] = await Promise.all([
        sh(srcSsh, `docker exec ${db.uuid} ${kind.count(db)}`).catch(() => "?"),
        sh(dstSsh, `docker exec ${r.uuid} ${kind.count(newDb)}`).catch(() => "?"),
      ]);
      log(`  sanity check (tables/dbs/keys): source ${a}, destination ${b}${a !== b ? "  <-- MISMATCH, inspect before switching over" : ""}`);
      st.dbs[db.uuid].copied = true; checkpoint();
    }

    if (!app) { log("done."); return { ...created, rewrites }; }

    // 3. application
    log("[4/6] application");
    const body: any = { ...base, ...pick(app, APP_FIELDS), instant_deploy: false };
    if (req.copyDomains && app.fqdn) body.domains = app.fqdn;
    if (app.build_pack === "dockercompose" && app.docker_compose_raw) body.docker_compose_raw = app.docker_compose_raw;
    const newApp = st.newAppUuid ? { uuid: st.newAppUuid } : req.destGithubAppUuid
      ? await D.post("/applications/private-github-app", { ...body, github_app_uuid: req.destGithubAppUuid })
      : await D.post("/applications/public", body);
    created.apps.push(newApp.uuid);
    if (!st.newAppUuid) { rewrites.push([app.uuid, newApp.uuid]); st.newAppUuid = newApp.uuid; checkpoint(); log(`created app "${app.name}" -> ${newApp.uuid}`); }
    else log(`reusing app ${newApp.uuid}`);

    // 4. storages: recreate definitions, then copy the files before first deploy
    log(`[5/6] storages (${storages.persistent_storages.length + storages.file_storages.length}) and env vars`);
    const appSrcSsh = dirStorages.length ? await srcSshOf(app.destination.server.ip) : null;
    if (st.storagesDone) log("skip storages: already copied");
    else {
    // ponytail: storages are all-or-nothing on resume; a partial copy is simply redone (tar overwrites).
    const existing = await D.get(`/applications/${newApp.uuid}/storages`).catch(() => ({ persistent_storages: [], file_storages: [] }));
    const has = (mount: string) => [...existing.persistent_storages, ...existing.file_storages].some((x: any) => x.mount_path === mount);
    for (const s of storages.persistent_storages) {
      const suffix = String(s.name).startsWith(`${app.uuid}-`) ? String(s.name).slice(app.uuid.length + 1) : s.name;
      const r = has(s.mount_path) ? existing.persistent_storages.find((x: any) => x.mount_path === s.mount_path)
        : await D.post(`/applications/${newApp.uuid}/storages`, { type: "persistent", name: suffix, mount_path: s.mount_path, host_path: s.host_path ?? undefined });
      const from = s.host_path || `/var/lib/docker/volumes/${s.name}/_data`;
      const to = s.host_path || `/var/lib/docker/volumes/${r.name}/_data`;
      if (!s.host_path) await sh(dstSsh, `docker volume create ${q(r.name)} >/dev/null`);
      await copyDir(appSrcSsh!, from, dstSsh, to, log);
      log(`  volume ${s.mount_path} copied`);
    }
    for (const s of storages.file_storages) {
      if (s.is_directory) {
        const fs_path = String(s.fs_path).split(app.uuid).join(newApp.uuid);
        if (!has(s.mount_path)) await D.post(`/applications/${newApp.uuid}/storages`, { type: "file", mount_path: s.mount_path, is_directory: true, fs_path });
        await copyDir(appSrcSsh!, s.fs_path, dstSsh, fs_path, log);
        log(`  directory ${s.mount_path} copied`);
      } else {
        if (!has(s.mount_path)) await D.post(`/applications/${newApp.uuid}/storages`, { type: "file", mount_path: s.mount_path, content: s.content ?? "" });
        log(`  file ${s.mount_path} recreated`);
      }
    }
    st.storagesDone = true; checkpoint();
    }

    // 5. env vars, rewriting old DB hostnames / credentials to the new ones
    const srcEnvs: any[] = await S.get(`/applications/${req.appUuid}/envs`);
    const rewrite = (v: string) => rewrites.reduce((s, [a, b]) => (a ? s.split(a).join(b) : s), v ?? "");
    const data = srcEnvs.map((e) => ({
      key: e.key, value: rewrite(e.real_value ?? e.value), is_preview: !!e.is_preview,
      is_buildtime: !!e.is_buildtime, is_runtime: e.is_runtime !== false, is_literal: !!e.is_literal, is_multiline: !!e.is_multiline, is_shown_once: !!e.is_shown_once,
    }));
    if (data.length && !st.envsDone) {
      await D.patch(`/applications/${newApp.uuid}/envs/bulk`, { data });
      log(`copied ${data.length} env vars${rewrites.length ? " (DB hosts/credentials rewritten)" : ""}`);
    }
    st.envsDone = true; checkpoint();

    // 6. deploy and wait
    log(req.deploy ? "[6/6] deploy" : "[6/6] deploy skipped (unchecked)");
    if (req.deploy) {
      const dep = await D.get(`/deploy?uuid=${newApp.uuid}&force=true`);
      const depUuid = dep?.deployments?.[0]?.deployment_uuid;
      log(`deployment ${depUuid ?? "?"} queued on ${dstInst.url}; streaming Coolify build log`);
      const status = depUuid ? await streamDeployment(D, depUuid, log) : "unknown";
      if (status === "finished") {
        const final = await waitFor(D, `/applications/${newApp.uuid}`, (x) => String(x.status).startsWith("running"), 300).catch(() => null);
        log(`app status: ${final?.status ?? "not running yet, check Coolify"}`);
      } else log(`deployment ended with status "${status}". Common cause: the chosen GitHub App has no access to ${app.git_repository}. Fix in Coolify, then redeploy there or Resume here.`);
      if (status !== "finished") throw new Error(`deployment ${status}`);
    }
    log(`done. Source untouched. Point DNS to ${dstSshInst.ssh_host}, verify, then stop the source app in Coolify.`);
    return { ...created, rewrites, newAppUuid: newApp.uuid };
  } catch (e) {
    if (created.dbs.length || created.apps.length) log(`created on destination before failure (delete in Coolify if unwanted): apps ${created.apps.join(",") || "-"}, databases ${created.dbs.join(",") || "-"}`);
    throw e;
  } finally {
    conns.forEach((c) => c.end());
  }
}

async function copyDir(src: Client, from: string, dst: Client, to: string, log: (s: string) => void) {
  log(`    ${from} -> ${to}`);
  const prog = progress(log);
  const { bytes } = await pipe(src, `tar -C ${q(from)} -cf - .`, dst, `mkdir -p ${q(to)} && tar -C ${q(to)} -xf -`, prog, toolLines(log));
  prog.done(bytes);
  return bytes;
}

/** Logs transfer progress every 10 MB or 5 s with throughput, then a total. */
function progress(log: (s: string) => void) {
  const t0 = Date.now(); let lastB = 0, lastT = t0;
  const fmt = (b: number) => (b / 1048576).toFixed(1);
  const fn = (b: number) => {
    const now = Date.now();
    if (b - lastB < 10 * 1048576 && now - lastT < 5000) return;
    const rate = ((b - lastB) / 1048576) / Math.max(0.001, (now - lastT) / 1000);
    log(`    ${fmt(b)} MB transferred, ${rate.toFixed(1)} MB/s`);
    lastB = b; lastT = now;
  };
  fn.done = (b: number) => log(`    ${fmt(b)} MB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return fn;
}
/** Forwards dump/restore tool output line by line, trimmed, capped. */
function toolLines(log: (s: string) => void) {
  let n = 0, buf = "";
  return (chunk: string) => {
    buf += chunk;
    const lines = buf.split("\n"); buf = lines.pop() ?? "";
    for (const l of lines) { const t = l.trim(); if (!t || t.includes("[Warning] Using a password")) continue; if (n++ < 200) log(`    | ${t.slice(0, 300)}`); else if (n === 201) log("    | (further tool output suppressed)"); }
  };
}

/** Tails a Coolify deployment's log entries until it finishes. Returns the final status. */
async function streamDeployment(A: Api, depUuid: string, log: (s: string) => void) {
  let seen = 0; const until = Date.now() + 30 * 60 * 1000;
  while (Date.now() < until) {
    const d = await A.get(`/deployments/${depUuid}`).catch(() => null);
    if (d) {
      let entries: any[] = [];
      try { entries = typeof d.logs === "string" ? JSON.parse(d.logs) : d.logs ?? []; } catch { /* partial write */ }
      for (const e of entries.slice(seen)) if (!e.hidden && e.output) for (const l of String(e.output).split("\n")) if (l.trim()) log(`  ${e.type === "stderr" ? "! " : ""}${l}`);
      seen = entries.length;
      if (["finished", "failed", "cancelled-by-user"].includes(d.status)) return d.status as string;
    }
    await sleep(3000);
  }
  return "timeout";
}

async function waitShell(c: Client, cmd: string, seconds: number) {
  const until = Date.now() + seconds * 1000;
  let last = "";
  while (Date.now() < until) {
    const r = await exec(c, cmd);
    if (r.code === 0) return;
    last = (r.err || r.out).trim().slice(-200);
    await sleep(4000);
  }
  throw new Error(`database never became ready: ${last}`);
}

async function waitFor(A: Api, path: string, ok: (x: any) => boolean, seconds: number) {
  const until = Date.now() + seconds * 1000;
  let last: any;
  while (Date.now() < until) {
    last = await A.get(path).catch(() => null);
    if (last && ok(last)) return last;
    await sleep(5000);
  }
  throw new Error(`timeout waiting for ${path} (last status: ${last?.status})`);
}
