/* ============================================================
   PLANÈTE CHAOS — server.js
   Serveur WebSocket Railway
   Simule le monde en continu, diffuse aux clients connectés
   ============================================================ */

import { WebSocketServer, WebSocket } from "ws";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { World } from "./world.js";

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 8080;
const SAVE_FILE = "./world-save.json";
const SAVE_INTERVAL_MS = 30_000;      // sauvegarde toutes les 30s
const BROADCAST_INTERVAL_MS = 1_000;  // envoi aux clients toutes les secondes
const SIM_INTERVAL_MS = 50;           // 20 ticks/seconde

// ============================================================
// MONDE
// ============================================================
const world = new World();

if (existsSync(SAVE_FILE)) {
  try {
    const raw = readFileSync(SAVE_FILE, "utf-8");
    world.load(JSON.parse(raw));
    console.log("Sauvegarde chargée avec succès");
  } catch (e) {
    console.error("Erreur chargement sauvegarde, démarrage à zéro :", e.message);
    world.init();
  }
} else {
  console.log("Aucune sauvegarde trouvée, nouveau monde");
  world.init();
}

// ============================================================
// SERVEUR WEBSOCKET
// ============================================================
const wss = new WebSocketServer({ port: PORT });
console.log(`Serveur WebSocket démarré sur le port ${PORT}`);

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`Nouveau visiteur connecté (${ip}). Vivantes : ${world.livingCount()}`);

  // Envoyer l'état complet immédiatement à la connexion
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "snapshot",
      data: world.snapshot(),
    }));
  }

  ws.on("error", (err) => {
    console.error("Erreur WebSocket :", err.message);
  });

  ws.on("close", () => {
    console.log(`Visiteur déconnecté. Connectés : ${wss.clients.size}`);
  });
});

// ============================================================
// BOUCLE DE SIMULATION
// ============================================================
setInterval(() => {
  world.step();
}, SIM_INTERVAL_MS);

// ============================================================
// BROADCAST AUX CLIENTS
// ============================================================
setInterval(() => {
  if (wss.clients.size === 0) return;

  const msg = JSON.stringify({
    type: "snapshot",
    data: world.snapshot(),
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}, BROADCAST_INTERVAL_MS);

// ============================================================
// SAUVEGARDE PÉRIODIQUE
// ============================================================
setInterval(() => {
  try {
    writeFileSync(SAVE_FILE, JSON.stringify(world.save()), "utf-8");
    console.log(`Sauvegarde : tick ${world.tick}, ${world.livingCount()} créatures vivantes`);
  } catch (e) {
    console.error("Erreur sauvegarde :", e.message);
  }
}, SAVE_INTERVAL_MS);

// Sauvegarde propre à l'arrêt
process.on("SIGTERM", () => {
  console.log("Arrêt du serveur, sauvegarde finale...");
  try {
    writeFileSync(SAVE_FILE, JSON.stringify(world.save()), "utf-8");
    console.log("Sauvegarde finale OK");
  } catch (e) {
    console.error("Erreur sauvegarde finale :", e.message);
  }
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Interruption, sauvegarde...");
  try {
    writeFileSync(SAVE_FILE, JSON.stringify(world.save()), "utf-8");
  } catch (e) {}
  process.exit(0);
});
