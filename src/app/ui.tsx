"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ---------- dialogs (confirm / prompt) ---------- */
type DialogOpts = { title: string; body?: string; confirmText?: string; danger?: boolean; input?: { placeholder?: string; type?: "text" | "password"; mustEqual?: string; minLength?: number } };
type Pending = DialogOpts & { resolve: (v: string | null) => void };
type Toast = { id: number; kind: "ok" | "bad" | "info"; text: string };

const Ctx = createContext<{ dialog: (o: DialogOpts) => Promise<string | null>; toast: (kind: Toast["kind"], text: string) => void } | null>(null);

export function useUI() {
  const c = useContext(Ctx);
  if (!c) throw new Error("UIProvider missing");
  return {
    confirm: (o: DialogOpts) => c.dialog(o).then((v) => v !== null),
    prompt: (o: DialogOpts) => c.dialog({ ...o, input: o.input ?? {} }),
    toast: c.toast,
  };
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dialog = useCallback((o: DialogOpts) => new Promise<string | null>((resolve) => setPending({ ...o, resolve })), []);
  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={{ dialog, toast }}>
      {children}
      {pending && <Dialog p={pending} close={(v) => { pending.resolve(v); setPending(null); }} />}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}><span className={`dot ${t.kind === "ok" ? "ok" : t.kind === "bad" ? "bad" : ""}`} />{t.text}</div>)}</div>
    </Ctx.Provider>
  );
}

function Dialog({ p, close }: { p: Pending; close: (v: string | null) => void }) {
  const [val, setVal] = useState("");
  const first = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const valid = !p.input || ((p.input.mustEqual ? val === p.input.mustEqual : true) && val.length >= (p.input.minLength ?? (p.input.mustEqual ? 1 : 0)));
  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(null); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [close]);
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (valid) close(p.input ? val : ""); };
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-t" onSubmit={submit}>
        <h2 id="dlg-t">{p.title}</h2>
        {p.body && <p>{p.body}</p>}
        {p.input && <input ref={first as React.RefObject<HTMLInputElement>} type={p.input.type ?? "text"} value={val} onChange={(e) => setVal(e.target.value)} placeholder={p.input.placeholder} autoComplete="off" />}
        {p.input?.mustEqual && <p className="hint">Type <b className="mono">{p.input.mustEqual}</b> to confirm.</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
          <button ref={p.input ? undefined : (first as React.RefObject<HTMLButtonElement>)} type="submit" className={`btn ${p.danger ? "btn-danger-solid" : "btn-primary"}`} disabled={!valid}>{p.confirmText ?? "Confirm"}</button>
        </div>
      </form>
    </div>
  );
}

/* ---------- small pieces ---------- */
export const Spinner = ({ size = 14 }: { size?: number }) => <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
export const Skeleton = ({ w = "100%", h = 14, className = "" }: { w?: string | number; h?: number; className?: string }) => <span className={`skeleton ${className}`} style={{ width: w, height: h }} aria-hidden />;
export const SkeletonRows = ({ n = 4 }: { n?: number }) => (
  <div>{Array.from({ length: n }).map((_, i) => <div key={i} className="row" style={{ pointerEvents: "none" }}><Skeleton w={7} h={7} className="round" /><Skeleton w={`${40 + ((i * 23) % 40)}%`} /><span className="flex-1" /><Skeleton w={56} h={18} className="pill-sk" /></div>)}</div>
);
export const Empty = ({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) => (
  <div className="empty fade-in"><svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color: "var(--dim)", margin: "0 auto 12px" }}><rect x="6" y="9" width="8" height="18" rx="2" /><rect x="22" y="9" width="8" height="18" rx="2" /><path d="M14 18h8" strokeDasharray="2 2" /></svg><b>{title}</b>{children}{action && <div className="mt-4">{action}</div>}</div>
);
