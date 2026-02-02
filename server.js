const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 10000;

// Rota raiz (para parar "Cannot GET /")
app.get("/", (req, res) => {
  res.json({ ok: true, service: "api-localizacao", endpoints: ["/send-location"] });
});

// Rota de teste do payload
app.post("/send-location", (req, res) => {
  console.log("HEADERS:", req.headers);
  console.log("BODY RECEBIDO:", req.body);

  // Se vier vazio, já avisa
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      error: "invalid_payload",
      reason: "body_vazio_ou_json_nao_chegou",
      hint: "confira Content-Type: application/json e o -d/--data",
    });
  }

  return res.json({ ok: true, body: req.body });
});

app.listen(PORT, () => {
  console.log("api_started", { port: String(PORT) });
});
