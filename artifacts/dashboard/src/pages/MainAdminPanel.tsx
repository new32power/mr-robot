import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const _API_KEY = import.meta.env.VITE_API_SECRET ?? "";
function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const h = new Headers(opts.headers);
  if (_API_KEY) h.set("x-api-key", _API_KEY);
  return fetch(url, { ...opts, headers: h });
}

const T = {
  bg: "#070c1a", card: "#0e1525", cardHover: "#141e30",
  border: "#1a2740", borderLight: "#1f3050",
  text: "#f1f5f9", muted: "#4d6280", mutedLight: "#7a95b4",
  accent: "#6366f1", accentLight: "#818cf8", accentGlow: "rgba(99,102,241,0.15)",
  green: "#22c55e", red: "#ef4444", yellow: "#f59e0b", orange: "#f97316",
  inputBg: "#080e1c", headerBg: "#080e1c",
};

type App = {
  id: number; appId: string; name: string; pin: string;
  status: string; createdAt: string;
  deleteProtectionPin: string | null;
  deleteProtectionEnabled: boolean;
};

type FullDevice = {
  id: number; deviceId: string; appId: string; userId: string; name: string;
  androidVersion: number;
  sim1Carrier: string | null; sim1Phone: string | null;
  sim2Carrier: string | null; sim2Phone: string | null;
  status: string; lastOnline: string | null;
  forwardEnabled: boolean; forwardSlot: number | null;
  hasFcm: boolean; installedAt: string;
};

function generateAppId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const seg = (n: number) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `APP-${seg(4)}-${seg(4)}-${seg(4)}`;
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const el = document.createElement("textarea");
  el.value = text; el.style.position = "fixed"; el.style.opacity = "0";
  document.body.appendChild(el); el.select();
  document.execCommand("copy"); document.body.removeChild(el);
  return Promise.resolve();
}

/* ── SVG Icons ── */
const Ic = {
  Shield: () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>),
  Lock: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>),
  Eye: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>),
  EyeOff: () => (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>),
  Alert: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>),
  ArrowRight: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>),
  X: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>),
  Refresh: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>),
  Copy: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>),
  Check: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>),
  Layers: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>),
  CheckCircle: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>),
  XCircle: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>),
  Link: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>),
  Pencil: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>),
  LogOut2: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  Power: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>),
  Trash: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>),
  Key: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>),
  LogOut: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  Plus: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Inbox: () => (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>),
  Loader: () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 0.9s linear infinite" }}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>),
  CPU: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>),
  Smartphone: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>),
  Wifi: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>),
};

function CopyBtn({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    copyToClipboard(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <button onClick={handleCopy} title={`Copy ${label}`} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "3px 9px", borderRadius: 6,
      border: `1px solid ${copied ? T.green + "60" : T.borderLight}`,
      background: copied ? T.green + "18" : T.border + "80",
      color: copied ? T.green : T.mutedLight, cursor: "pointer",
      fontSize: 11, fontWeight: 600, gap: 5, transition: "all 0.15s", whiteSpace: "nowrap",
    }}>
      {copied ? <Ic.Check /> : <Ic.Copy />}{copied ? "Copied" : label}
    </button>
  );
}

/* ─────────── Login Screen ─────────── */
function MasterLogin({ onAuth }: { onAuth: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const r = await apiFetch("/api/admin/verify-master-pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Wrong master PIN. Try again."); setPin(""); return; }
      onAuth(pin);
    } catch { setErr("Network error. Try again."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse at 65% 15%, rgba(99,102,241,0.14) 0%, transparent 55%), radial-gradient(ellipse at 15% 85%, rgba(139,92,246,0.10) 0%, transparent 50%), ${T.bg}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "20px",
    }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
      <div style={{ width: "100%", maxWidth: 400, position: "relative", background: T.card, borderRadius: 24, padding: "44px 40px 36px", border: `1px solid ${T.borderLight}`, boxShadow: "0 32px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(99,102,241,0.08) inset" }}>
        <div style={{ position: "absolute", top: 0, left: 40, right: 40, height: 2, background: "linear-gradient(90deg, transparent, #6366f1, #8b5cf6, transparent)", borderRadius: "0 0 2px 2px" }} />
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 68, height: 68, borderRadius: 20, margin: "0 auto 18px", background: "linear-gradient(145deg, #4f52d4, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 12px 32px rgba(99,102,241,0.45), 0 0 0 1px rgba(255,255,255,0.08) inset" }}><Ic.Shield /></div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.text, letterSpacing: -0.5, lineHeight: 1.1 }}>MR ROBOT</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: T.accentLight, background: "rgba(99,102,241,0.12)", padding: "4px 14px", borderRadius: 99, border: "1px solid rgba(99,102,241,0.25)", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.accentLight, display: "inline-block" }} />Master Admin
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 10, color: T.mutedLight, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            <Ic.Lock /> Master PIN
          </label>
          <div style={{ position: "relative", marginTop: 8, marginBottom: 6 }}>
            <input type={showPin ? "text" : "password"} value={pin} onChange={e => setPin(e.target.value)} placeholder="Enter master PIN" autoFocus
              style={{ width: "100%", padding: "14px 46px 14px 16px", borderRadius: 12, border: `1.5px solid ${pin ? T.accent + "70" : T.borderLight}`, background: T.inputBg, color: T.text, fontSize: 15, outline: "none", boxSizing: "border-box", transition: "border-color 0.2s", fontFamily: pin && !showPin ? "monospace" : "inherit", letterSpacing: pin && !showPin ? 4 : "normal" }} />
            <button type="button" onClick={() => setShowPin(v => !v)} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: showPin ? T.accentLight : T.muted, cursor: "pointer", padding: 4, display: "flex", alignItems: "center", transition: "color 0.15s" }}>
              {showPin ? <Ic.EyeOff /> : <Ic.Eye />}
            </button>
          </div>
          {err && (<div style={{ display: "flex", alignItems: "center", gap: 8, color: T.red, fontSize: 12, marginTop: 10, marginBottom: 4, background: T.red + "12", padding: "9px 13px", borderRadius: 9, border: `1px solid ${T.red}30` }}><Ic.Alert /> {err}</div>)}
          <button type="submit" disabled={loading || !pin} style={{ width: "100%", marginTop: 20, padding: "14px 0", borderRadius: 12, background: pin && !loading ? "linear-gradient(135deg, #5254d4, #7c3aed)" : T.borderLight, color: pin && !loading ? "#fff" : T.muted, fontWeight: 800, fontSize: 14, border: "none", cursor: pin && !loading ? "pointer" : "default", letterSpacing: 0.3, transition: "all 0.2s", boxShadow: pin && !loading ? "0 8px 24px rgba(99,102,241,0.38)" : "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading ? (<><span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #fff3", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />Verifying…</>) : (<>Unlock Panel <Ic.ArrowRight /></>)}
          </button>
        </form>
        <div style={{ textAlign: "center", marginTop: 22, fontSize: 11, color: T.muted }}>MR ROBOT Control Panel · Secure Access</div>
      </div>
      <style>{`
          @keyframes spin { to { transform: rotate(360deg) } }
          @keyframes ma-pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
          * { box-sizing: border-box; }

          /* ─── Base button ─── */
          .ma-btn {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 7px 13px; font-size: 12px; font-weight: 600;
            cursor: pointer; white-space: nowrap; transition: all 0.15s;
            outline: none; font-family: inherit; text-decoration: none;
          }
          .ma-btn:active { transform: scale(0.95); }
          .ma-btn-lg { padding: 7px 15px; font-weight: 700; }

          /* ─── Layout helpers ─── */
          .ma-app-btns { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
          .ma-hdr-btns { display: flex; gap: 7px; align-items: center; flex-shrink: 0; }

          /* ─── Login card: tighter on small phones ─── */
          @media (max-width: 440px) {
            .ma-login-card { padding: 28px 20px 24px !important; border-radius: 18px !important; }
          }

          /* ─── Mobile ≤ 560px: icon-only buttons ─── */
          @media (max-width: 560px) {
            .ma-btn-lbl { display: none; }
            .ma-btn     { padding: 8px 9px; gap: 0; }
            .ma-btn-lg  { padding: 8px 10px; }
            .ma-hdr-btns{ gap: 4px; }
            .ma-app-btns{ gap: 4px; }
          }

          /* ─── Tablet 561–768px ─── */
          @media (min-width: 561px) and (max-width: 768px) {
            .ma-btn     { padding: 6px 10px; font-size: 11px; }
            .ma-btn-lg  { padding: 6px 11px; font-size: 11px; }
          }
        `}</style>
    </div>
  );
}

