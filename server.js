import express from "express";
import cors from "cors";
import pino from "pino";
import fetch from "node-fetch";

const app = express();
const log = pino({ level: "info" });

app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 10000;

// ===== Helpers =====
function mask(s = "", keepStart = 6, keepEnd = 4) {
  if (!s) return "";
  if (s.length <= keepStart + keepEnd) return `${s.slice(0, 2)}...${s.slice(-2)}`;
  return `${s.slice(0, keepStart)}...${s.slice(-keepEnd)}`;
}

function parseAllowedTokens() {
  // Aceita tokens separados por vírgula, espaço, quebra de linha, ponto e vírgula
  const raw = (process.env.APP_TOKENS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function extractBearerToken(authHeader = "") {
  // Aceita "Bearer xxx" (qualquer caixa) e também com espaços extras
  const s = String(authHeader || "").trim();
  if (!s) return "";
  const m = s.match(/^bearer\s+(.+)$/i);
  if (!m) return "";
  return String(m[1] || "").trim();
}

function isAuthorized(req) {
  const authHeader = req.headers.authorization || "";
  const token = extractBearerToken(authHeader);
  const allowed = parseAllowedTokens();

  // Logs de diagnóstico (sem vazar segredo)
  log.info({
    msg: "auth_check",
    hasAuthHeader: Boolean(authHeader),
    authHeaderPrefix: authHeader ? authHeader.slice(0, 12) : "",
    receivedTokenMasked: mask(token),
    allowedCount: allowed.length,
    allowedMasked: allowed.slice(0, 3).map((t) => mask(t)),
  });

  if (!authHeader) return { ok: false, reason: "missing_authorization_header" };
  if (!token) return { ok: false, reason: "invalid_bearer_format" };
  if (allowed.length === 0) return { ok: false, reason: "server_has_no_APP_TOKENS" };

  const ok = allowed.includes(token);
  return ok ? { ok: true } : { ok: false, reason: "token_not_in_APP_TOKENS" };
}

// ===== Routes =====
app.get("/", (req, res) => {
  res.json({ ok: true, service: "api-localizacao", endpoints: ["/send-location"] });
});

app.post("/send-location", async (req, res) => {
  const auth = isAuthorized(req);
  if (!auth.ok) {
    return res.status(401).json({ error: "unauthorized", reason: auth.reason });
  }

  const { to, deviceId, lat, lon, mapsUrl } = req.body || {};

  if (!to) return res.status(400).json({ error: "missing_to" });
  if (lat == null || lon == null) return res.status(400).json({ error: "missing_lat_lon" });

  const BREVO_API_KEY = (process.env.BREVO_API_KEY || "").trim();
  const FROM_EMAIL = (process.env.FROM_EMAIL || "").trim() || "jaedernunes127@gmail.com";

  if (!BREVO_API_KEY) return res.status(500).json({ error: "missing_BREVO_API_KEY" });

  // Texto do email
  const subject = "Localização recebida";
  const text = [
    `Device: ${deviceId || "android"}`,
    `Lat: ${lat}`,
    `Lon: ${lon}`,
    mapsUrl ? `Maps: ${mapsUrl}` : "",
  ].filter(Boolean).join("\n");

  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: "LocalizacaoApp" },
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      log.error({ msg: "brevo_send_failed", status: r.status, data });
      return res.status(502).json({ error: "send_failed", provider: "brevo_api", status: r.status, detail: data });
    }

    return res.json({ ok: true, provider: "brevo_api", to, messageId: data?.messageId || null });
  } catch (e) {
    log.error({ msg: "brevo_exception", err: String(e) });
    return res.status(502).json({ error: "send_failed", provider: "brevo_api", detail: String(e) });
  }
});

app.listen(PORT, () => {
  log.info({ msg: "api_started", port: String(PORT) });
});

