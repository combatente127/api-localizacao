import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import pinoHttp from "pino-http";
import { z } from "zod";
import nodemailer from "nodemailer";
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

const tokens = (process.env.APP_TOKENS || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (!token || !tokens.includes(token)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

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
  if (entry.count > max) {
    return res.status(429).json({ error: "too_many_requests" });
  }
  next();
}

const payloadSchema = z.object({
  to: z.string().email(),
  deviceId: z.string().min(8).max(128),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  mapsUrl: z.string().url().optional(),
});

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,        // 465 = SSL direto; 587 = STARTTLS
    auth: { user, pass },
    requireTLS: true,            // força TLS
    tls: { rejectUnauthorized: false }
  });


  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    auth: { user, pass },
  });
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/send-location", ipLimiter, requireAuth, deviceLimiter, async (req, res) => {
  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_payload" });
  }

  const { to, deviceId, lat, lon, mapsUrl } = parsed.data;
  const url = mapsUrl || `https://maps.google.com/?q=${lat},${lon}`;

  const transporter = makeTransport();
  if (!transporter) {
    return res.status(500).json({ error: "smtp_not_configured" });
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  const subject = "Localização do dispositivo";
  const text =
    `DeviceId: ${deviceId}\nLatitude: ${lat}\nLongitude: ${lon}\nMapa: ${url}\n`;

    } catch (e) {
    console.error("SMTP ERROR:", e);
    return res.status(502).json({
      error: "send_failed",
      detail: String(e?.message || e),
    });
  }

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("API iniciada na porta", port);
});


