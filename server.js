const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // se der erro, eu te digo como ajustar

const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 10000;

// ====== Rota raiz (para parar "Cannot GET /") ======
app.get("/", (req, res) => {
  res.json({ ok: true, service: "api-localizacao", endpoints: ["/send-location"] });
});

// ====== Helpers ======
function mask(s = "", keepStart = 6, keepEnd = 4) {
  if (!s) return "";
  if (s.length <= keepStart + keepEnd) return `${s.slice(0, 2)}...${s.slice(-2)}`;
  return `${s.slice(0, keepStart)}...${s.slice(-keepEnd)}`;
}

function parseAllowedTokens() {
  const raw = (process.env.APP_TOKENS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/g)
    .map((t) => t.trim())
    .filter(Boolean);
}

function extractBearerToken(authHeader = "") {
  const s = String(authHeader || "").trim();
  if (!s) return "";
  const m = s.match(/^bearer\s+(.+)$/i);
  if (!m) return "";
  return String(m[1] || "").trim();
}

// ====== Endpoint principal ======
app.post("/send-location", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = extractBearerToken(authHeader);
  const allowed = parseAllowedTokens();

  console.log("auth_check:", {
    hasAuthHeader: Boolean(authHeader),
    authPrefix: authHeader ? authHeader.slice(0, 12) : "",
    tokenMasked: mask(token),
    allowedCount: allowed.length,
    allowedMasked: allowed.slice(0, 3).map(mask),
  });

  if (!authHeader) return res.status(401).json({ error: "unauthorized", reason: "missing_authorization_header" });
  if (!token) return res.status(401).json({ error: "unauthorized", reason: "invalid_bearer_format" });
  if (allowed.length === 0) return res.status(401).json({ error: "unauthorized", reason: "server_has_no_APP_TOKENS" });
  if (!allowed.includes(token)) return res.status(401).json({ error: "unauthorized", reason: "token_not_in_APP_TOKENS" });

  const { to, deviceId, lat, lon, mapsUrl } = req.body || {};
  if (!to) return res.status(400).json({ error: "missing_to" });
  if (lat == null || lon == null) return res.status(400).json({ error: "missing_lat_lon" });

  const BREVO_API_KEY = (process.env.BREVO_API_KEY || "").trim();
  const FROM_EMAIL = (process.env.FROM_EMAIL || "").trim() || "jaedernunes127@gmail.com";
  if (!BREVO_API_KEY) return res.status(500).json({ error: "missing_BREVO_API_KEY" });

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
      console.log("brevo_send_failed:", { status: r.status, data });
      return res.status(502).json({ error: "send_failed", provider: "brevo_api", status: r.status, detail: data });
    }

    return res.json({ ok: true, provider: "brevo_api", to, messageId: data.messageId || null });
  } catch (e) {
    console.log("brevo_exception:", String(e));
    return res.status(502).json({ error: "send_failed", provider: "brevo_api", detail: String(e) });
  }
});

app.listen(PORT, () => {
  console.log("api_started", { port: String(PORT) });
});

