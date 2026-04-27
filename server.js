/* ============================================================
   PLANÈTE CHAOS — server.js
   Serveur WebSocket Railway
   Simule le monde en continu, diffuse aux clients connectés
   ============================================================ */
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { World } from "./world.js";

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 8080;
const SAVE_FILE = "./world-save.json";
const SAVE_FILE_BAK = "./world-save.bak.json";
const SAVE_INTERVAL_MS = 30_000;      // sauvegarde toutes les 30s
const BROADCAST_INTERVAL_MS = 1_000;  // envoi aux clients toutes les secondes
const SIM_INTERVAL_MS = 50;           // 20 ticks/seconde

// Seuil en dessous duquel une lignée de base est considérée éteinte
// (exprimé en fraction de la population totale)
const LINEAGE_EXTINCTION_THRESHOLD = 0.05; // 5%

const BASE_SPECIES_NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];

// ============================================================
// VÉRIFICATION DE L'ÉQUILIBRE D'UNE SAUVEGARDE
// Retourne true si toutes les lignées de base sont présentes
// au-dessus du seuil d'extinction. Retourne false si au moins
// une lignée est absente ou sous-représentée.
// ============================================================
function isSaveBalanced(saveData) {
  const living = saveData.creatures.filter(c => !c.dead);
  const total = living.length;
  if (total === 0) return false;

  const lineageCounts = {};
  BASE_SPECIES_NAMES.forEach(s => { lineageCounts[s] = 0; });

  living.forEach(c => {
    const g = c.genes;
    // Chercher la lignée dominante dans l'ordre de priorité
    let lineage = g.dominantLineage;
    if (!lineage || !BASE_SPECIES_NAMES.includes(lineage)) {
      const ps = g.parentSpecies;
      if (ps && ps.length > 0) {
        lineage = ps.find(s => BASE_SPECIES_NAMES.includes(s));
      }
    }
    if (!lineage || !BASE_SPECIES_NAMES.includes(lineage)) {
      lineage = BASE_SPECIES_NAMES.includes(g.speciesName) ? g.speciesName : null;
    }
    if (lineage) lineageCounts[lineage]++;
  });

  const threshold = total * LINEAGE_EXTINCTION_THRESHOLD;
  const extinct = BASE_SPECIES_NAMES.filter(s => lineageCounts[s] < threshold);

  if (extinct.length > 0) {
    console.log(`Lignées sous le seuil (${(LINEAGE_EXTINCTION_THRESHOLD * 100).toFixed(0)}%) : ${extinct.join(", ")}`);
    BASE_SPECIES_NAMES.forEach(s => {
      console.log(`  ${s.padEnd(10)} ${lineageCounts[s].toString().padStart(3)} individus (${(lineageCounts[s] / total * 100).toFixed(1)}%)`);
    });
    return false;
  }

  return true;
}

// ============================================================
// MONDE
// ============================================================
const world = new World();

if (existsSync(SAVE_FILE)) {
  try {
    const raw = readFileSync(SAVE_FILE, "utf-8");
    const saveData = JSON.parse(raw);

    if (isSaveBalanced(saveData)) {
      world.load(saveData);
      console.log("Sauvegarde chargée avec succès");
    } else {
      console.log("Sauvegarde déséquilibrée — archivage et démarrage d'un nouveau monde");
      renameSync(SAVE_FILE, SAVE_FILE_BAK);
      console.log(`Ancienne sauvegarde archivée dans ${SAVE_FILE_BAK}`);
      world.init();
    }
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
