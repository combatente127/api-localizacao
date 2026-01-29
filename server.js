import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import pinoHttp from "pino-http";
import { z } from "zod";
import crypto from "crypto";

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers["x-request-id"] || crypto.randomUUID(),
  })
);

// ===== Auth token =====
const tokens = (process.env.APP_TOKENS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (!token || !tokens.includes(token)) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ===== Rate limit =====
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const deviceBucket = new Map();
function deviceLimiter(req, res, next) {
  const deviceId = req.body?.deviceId;
  if (!deviceId || typeof deviceId !== "string") return next();

  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 10;

  const entry = deviceBucket.get(deviceId);
  if (!entry || entry.resetAt <= now) {
    deviceBucket.set(deviceId, { resetAt: now + windowMs, count: 1 });
    return next();
  }
  entry.count += 1;
  if (entry.count > max) return res.status(429).json({ error: "too_many_requests" });
  next();
}

// ===== Payload validation =====
const payloadSchema = z.object({
  to: z.string().email(),
  deviceId: z.string().min(8).max(128),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  mapsUrl: z.string().url().optional(),
});

// ===== Brevo API send =====
async function sendBrevoEmail({ fromEmail, fromName, toEmail, subject, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error("Missing BREVO_API_KEY");

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName || "API" },
      to: [{ email: toEmail }],
      subject,
      textContent: text,
    }),
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(`Brevo API ${resp.status}: ${bodyText}`);
  }
  return bodyText;
}

// ===== Routes =====
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/send-location", ipLimiter, requireAuth, deviceLimiter, async (req, res) => {
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.info({ issues: parsed.error.issues }, "invalid_payload");
    return res.status(400).json({ error: "invalid_payload" });
  }

  const { to, deviceId, lat, lon, mapsUrl } = parsed.data;
  const url = mapsUrl || `https://maps.google.com/?q=${lat},${lon}`;

  const fromEmail = process.env.MAIL_FROM;
  const fromName = process.env.MAIL_FROM_NAME || "API Localização";
  if (!fromEmail) return res.status(500).json({ error: "mail_from_not_configured" });

  const subject = "Localização do dispositivo";
  const text =
    `DeviceId: ${deviceId}\n` +
    `Latitude: ${lat}\n` +
    `Longitude: ${lon}\n` +
    `Mapa: ${url}\n`;

  try {
    const result = await sendBrevoEmail({
      fromEmail,
      fromName,
      toEmail: to,
      subject,
      text,
    });

    req.log.info({ to, deviceId }, "email_sent");
    return res.json({ ok: true, provider: "brevo_api" });
  } catch (e) {
    const detail = String(e?.message || e);
    req.log.error({ detail }, "send_failed");
    return res.status(502).json({ error: "send_failed", detail });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => logger.info({ port }, "api_started"));
