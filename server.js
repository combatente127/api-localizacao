const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.json({ ok: true, service: "api-localizacao", test: true });
});

app.post("/send-location", (req, res) => {
  console.log("BODY RECEBIDO:", req.body);

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({
      error: "invalid_payload",
      reason: "body_vazio",
    });
  }

  return res.json({
    ok: true,
    body: req.body,
  });
});

app.listen(PORT, () => {
  console.log("api_started", { port: PORT });
});