/* ─────────── Modal Shell ─────────── */
function Modal({ children, onClose, maxWidth = 420 }: { children: React.ReactNode; onClose: () => void; maxWidth?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.80)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, backdropFilter: "blur(3px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "100%", maxWidth, background: T.card, borderRadius: 20, padding: "26px 28px 24px", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,0.04) inset" }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, icon, onClose }: { title: string; icon?: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {icon && <div style={{ color: T.accentLight }}>{icon}</div>}
        <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{title}</div>
      </div>
      <button onClick={onClose} style={{ background: T.border, border: "none", color: T.mutedLight, cursor: "pointer", width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.X /></button>
    </div>
  );
}

const inpBase: React.CSSProperties = { width: "100%", marginTop: 6, padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${T.borderLight}`, background: T.inputBg, color: T.text, fontSize: 14, outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" };
function FieldLabel({ children }: { children: React.ReactNode }) { return <label style={{ fontSize: 10, color: T.mutedLight, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase" }}>{children}</label>; }
function ErrBanner({ msg }: { msg: string }) { return <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.red, fontSize: 12, marginBottom: 10, background: T.red + "12", padding: "9px 13px", borderRadius: 9, border: `1px solid ${T.red}30` }}><Ic.Alert /> {msg}</div>; }

/* ─────────── Create App Modal ─────────── */
function CreateAppModal({ masterPin, onClose, onCreated }: { masterPin: string; onClose: () => void; onCreated: (a: App) => void }) {
  const [name, setName] = useState("MR ROBOT");
  const [appId, setAppId] = useState(generateAppId);
  const [pin, setPin] = useState("1234");
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !pin.trim()) { setErr("All fields required"); return; }
    if (pin.length < 4) { setErr("PIN must be at least 4 characters"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await apiFetch("/api/master/apps", { method: "POST", headers: { "Content-Type": "application/json", "x-master-pin": masterPin }, body: JSON.stringify({ appId, name: name.trim(), pin }) });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      onCreated(await r.json() as App);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Create Sub-Admin App" onClose={onClose} />
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 14 }}>
          <FieldLabel>Version</FieldLabel>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => setName("MR ROBOT")} style={{ flex: 1, padding: "14px 8px", borderRadius: 12, border: `2px solid ${name === "MR ROBOT" ? T.accent : T.borderLight}`, background: name === "MR ROBOT" ? T.accentGlow : T.border, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "all 0.15s" }}>
              <span style={{ fontSize: 22 }}>🤖</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: name === "MR ROBOT" ? T.accentLight : T.muted, letterSpacing: 0.5 }}>MR ROBOT</span>
            </button>
            <button type="button" onClick={() => setName("ZERO TRACE")} style={{ flex: 1, padding: "14px 8px", borderRadius: 12, border: `2px solid ${name === "ZERO TRACE" ? "#059669" : T.borderLight}`, background: name === "ZERO TRACE" ? "#05966918" : T.border, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "all 0.15s" }}>
              <span style={{ fontSize: 22 }}>👁️</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: name === "ZERO TRACE" ? "#059669" : T.muted, letterSpacing: 0.5 }}>ZERO TRACE</span>
            </button>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <FieldLabel>App ID</FieldLabel>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input type="text" value={appId} onChange={e => setAppId(e.target.value)} style={{ ...inpBase, marginTop: 0, flex: 1, fontFamily: "monospace", fontSize: 12 }} />
            <button type="button" onClick={() => setAppId(generateAppId())} style={{ padding: "0 14px", borderRadius: 10, background: T.border, border: `1px solid ${T.borderLight}`, color: T.mutedLight, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}><Ic.Refresh /> New</button>
          </div>
        </div>
        <div style={{ marginBottom: 14 }}><FieldLabel>Login PIN</FieldLabel><input type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="min 4 characters" style={inpBase} /></div>
        {err && <ErrBanner msg={err} />}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: `1px solid ${T.borderLight}`, color: T.text, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={loading} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer", fontSize: 13, boxShadow: "0 4px 14px rgba(99,102,241,0.3)" }}>{loading ? "Creating…" : "Create App"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────── Change Master PIN Modal ─────────── */
function ChangePinModal({ masterPin, onClose, onChanged }: { masterPin: string; onClose: () => void; onChanged: (p: string) => void }) {
  const [currentPin, setCurrentPin] = useState(masterPin);
  const [newPin, setNewPin] = useState(""); const [newPin2, setNewPin2] = useState("");
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPin.length < 4) { setErr("New PIN must be at least 4 characters"); return; }
    if (newPin !== newPin2) { setErr("PINs do not match"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await apiFetch("/api/admin/master-pin", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPin, newPin }) });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      onChanged(newPin);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose} maxWidth={380}>
      <ModalHeader title="Change Master PIN" icon={<Ic.Key />} onClose={onClose} />
      <form onSubmit={handleSubmit}>
        {[{ label: "Current PIN", val: currentPin, set: setCurrentPin }, { label: "New PIN", val: newPin, set: setNewPin }, { label: "Confirm New PIN", val: newPin2, set: setNewPin2 }].map(({ label, val, set }) => (
          <div key={label} style={{ marginBottom: 12 }}><FieldLabel>{label}</FieldLabel><input type="password" value={val} onChange={e => set(e.target.value)} style={inpBase} /></div>
        ))}
        {err && <ErrBanner msg={err} />}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: `1px solid ${T.borderLight}`, color: T.text, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={loading} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer", fontSize: 13 }}>{loading ? "Saving…" : "Change PIN"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────── Edit App Modal ─────────── */
function EditAppModal({ app, masterPin, onClose, onUpdated }: { app: App; masterPin: string; onClose: () => void; onUpdated: (a: App) => void }) {
  const [name, setName] = useState(app.name); const [pin, setPin] = useState(app.pin);
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name required"); return; }
    if (pin.length < 4) { setErr("PIN must be at least 4 characters"); return; }
    setErr(""); setLoading(true);
    try {
      const r = await apiFetch(`/api/master/apps/${encodeURIComponent(app.appId)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-master-pin": masterPin }, body: JSON.stringify({ name: name.trim(), pin }) });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      onUpdated(await r.json() as App);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Edit App" icon={<Ic.Pencil />} onClose={onClose} />
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 18, fontFamily: "monospace", background: T.inputBg, padding: "6px 12px", borderRadius: 8, display: "inline-block", border: `1px solid ${T.borderLight}` }}>{app.appId}</div>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 14 }}><FieldLabel>App Name</FieldLabel><input type="text" value={name} onChange={e => setName(e.target.value)} style={inpBase} /></div>
        <div style={{ marginBottom: 14 }}><FieldLabel>Login PIN</FieldLabel><input type="text" value={pin} onChange={e => setPin(e.target.value)} style={{ ...inpBase, fontFamily: "monospace" }} /></div>
        {err && <ErrBanner msg={err} />}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: `1px solid ${T.borderLight}`, color: T.text, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button type="submit" disabled={loading} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer", fontSize: 13 }}>{loading ? "Saving…" : "Save Changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────── All Devices Modal ─────────── */
