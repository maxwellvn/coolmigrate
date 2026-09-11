import { Client, type ConnectConfig } from "ssh2";
import type { Instance } from "./db";

export function sshConfig(i: Instance): ConnectConfig {
  return { host: i.ssh_host, username: i.ssh_user, password: i.ssh_password ?? undefined, privateKey: i.ssh_key ?? undefined, readyTimeout: 20_000, keepaliveInterval: 10_000, keepaliveCountMax: 6 };
}

export function connect(cfg: ConnectConfig): Promise<Client> {
  return new Promise((res, rej) => {
    const c = new Client();
    c.on("ready", () => res(c)).on("error", rej).connect(cfg);
  });
}

export function exec(c: Client, cmd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res, rej) => {
    c.exec(cmd, (e, s) => {
      if (e) return rej(e);
      let out = "", err = "";
      s.on("data", (d: Buffer) => (out += d));
      s.stderr.on("data", (d: Buffer) => (err += d));
      s.on("close", (code: number) => res({ code, out, err }));
    });
  });
}

/** Run srcCmd on src, stream its stdout into dstCmd's stdin on dst. No temp files anywhere. */
export function pipe(src: Client, srcCmd: string, dst: Client, dstCmd: string, onProgress?: (bytes: number) => void, onLine?: (line: string) => void) {
  return new Promise<{ bytes: number; err: string }>((res, rej) => {
    let bytes = 0, err = "", srcCode: number | null = null, dstCode: number | null = null, settled = false;
    const finish = () => {
      if (settled || dstCode === null || srcCode === null) return;
      settled = true;
      if (srcCode || dstCode) rej(new Error(`dump exit ${srcCode}, restore exit ${dstCode}: ${err.slice(-2000)}`));
      else res({ bytes, err });
    };
    dst.exec(dstCmd, (e, ds) => {
      if (e) return rej(e);
      ds.stderr.on("data", (d: Buffer) => { err += d; onLine?.(String(d)); });
      ds.on("data", (d: Buffer) => onLine?.(String(d))); // drain stdout so the channel never stalls
      ds.on("exit", (code: number) => { dstCode = code ?? 0; finish(); });
      ds.on("close", (code?: number) => { if (dstCode === null) dstCode = code ?? 0; finish(); });
      src.exec(srcCmd, (e2, ss) => {
        if (e2) return rej(e2);
        ss.on("data", (d: Buffer) => { bytes += d.length; onProgress?.(bytes); });
        ss.stderr.on("data", (d: Buffer) => { err += d; onLine?.(String(d)); });
        ss.on("exit", (code: number) => { srcCode = code ?? 0; finish(); });
        ss.on("close", (code?: number) => { if (srcCode === null) srcCode = code ?? 0; finish(); });
        ss.pipe(ds);
      });
    });
  });
}
