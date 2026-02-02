const express = require("express");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
// COLOQUE SUA CHAVE DO RESEND ENTRE AS ASPAS ABAIXO
const resend = new Resend("re_EkbSUEWq_KGqwX9tGY3G1NYvcjteBfWis");

app.use(cors());
app.use(express.json({ limit: "64kb" }));

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.json({ ok: true, service: "api-localizacao" });
});

app.post("/send-location", async (req, res) => {
  console.log("DADOS RECEBIDOS:", req.body);

  const { lat, lon, deviceId, to } = req.body;

  try {
    // Envia o e-mail usando a API do Resend (permitido pelo Render)
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: to || "combatentedobem@hotmail.com",
      subject: `📍 Localização: ${deviceId || 'Dispositivo'}`,
      html: `
        <p><strong>Nova localização recebida:</strong></p>
        <p>Lat: ${lat}</p>
        <p>Lon: ${lon}</p>
        <p><a href="https://maps.google.com{lat},${lon}">Ver no Google Maps</a></p>
      `,
    });

    return res.json({ ok: true, message: "E-mail enviado com sucesso!" });
  } catch (error) {
    console.error("ERRO AO ENVIAR:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log("api_started", { port: PORT });
});

