import express from "express";
import {
  callCustomer,
  sendBaileysWhatsAppByTemplate,
  sendBaileysWhatsAppProperties,
  sendDirectWhatsAppMessage,
  sendEmailByTemplate,
  sendWhatsAppByTemplate,
  sendWhatsAppMessage,
} from "../controllers/controller.messages.js";
import { getWhatsAppConnectionState, getWhatsAppSocket, initWhatsApp, logoutWhatsApp, startPairingConnection, stopWhatsAppIdle } from "../config/baileys.js";
import { templateUpload } from "../config/multer.js";

const messageRoutes = express.Router();

messageRoutes.post("/email", sendEmailByTemplate);
messageRoutes.post("/whatsapp", sendBaileysWhatsAppByTemplate);
messageRoutes.post("/whatsapp/send-properties",sendBaileysWhatsAppProperties);
messageRoutes.post("/whatsapp/direct-message",templateUpload.fields([{ name: "whatsappFile", maxCount: 5 }]),sendDirectWhatsAppMessage);

messageRoutes.get('/whatsapp-connection-status', (req, res) => {
  // Just return the instant state. Socket.io handles waking it up now!
  const state = getWhatsAppConnectionState();
  res.json(state);
});

messageRoutes.post('/whatsapp-connection-logout', async (req, res) => {
  // Keep this! The UI button still calls it.
  const result = await logoutWhatsApp();
  res.json(result);
});

messageRoutes.post('/whatsapp-connection-pairing-code', async (req, res) => {
  const { phoneNumber } = req.body;
 
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return res.status(400).json({ success: false, error: 'phoneNumber is required' });
  }
 
  try {
    await startPairingConnection(phoneNumber);
    res.json({ success: true, message: 'Pairing requested — code will arrive via socket' });
  } catch (err) {
    console.error('Failed to start pairing connection:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});



messageRoutes.post("/call",callCustomer);

messageRoutes.all("/exotel/voice", (req, res) => {
  res.set("Content-Type", "text/xml");

  res.send(`
<Response>
<Say voice="women" language="en-IN">Hello, this is Adarsh from Creatikai Solutions. I am calling to understand your requirements.</Say>
</Response>
  `);
});

export default messageRoutes;