const PAGE_SIZE = 48;
function AllDevicesModal({ devices, loading, search, onSearchChange, onClose, onRefresh }: {
  devices: FullDevice[]; loading: boolean; search: string;
  onSearchChange: (v: string) => void; onClose: () => void; onRefresh: () => void;
}) {
  const [page, setPage] = useState(1);
  const [inputVal, setInputVal] = useState(search);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchInput(v: string) {
    setInputVal(v); setPage(1);
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => onSearchChange(v), 300);
  }
  function clearSearch() { setInputVal(""); onSearchChange(""); setPage(1); }

  const s = search.trim().toLowerCase();
  const filtered = useMemo(() => s === "" ? devices : devices.filter(d =>
    d.name.toLowerCase().includes(s) || d.appId.toLowerCase().includes(s) ||
    d.deviceId.toLowerCase().includes(s) || (d.sim1Phone ?? "").includes(s) || (d.sim2Phone ?? "").includes(s)
  ), [devices, s]);

  const shown = s !== "" ? filtered : filtered.slice(0, page * PAGE_SIZE);
  const hasMore = s === "" && shown.length < filtered.length;
  const ONLINE_MS = 15 * 60 * 1000;
  const online = devices.filter(d => d.lastOnline ? (Date.now() - new Date(d.lastOnline).getTime()) < ONLINE_MS : false).length;

  const appColors: Record<string, string> = {};
  const palette = ["#6366f1","#8b5cf6","#06b6d4","#f59e0b","#10b981","#ef4444","#f97316","#ec4899","#14b8a6","#84cc16"];
  let ci = 0;
  devices.forEach(d => { if (!appColors[d.appId]) appColors[d.appId] = palette[ci++ % palette.length]; });

  function renderSim(slot: number, carrier: string | null, phone: string | null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, background: T.border, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>SIM{slot}</span>
        {carrier || phone ? (
          <span style={{ fontSize: 12, color: T.mutedLight }}>
            {carrier && <span style={{ color: T.text, fontWeight: 600 }}>{carrier}</span>}
            {carrier && phone && " · "}
            {phone && <span style={{ fontFamily: "monospace", color: "#93c5fd" }}>{phone}</span>}
          </span>
        ) : <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>No SIM</span>}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 200, display: "flex", flexDirection: "column", backdropFilter: "blur(4px)" }}>
      {/* Header */}
      <div style={{ background: T.headerBg, borderBottom: `1px solid ${T.border}`, padding: "0 16px", flexShrink: 0 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", height: 56, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap" }}>
            <div style={{ color: T.accentLight }}><Ic.Smartphone /></div>
            <span style={{ fontWeight: 900, fontSize: 16, color: T.text }}>All Devices</span>
            <span style={{ background: T.accentGlow, color: T.accentLight, borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 800, border: `1px solid ${T.accent}44` }}>{devices.length} total</span>
            <span style={{ background: "#16a34a22", color: "#4ade80", borderRadius: 99, padding: "2px 10px", fontSize: 11, fontWeight: 800, border: "1px solid #16a34a44" }}>{online} online</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onRefresh} disabled={loading} style={{ background: T.border, border: `1px solid ${T.borderLight}`, color: loading ? T.muted : T.text, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: loading ? "default" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Ic.Refresh />{loading ? "..." : "Refresh"}
            </button>
            <button onClick={onClose} style={{ background: T.border, border: `1px solid ${T.borderLight}`, color: T.text, borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center" }}><Ic.X /></button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ background: T.bg, padding: "12px 16px", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", position: "relative" }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: T.muted, pointerEvents: "none", display: "flex" }}><Ic.Search /></span>
          <input type="text" placeholder="Search by name, App ID, Device ID, phone…" value={inputVal} onChange={e => handleSearchInput(e.target.value)} autoFocus
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 40px", borderRadius: 10, background: T.card, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 13, outline: "none" }} />
          {inputVal && <button onClick={clearSearch} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: T.border, border: "none", color: T.muted, cursor: "pointer", width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.X /></button>}
        </div>
      </div>

      {/* Device list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px", background: T.bg }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 80, color: T.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
              <div style={{ color: T.accent }}><Ic.Loader /></div>
              <div>Loading devices…</div>
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 80, color: T.muted, background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div style={{ color: T.border }}><Ic.Inbox /></div>
              <div>{search ? `No devices found for "${search}".` : "No devices found."}</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {shown.map(d => {
                const acColor = appColors[d.appId] ?? T.accent;
                const isOnline = d.lastOnline ? (Date.now() - new Date(d.lastOnline).getTime()) < ONLINE_MS : false;
                return (
                  <div key={d.deviceId} style={{ background: T.card, borderRadius: 14, border: `1px solid ${isOnline ? T.green + "30" : T.borderLight}`, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                    <div style={{ padding: "10px 14px", background: T.headerBg, borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ background: acColor + "22", color: acColor, border: `1px solid ${acColor}44`, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 800, letterSpacing: 0.5, flexShrink: 0 }}>{d.appId}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, background: isOnline ? "#16a34a22" : T.border, color: isOnline ? "#4ade80" : T.muted, borderRadius: 99, padding: "2px 9px", fontSize: 10, fontWeight: 800, border: `1px solid ${isOnline ? "#16a34a44" : "transparent"}`, flexShrink: 0 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: isOnline ? "#4ade80" : T.muted, display: "inline-block" }} />
                        {isOnline ? "ONLINE" : "OFFLINE"}
                      </span>
                    </div>
                    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: T.text, lineHeight: 1.2 }}>{d.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, color: T.muted, fontWeight: 700, flexShrink: 0 }}>Device ID</span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: T.mutedLight, wordBreak: "break-all", flex: 1 }}>{d.deviceId}</span>
                        <button onClick={() => { void navigator.clipboard?.writeText(d.deviceId); }} style={{ background: T.border, border: "none", color: T.muted, cursor: "pointer", padding: "3px 6px", borderRadius: 5, display: "flex", alignItems: "center", flexShrink: 0 }} title="Copy"><Ic.Copy /></button>
                      </div>
                      <div style={{ height: 1, background: T.border }} />
                      {renderSim(1, d.sim1Carrier, d.sim1Phone)}
                      {renderSim(2, d.sim2Carrier, d.sim2Phone)}
                      <div style={{ height: 1, background: T.border }} />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 10, color: T.muted }}>Android</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: d.androidVersion > 0 ? T.text : T.muted }}>{d.androidVersion > 0 ? `v${d.androidVersion}` : "—"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 10, color: T.muted }}>FCM</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: d.hasFcm ? T.green : T.red }}>{d.hasFcm ? "Active" : "None"}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 10, color: T.muted }}>Forward</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: d.forwardEnabled ? T.green : T.muted }}>{d.forwardEnabled ? `SIM${d.forwardSlot ?? "?"} ON` : "Off"}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                          <span style={{ color: T.muted }}>Last Online</span>
                          <span style={{ color: d.lastOnline ? T.mutedLight : T.muted, fontWeight: 600 }}>{fmtAgo(d.lastOnline)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                          <span style={{ color: T.muted }}>Installed</span>
                          <span style={{ color: T.mutedLight, fontWeight: 600 }}>{fmtAgo(d.installedAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {hasMore && !loading && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button onClick={() => setPage(p => p + 1)} style={{ padding: "10px 32px", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Load More ({filtered.length - shown.length} remaining)
              </button>
            </div>
          )}
          {!hasMore && shown.length > 0 && !loading && (
            <div style={{ textAlign: "center", marginTop: 16, color: T.muted, fontSize: 11 }}>{filtered.length} device{filtered.length !== 1 ? "s" : ""} shown</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── App Card ─────────── */
function AppCard({ app, onEdit, onDelete, onToggle, onLogoutAll, onCopyUrl, onResetApk, copyMsg, deletingId, togglingId, logoutAllId, resetApkId }: {
  app: App; onEdit: (a: App) => void; onDelete: (a: App) => void;
  onToggle: (a: App) => void; onLogoutAll: (a: App) => void; onCopyUrl: (a: App) => void; onResetApk: (a: App) => void;
  copyMsg: Record<string, string>; deletingId: string | null; togglingId: string | null; logoutAllId: string | null; resetApkId: string | null;
}) {
  const isActive = app.status === "active";
  const dt = new Date(app.createdAt);
  const dateStr = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " · " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return (
      <div style={{ background:T.card, borderRadius:16, border:`1px solid ${T.borderLight}`, overflow:"hidden", transition:"all 0.2s", position:"relative", boxShadow:"0 2px 12px rgba(0,0,0,0.18)" }}>
        <div style={{ position:"absolute", left:0, top:0, bottom:0, width:3, background:isActive?`linear-gradient(180deg,${T.green},#4ade80)`:`linear-gradient(180deg,${T.red},#f87171)` }} />
        <div style={{ padding:"13px 14px 13px 18px" }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:15, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{app.name}</div>
              <div style={{ fontSize:10, color:T.muted, marginTop:2 }}>{dateStr}</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:10, fontWeight:700, padding:"3px 9px", borderRadius:99, color:isActive?T.green:T.red, background:(isActive?T.green:T.red)+"18", border:`1px solid ${(isActive?T.green:T.red)}30` }}>
                <span style={{ width:5, height:5, borderRadius:"50%", background:isActive?T.green:T.red, display:"inline-block" }} />{isActive?"Active":"Off"}
              </span>

            </div>
          </div>
          <div style={{ display:"flex", gap:8, marginBottom:11 }}>
            <div style={{ flex:1, background:T.inputBg, borderRadius:9, padding:"7px 10px", border:`1px solid ${T.border}`, minWidth:0 }}>
              <div style={{ fontSize:9, color:T.muted, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>App ID</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:10, color:T.accentLight, fontFamily:"monospace", fontWeight:600, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{app.appId}</span>
                <CopyBtn value={app.appId} label="ID" />
              </div>
            </div>
            <div style={{ background:T.inputBg, borderRadius:9, padding:"7px 10px", border:`1px solid ${T.border}`, flexShrink:0 }}>
              <div style={{ fontSize:9, color:T.muted, fontWeight:700, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>PIN</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ fontSize:14, color:T.text, fontFamily:"monospace", letterSpacing:4, fontWeight:700 }}>{app.pin}</span>
                <CopyBtn value={app.pin} label="PIN" />
              </div>
            </div>
          </div>
          {/* Delete Protection row */}
          <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 10px", borderRadius:9, background:app.deleteProtectionPin ? (app.deleteProtectionEnabled ? "#16a34a18" : "#1a274080") : "#1a274050", border:`1px solid ${app.deleteProtectionPin ? (app.deleteProtectionEnabled ? "#16a34a40" : T.borderLight) : T.border}`, marginBottom:7 }}>
            <span style={{ fontSize:10, color:T.muted, fontWeight:700, letterSpacing:0.8, textTransform:"uppercase", flexShrink:0 }}>Del Password</span>
            <span style={{ flex:1 }} />
            {app.deleteProtectionPin ? (
              <>
                <span style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color: app.deleteProtectionEnabled ? "#4ade80" : T.mutedLight, letterSpacing:1 }}>{app.deleteProtectionPin}</span>
                <span style={{ fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:99, background: app.deleteProtectionEnabled ? "#16a34a22" : T.border, color: app.deleteProtectionEnabled ? "#4ade80" : T.muted, border:`1px solid ${app.deleteProtectionEnabled ? "#16a34a44" : "transparent"}`, flexShrink:0 }}>{app.deleteProtectionEnabled ? "ON" : "OFF"}</span>
              </>
            ) : (
              <span style={{ fontSize:11, color:T.muted, fontStyle:"italic" }}>Not set</span>
            )}
          </div>
          <div style={{ display:"flex", gap:5, alignItems:"center" }}>
            <button onClick={() => onCopyUrl(app)} title={copyMsg[app.appId]||"Copy URL"}
              style={{ flex:1, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s", outline:"none", border:"1px solid", background:copyMsg[app.appId]?T.green+"1a":T.border+"60", borderColor:copyMsg[app.appId]?T.green+"55":T.borderLight, color:copyMsg[app.appId]?T.green:T.mutedLight }}>
              {copyMsg[app.appId] ? <Ic.Check /> : <Ic.Link />}
            </button>
            <button onClick={() => onEdit(app)} title="Edit App"
              style={{ flex:1, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s", outline:"none", background:T.accentGlow, border:`1px solid ${T.accent}30`, color:T.accentLight }}>
              <Ic.Pencil />
            </button>
            <button onClick={() => onLogoutAll(app)} disabled={logoutAllId===app.appId} title="Logout All Users"
              style={{ flex:1, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s", outline:"none", background:T.orange+"14", border:`1px solid ${T.orange}30`, color:T.orange, opacity:logoutAllId===app.appId?0.45:1, cursor:logoutAllId===app.appId?"wait":"pointer" }}>
              <Ic.LogOut2 />
            </button>
            <button onClick={() => onResetApk(app)} disabled={resetApkId===app.appId} title="Reset APK"
              style={{ flex:1, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s", outline:"none", background:"#0ea5e914", border:"1px solid #0ea5e940", color:"#38bdf8", opacity:resetApkId===app.appId?0.45:1, cursor:resetApkId===app.appId?"wait":"pointer" }}>
              <Ic.Refresh />
            </button>
            <div style={{ width:1, height:22, background:T.border, flexShrink:0 }} />
            <button onClick={() => onToggle(app)} disabled={togglingId===app.appId} title={isActive?"Disable":"Enable"}
              style={{ flex:1, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s", outline:"none", background:isActive?T.yellow+"14":T.green+"14", border:`1.5px solid ${isActive?T.yellow+"55":T.green+"55"}`, color:isActive?T.yellow:T.green, opacity:togglingId===app.appId?0.45:1, cursor:togglingId===app.appId?"wait":"pointer" }}>
              <Ic.Power />
            </button>
            <button onClick={() => onDelete(app)} disabled={deletingId===app.appId} title="Delete App"
              style={{ flex:1, height:36, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s", outline:"none", background:T.red+"14", border:`1.5px solid ${T.red}44`, color:T.red, opacity:deletingId===app.appId?0.45:1, cursor:deletingId===app.appId?"wait":"pointer" }}>
              <Ic.Trash />
            </button>
          </div>
        </div>
      </div>
    );
  }

/* ─────────── Dashboard ─────────── */
function Dashboard({ masterPin, onLogout, onPinChanged }: { masterPin: string; onLogout: () => void; onPinChanged: (p: string) => void }) {
  const [appList, setAppList] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [showAllDevices, setShowAllDevices] = useState(false);
  const [allDevicesList, setAllDevicesList] = useState<FullDevice[]>([]);
  const [allDevLoading, setAllDevLoading] = useState(false);
  const [allDevSearch, setAllDevSearch] = useState("");
  const [editApp, setEditApp] = useState<App | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<Record<string, string>>({});
  const [logoutAllId, setLogoutAllId] = useState<string | null>(null);
    const [resetApkId, setResetApkId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  /* ── FCM Check Online ── */
  const [pingState, setPingState] = useState<"idle"|"loading"|"running"|"done"|"err">("idle");
  const [pingDone, setPingDone] = useState(0);
  const [pingTotal, setPingTotal] = useState(0);
  const [pingResult, setPingResult] = useState<{ ok: number; fail: number } | null>(null);
  const sortedApps = [...appList].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const fetchApps = useCallback(async () => {
    try {
      const r = await apiFetch("/api/master/apps", { headers: { "x-master-pin": masterPin } });
      if (r.status === 401) { onLogout(); return; }
      if (!r.ok) return;
      setAppList(await r.json() as App[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [masterPin, onLogout]);

  useEffect(() => { void fetchApps(); }, [fetchApps]);

  async function fetchAllDevices(): Promise<FullDevice[]> {
    const r = await apiFetch("/api/master/all-devices", { headers: { "x-master-pin": masterPin } });
    if (!r.ok) throw new Error("Failed to fetch devices");
    return r.json() as Promise<FullDevice[]>;
  }

  async function openAllDevices(forceRefresh = false) {
    setShowAllDevices(true); setAllDevSearch("");
    if (!forceRefresh && allDevicesList.length > 0) return;
    setAllDevLoading(true);
    try { setAllDevicesList(await fetchAllDevices()); }
    catch { /* ignore */ } finally { setAllDevLoading(false); }
  }

    async function handlePingAll() {
    setPingState("loading"); setPingResult(null); setPingDone(0); setPingTotal(0);
    try {
      const eligible = (await apiFetch("/api/master/all-devices?hasFcm=1", { headers: { "x-master-pin": masterPin } }).then(r => r.ok ? r.json() : [])) as FullDevice[];
      // hasFcm filter applied server-side
      setPingTotal(eligible.length); setPingState("running");
      const BATCH = 100; const DELAY = 300;
      let ok = 0; let fail = 0;
      for (let i = 0; i < eligible.length; i += BATCH) {
        const batch = eligible.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(d =>
          apiFetch("/api/fcm/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: d.deviceId, data: { type: "check_online" } }),
          }).then(r => { if (!r.ok) throw new Error("FCM failed"); })
        ));
        results.forEach(r => r.status === "fulfilled" ? ok++ : fail++);
        setPingDone(Math.min(i + BATCH, eligible.length));
        if (i + BATCH < eligible.length) await new Promise(r => setTimeout(r, DELAY));
      }
      setPingResult({ ok, fail }); setPingState("done");
      setTimeout(() => { setPingState("idle"); setPingDone(0); setPingTotal(0); setPingResult(null); }, 7000);
    } catch { setPingState("err"); setTimeout(() => setPingState("idle"), 3000); }
  }

  async function toggleStatus(app: App) {
    setTogglingId(app.appId);
    const newStatus = app.status === "active" ? "disabled" : "active";
    try {
      await apiFetch(`/api/master/apps/${encodeURIComponent(app.appId)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-master-pin": masterPin }, body: JSON.stringify({ status: newStatus }) });
      setAppList(prev => prev.map(a => a.appId === app.appId ? { ...a, status: newStatus } : a));
    } catch { /* ignore */ } finally { setTogglingId(null); }
  }

  async function deleteApp(app: App) {
    if (!confirm(`Delete "${app.name}"?\nThis cannot be undone.`)) return;
    setDeletingId(app.appId);
    try {
      await apiFetch(`/api/master/apps/${encodeURIComponent(app.appId)}`, { method: "DELETE", headers: { "x-master-pin": masterPin } });
      setAppList(prev => prev.filter(a => a.appId !== app.appId));
    } catch { /* ignore */ } finally { setDeletingId(null); }
  }

  async function logoutAll(app: App) {
    if (!confirm(`Logout all active sessions for "${app.name}"?`)) return;
    setLogoutAllId(app.appId);
    try {
      await apiFetch(`/api/admin/sessions?appId=${encodeURIComponent(app.appId)}`, { method: "DELETE" });
      setAppList(prev => prev.map(a => a.appId === app.appId ? { ...a } : a));
    } catch { /* ignore */ } finally { setLogoutAllId(null); }
  }

  async function resetApk(app: App) {
      if (!confirm(`Reset APK selection for "${app.name}"?

Sabhi users ka selected APK clear ho jaayega — woh fir se select kar sakenge.`)) return;
      setResetApkId(app.appId);
      try {
        const r = await apiFetch(`/api/master/token-app/${encodeURIComponent(app.appId)}`, {
          method: "DELETE",
          headers: { "x-master-pin": masterPin },
        });
        const j = await r.json() as { ok?: boolean; error?: string; deleted?: number };
        if (r.ok) alert(`✅ Reset done! ${j.deleted ?? 0} token mapping(s) cleared.`);
        else alert(`❌ Error: ${j.error ?? "Unknown error"}`);
      } catch { alert("❌ Network error"); } finally { setResetApkId(null); }
    }

    function copyUrl(app: App) {
    const url = `${window.location.origin}/preview/dashboard/WebDashboard?appId=${app.appId}`;
    copyToClipboard(url).then(() => {
      setCopyMsg(p => ({ ...p, [app.appId]: "Copied!" }));
      setTimeout(() => setCopyMsg(p => ({ ...p, [app.appId]: "" })), 2000);
    });
  }

  const filteredApps = search.trim() === "" ? sortedApps : sortedApps.filter(a =>
    a.appId.toLowerCase().includes(search.trim().toLowerCase()) || a.name.toLowerCase().includes(search.trim().toLowerCase())
  );
  const activeCount = appList.filter(a => a.status === "active").length;
  const disabledCount = appList.length - activeCount;
  const pingBusy = pingState === "running" || pingState === "loading";

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'Inter', system-ui, sans-serif", color: T.text }}>

      <style>{`
              @keyframes spin { to { transform: rotate(360deg) } }
              @keyframes ma-pulse { 0%,100%{opacity:1} 50%{opacity:0.55} }
              @keyframes ma-fabglow { 0%,100%{box-shadow:0 4px 20px rgba(99,102,241,0.55)} 50%{box-shadow:0 4px 32px rgba(139,92,246,0.75)} }
              * { box-sizing:border-box; }
              .ma-card { transition:transform 0.18s, box-shadow 0.18s !important; }
              .ma-card:active { transform:scale(0.985); }
              .ma-btn { -webkit-tap-highlight-color:transparent; }
              .ma-btn:active { opacity:0.7 !important; transform:scale(0.92); }
              .ma-bottom-nav {
                display:none; position:fixed; bottom:0; left:0; right:0;
                background:rgba(7,9,20,0.98); border-top:1px solid rgba(99,102,241,0.2);
                backdrop-filter:blur(28px); -webkit-backdrop-filter:blur(28px);
                padding:8px 12px calc(10px + env(safe-area-inset-bottom)); z-index:200;
                justify-content:space-around; align-items:center;
                box-shadow:0 -6px 40px rgba(0,0,0,0.75);
              }
              .ma-bnav-item {
                display:flex; flex-direction:column; align-items:center; gap:3px;
                cursor:pointer; color:rgba(100,115,160,0.85); transition:color 0.15s;
                background:none; border:none; outline:none; padding:6px 18px;
                font-family:inherit; -webkit-tap-highlight-color:transparent; flex:1;
              }
              .ma-bnav-item:active { color:#818cf8; transform:scale(0.88); }
              .ma-bnav-lbl { font-size:10px; font-weight:700; letter-spacing:0.4px; text-transform:uppercase; margin-top:1px; }
              .ma-fab {
                width:54px; height:54px; border-radius:17px; border:none;
                background:linear-gradient(135deg,#5254d4,#7c3aed);
                box-shadow:0 4px 20px rgba(99,102,241,0.55), 0 0 0 1px rgba(255,255,255,0.07) inset;
                display:flex; align-items:center; justify-content:center;
                color:#fff; cursor:pointer; transition:all 0.15s; outline:none;
                margin-top:-20px; flex-shrink:0;
                animation:ma-fabglow 2.8s ease-in-out infinite;
              }
              .ma-fab:active { transform:scale(0.88) !important; }
              .ma-fab-wrap { display:flex; flex-direction:column; align-items:center; gap:3px; flex:1; }
              @media (max-width:640px) {
                .ma-bottom-nav { display:flex; }
                .ma-hide-mob { display:none !important; }
                .ma-main { padding-bottom:88px !important; }
              }
            `}</style>

      {/* ── Header ── */}
        <div style={{ background:"rgba(7,9,20,0.98)", borderBottom:"1px solid rgba(99,102,241,0.18)", padding:"0 16px", position:"sticky", top:0, zIndex:50, backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", boxShadow:"0 4px 24px rgba(0,0,0,0.6)" }}>
          <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:"linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#6366f1)", backgroundSize:"200% 100%", animation:"none" }} />
          <div style={{ maxWidth:960, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, gap:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:34, height:34, borderRadius:11, background:"linear-gradient(145deg,#4f52d4,#7c3aed)", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff", flexShrink:0, boxShadow:"0 4px 14px rgba(99,102,241,0.5)" }}>
                <Ic.CPU />
              </div>
              <div style={{ lineHeight:1.15 }}>
                <div style={{ fontSize:14, fontWeight:900, color:"#f1f1f5", letterSpacing:-0.4 }}>MR ROBOT</div>
                <div style={{ fontSize:9, color:"#818cf8", fontWeight:700, letterSpacing:1.8, textTransform:"uppercase" }}>Master Admin</div>
              </div>
            </div>
            <div style={{ display:"flex", gap:7, alignItems:"center" }}>
              <button onClick={() => void openAllDevices()} title="All Devices" className="ma-btn" style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s", outline:"none", border:"1px solid rgba(99,102,241,0.3)", background:"rgba(99,102,241,0.14)", color:"#818cf8" }}>
                <Ic.Smartphone />
              </button>
              <button onClick={() => setShowChangePin(true)} title="Change PIN" className="ma-btn" style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s", outline:"none", border:"1px solid rgba(255,255,255,0.08)", background:"rgba(255,255,255,0.04)", color:"#94a3b8" }}>
                <Ic.Key />
              </button>
              <button onClick={onLogout} title="Logout" className="ma-btn" style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s", outline:"none", border:"1px solid rgba(239,68,68,0.28)", background:"rgba(239,68,68,0.1)", color:"#f87171" }}>
                <Ic.LogOut />
              </button>
            </div>
          </div>
        </div>
      <div className="ma-main" style={{ maxWidth:960,margin:"0 auto",padding:"20px 14px" }}>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Total Apps", val: appList.length, color: T.accent, Icon: Ic.Layers },
            { label: "Active", val: activeCount, color: T.green, Icon: Ic.CheckCircle },
            { label: "Disabled", val: disabledCount, color: T.red, Icon: Ic.XCircle },
          ].map(({ label, val, color, Icon }) => (
            <div key={label} style={{ background: T.card, borderRadius: 13, padding: "15px 18px", border: `1px solid ${T.borderLight}`, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -10, right: -10, width: 60, height: 60, borderRadius: "50%", background: color + "12", pointerEvents: "none" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color, opacity: 0.9 }}><Icon /></span>
                <span style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
            </div>
          ))}
        </div>

        {/* ── FCM Check Online Section ── */}
        <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ color: T.accentLight }}><Ic.Wifi /></div>
              <span style={{ fontWeight: 800, fontSize: 14, color: T.text }}>Check Online</span>
            </div>
            <span style={{ background: T.accentGlow, color: T.accentLight, borderRadius: 99, padding: "2px 10px", fontSize: 10, fontWeight: 800, border: `1px solid ${T.accent}44` }}>ALL DEVICES</span>
          </div>
          <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>
              Sends a <b style={{ color: T.mutedLight }}>check_online</b> ping to all <b style={{ color: T.mutedLight }}>FCM-enabled devices</b> across all App IDs — in batches of 100. No effect on sub-admin.
            </div>

            {/* Progress bar */}
            {(pingState === "running" || pingState === "loading") && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.muted, marginBottom: 5 }}>
                  <span>{pingState === "loading" ? "Fetching devices…" : "Sending pings…"}</span>
                  {pingState === "running" && <span style={{ color: T.accentLight, fontWeight: 700 }}>{pingDone} / {pingTotal}</span>}
                </div>
                <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: `linear-gradient(90deg, ${T.accent}, #8b5cf6)`, width: pingState === "loading" ? "15%" : `${pingTotal > 0 ? Math.round((pingDone / pingTotal) * 100) : 0}%`, transition: "width 0.3s" }} />
                </div>
              </div>
            )}

            {/* Result */}
            {pingState === "done" && pingResult && (
              <div style={{ background: T.green + "18", border: `1px solid ${T.green}44`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ color: T.green, fontWeight: 700, fontSize: 13 }}>Ping complete!</span>
                <span style={{ fontSize: 12, color: T.muted }}>
                  <span style={{ color: T.green, fontWeight: 700 }}>{pingResult.ok}</span> sent
                  {pingResult.fail > 0 && <> · <span style={{ color: T.red, fontWeight: 700 }}>{pingResult.fail}</span> failed</>}
                </span>
              </div>
            )}
            {pingState === "err" && (
              <div style={{ background: T.red + "15", border: `1px solid ${T.red}33`, borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, color: T.red, fontSize: 13, fontWeight: 700 }}>
                <Ic.Alert /> Fetch failed. Please retry.
              </div>
            )}

            <button
              onClick={() => void handlePingAll()}
              disabled={pingBusy}
              style={{
                padding: "12px 0", borderRadius: 10, border: "none",
                background: pingState === "done" ? T.green : pingBusy ? T.accentGlow : `linear-gradient(135deg,${T.accent},#8b5cf6)`,
                color: pingState === "done" ? "#fff" : pingBusy ? T.accentLight : "#fff",
                fontWeight: 800, fontSize: 13, cursor: pingBusy ? "not-allowed" : "pointer",
                boxShadow: !pingBusy && pingState !== "done" ? "0 4px 14px rgba(99,102,241,0.35)" : "none",
                transition: "all 0.15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {pingState === "loading" ? (<><div style={{ display: "inline-block", width: 13, height: 13, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Fetching…</>) :
               pingState === "running" ? (<><div style={{ display: "inline-block", width: 13, height: 13, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> {pingDone}/{pingTotal}…</>) :
               pingState === "done" ? (<><Ic.Check /> Done</>) :
               pingState === "err" ? "Error — Retry" :
               (<><Ic.Wifi /> Ping All Devices</>)}
            </button>
          </div>
        </div>

          {/* Apps header */}
          <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,gap:12,flexWrap:"wrap" }}>
            <div>
              <div style={{ fontSize:14,fontWeight:800,color:T.text }}>Sub-Admin Apps</div>
              <div style={{ fontSize:11,color:T.muted,marginTop:2 }}>Sorted by newest first</div>
            </div>
            <button onClick={() => setShowCreate(true)} className="ma-hide-mob" style={{ padding:"8px 16px",borderRadius:10,background:"linear-gradient(135deg,#5254d4,#7c3aed)",border:"none",color:"#fff",fontWeight:800,fontSize:12,cursor:"pointer",boxShadow:"0 4px 14px rgba(99,102,241,0.38)",display:"flex",alignItems:"center",gap:6 }}>
              <Ic.Plus /> New App
            </button>
          </div>
        {/* Search */}
        <div style={{ marginBottom: 14, position: "relative" }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: T.muted, pointerEvents: "none", display: "flex" }}><Ic.Search /></span>
          <input type="text" placeholder="Search by App ID or name…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 40px", borderRadius: 10, background: T.card, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 13, outline: "none", transition: "border-color 0.15s" }}
            onFocus={e => e.target.style.borderColor = T.accent + "60"} onBlur={e => e.target.style.borderColor = T.borderLight} />
          {search && (<button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: T.border, border: "none", color: T.muted, cursor: "pointer", width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.X /></button>)}
        </div>

        {/* App List */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: T.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ color: T.accent }}><Ic.Loader /></div>
            <div style={{ fontSize: 13 }}>Loading apps…</div>
          </div>
        ) : filteredApps.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: T.muted, background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ color: T.border }}><Ic.Inbox /></div>
            <div style={{ fontSize: 13 }}>{search ? `No apps found for "${search}".` : 'No apps yet. Click "New App" to create one.'}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {filteredApps.map(app => (
              <AppCard key={app.appId} app={app} onEdit={setEditApp} onDelete={deleteApp} onToggle={toggleStatus} onLogoutAll={logoutAll} onCopyUrl={copyUrl} onResetApk={resetApk} copyMsg={copyMsg} deletingId={deletingId} togglingId={togglingId} logoutAllId={logoutAllId} resetApkId={resetApkId} />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showAllDevices && (
        <AllDevicesModal devices={allDevicesList} loading={allDevLoading} search={allDevSearch}
          onSearchChange={setAllDevSearch} onClose={() => setShowAllDevices(false)}
          onRefresh={() => void openAllDevices(true)} />
      )}
      {showCreate && (<CreateAppModal masterPin={masterPin} onClose={() => setShowCreate(false)} onCreated={a => { setAppList(prev => [a, ...prev]); setShowCreate(false); }} />)}
      {showChangePin && (<ChangePinModal masterPin={masterPin} onClose={() => setShowChangePin(false)} onChanged={p => { onPinChanged(p); setShowChangePin(false); }} />)}
      {editApp && (<EditAppModal app={editApp} masterPin={masterPin} onClose={() => setEditApp(null)} onUpdated={a => { setAppList(prev => prev.map(x => x.appId === a.appId ? a : x)); setEditApp(null); }} />)}

      {/* ── Bottom Nav (mobile only) ── */}
          <div className="ma-bottom-nav">
            <button className="ma-bnav-item ma-btn" onClick={() => void openAllDevices()} title="Devices">
              <Ic.Smartphone />
              <span className="ma-bnav-lbl">Devices</span>
            </button>
            <div className="ma-fab-wrap">
              <button className="ma-fab" onClick={() => setShowCreate(true)} title="New App"><Ic.Plus /></button>
              <span className="ma-bnav-lbl" style={{ color:"#818cf8" }}>New App</span>
            </div>
            <button className="ma-bnav-item ma-btn" onClick={onLogout} title="Logout">
              <Ic.LogOut />
              <span className="ma-bnav-lbl">Logout</span>
            </button>
          </div>
    </div>
  );
}

/* ─────────── Root Export ─────────── */
export default function MainAdminPanel() {
  const [masterPin, setMasterPin] = useState<string | null>(() => sessionStorage.getItem("mrrobot_master_auth") ?? null);
  function handleAuth(pin: string) { sessionStorage.setItem("mrrobot_master_auth", pin); setMasterPin(pin); }
  function handleLogout() { sessionStorage.removeItem("mrrobot_master_auth"); setMasterPin(null); }
  function handlePinChanged(newPin: string) { sessionStorage.setItem("mrrobot_master_auth", newPin); setMasterPin(newPin); alert("Master PIN changed successfully!"); }
  if (!masterPin) return <MasterLogin onAuth={handleAuth} />;
  return <Dashboard masterPin={masterPin} onLogout={handleLogout} onPinChanged={handlePinChanged} />;
}
