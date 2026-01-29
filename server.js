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

/** =========================
 *  Middlewares base
 *  ========================= */
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

/** =========================
 *  Auth (token rotacionável)
 *  ========================= */
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

/** =========================
 *  Rate limit
 *  ========================= */
const ipLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30, // 30 req/min por IP
  standardHeaders: true,
  legacyHeaders: false,
});

const deviceBucket = new Map();
// deviceId -> { resetAt, count }
function deviceLimiter(req, res, next) {
  const deviceId = req.body?.deviceId;
  if (!deviceId || typeof deviceId !== "string") return next();

  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minuto
  const max = 10; // 10 envios/min por device

  const entry = deviceBucket.get(deviceId);
  if (!entry || entry.resetAt <= now) {
    deviceBucket.set(deviceId, { resetAt: now + windowMs, count: 1 });
    return next();
  }

  entry.count += 1;
  if (entry.count > max) {
    return res.status(429).json({ error: "too_many_requests" });
  }
  return next();
}

/** =========================
 *  Validação de payload
 *  ========================= */
const payloadSchema = z.object({
  to: z.string().email(),
  deviceId: z.string().min(8).max(128),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  mapsUrl: z.string().url().optional(),
});

/** =========================
 *  SMTP (Brevo) robusto
 *  =========================
 *  Recomendado Brevo:
 *  - host: smtp-relay.brevo.com
 *  - porta: 587 (STARTTLS)
 *  - user: *******@smtp-brevo.com
 *  - pass: SMTP KEY gerada
 */
function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  return { host, port, user, pass };
}

function validateSmtpEnvOrThrow() {
  const { host, port, user, pass } = getSmtpConfig();
  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!port) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");

  if (missing.length) {
    const msg = `Faltando variáveis SMTP: ${missing.join(", ")}`;
    throw new Error(msg);
  }
}

function makeTransport() {
  const { host, port, user, pass } = getSmtpConfig();

  // 587 => STARTTLS (secure=false, requireTLS=true)
  // 465 => SSL direto (secure=true)
  const secure = port === 465;

  // Config robusta para evitar problema de TLS
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },

    // Força TLS quando porta 587 (STARTTLS)
    requireTLS: !secure,

    // Alguns ambientes podem ter chain TLS diferente; isso evita falha por CA.
    // Se quiser ser mais rígido depois, pode remover esta linha.
    tls: { rejectUnauthorized: false },

    // timeouts para não travar requisição
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

/** =========================
 *  Rotas
 *  ========================= */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "api-localizacao", hint: "use /health" });
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.post(
  "/send-location",
  ipLimiter,
  requireAuth,
  deviceLimiter,
  async (req, res) => {
    // 1) valida payload
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.info({ issues: parsed.error.issues }, "invalid_payload");
      return res.status(400).json({ error: "invalid_payload" });
    }

    const { to, deviceId, lat, lon, mapsUrl } = parsed.data;
    const url = mapsUrl || `https://maps.google.com/?q=${lat},${lon}`;

    // 2) valida env SMTP
    try {
      validateSmtpEnvOrThrow();
    } catch (e) {
      req.log.error({ err: String(e?.message || e) }, "smtp_env_missing");
      return res.status(500).json({ error: "smtp_not_configured" });
    }

    // 3) prepara e-mail
    const from = process.env.MAIL_FROM || process.env.SMTP_USER;
    const subject = "Localização do dispositivo";
    const text =
      `DeviceId: ${deviceId}\n` +
      `Latitude: ${lat}\n` +
      `Longitude: ${lon}\n` +
      `Mapa: ${url}\n`;

    // 4) envia
    try {
      const transporter = makeTransport();

      // Verificação rápida (opcional): conecta e autentica antes de enviar
      // Ajuda a identificar erro de auth/TLS claramente.
      await transporter.verify();

      const info = await transporter.sendMail({ from, to, subject, text });

      req.log.info(
        {
          to,
          from,
          deviceId,
          messageId: info?.messageId,
          response: info?.response,
        },
        "email_sent"
      );

      return res.json({ ok: true });
    } catch (e) {
      // Aqui vem a mensagem REAL do SMTP
      const detail = String(e?.message || e);
      req.log.error({ detail, err: e }, "send_failed");

      // Devolve detail para você diagnosticar (depois, em produção, dá pra esconder)
      return res.status(502).json({ error: "send_failed", detail });
    }
  }
);

/** =========================
 *  Start
 *  ========================= */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger.info({ port }, "api_started");
});
