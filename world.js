/* ============================================================
   PLANÈTE CHAOS — world.js v2
   Système d'espèces, hybrides, affinités, prédation
   Equilibre naturel sur le long terme
   ============================================================ */

// ============================================================
// RNG DÉTERMINISTE
// ============================================================
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ============================================================
// CONSTANTES
// ============================================================
export const WORLD_BIRTH = new Date("2026-04-26T14:16:00Z").getTime();
const WORLD_SEED = "planete-chaos-v1";
const MAX_CREATURES = 220;
const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 800;
const PREDATION_PROTECTION_THRESHOLD = 12;

// ============================================================
// ESPÈCES DE BASE
// ============================================================
const BASE_SPECIES = {
  Alpha: {
    name: "Alpha",
    hue: 200,
    size: [4, 7], speed: [0.2, 0.6], metabolism: [0.5, 0.8],
    limbCount: [3, 4], limbLength: [14, 22], maxAge: [3000, 5000],
    fertility: [0.8, 1.2], reproThreshold: [60, 90], baseEnergy: [90, 130],
    isPredator: false, preyOf: ["Gamma"],
  },
  Beta: {
    name: "Bêta",
    hue: 45,
    size: [2, 3.5], speed: [1.2, 2.0], metabolism: [1.0, 1.6],
    limbCount: [2, 2], limbLength: [8, 14], maxAge: [1200, 2500],
    fertility: [1.0, 1.6], reproThreshold: [55, 80], baseEnergy: [70, 100],
    isPredator: false, preyOf: ["Gamma"],
  },
  Gamma: {
    name: "Gamma",
    hue: 0,
    size: [7, 11], speed: [0.3, 0.7], metabolism: [1.2, 1.8],
    limbCount: [2, 3], limbLength: [18, 28], maxAge: [4000, 7000],
    fertility: [0.3, 0.6], reproThreshold: [100, 140], baseEnergy: [120, 180],
    isPredator: true, preyOf: [],
  },
  Delta: {
    name: "Delta",
    hue: 140,
    size: [1.5, 2.8], speed: [0.6, 1.2], metabolism: [0.6, 1.0],
    limbCount: [2, 3], limbLength: [5, 10], maxAge: [800, 1800],
    fertility: [1.4, 2.2], reproThreshold: [45, 65], baseEnergy: [60, 90],
    isPredator: false, preyOf: ["Gamma"],
  },
  Epsilon: {
    name: "Epsilon",
    hue: 280,
    size: [3, 5.5], speed: [0.5, 1.0], metabolism: [0.8, 1.2],
    limbCount: [2, 4], limbLength: [10, 18], maxAge: [2000, 4000],
    fertility: [0.8, 1.4], reproThreshold: [70, 100], baseEnergy: [80, 120],
    isPredator: false, preyOf: ["Gamma"],
  },
};

// ============================================================
// AFFINITÉS
// ============================================================
function generateAffinities(rng) {
  const species = Object.keys(BASE_SPECIES);
  const affinities = {};
  species.forEach(a => {
    affinities[a] = {};
    species.forEach(b => {
      affinities[a][b] = a === b ? 1.0 : (rng() * 2 - 1);
    });
  });
  ["Alpha", "Beta", "Delta", "Epsilon"].forEach(s => {
    affinities[s]["Gamma"] = -0.8 - rng() * 0.2;
    affinities["Gamma"][s] = 0.6 + rng() * 0.4;
  });
  return affinities;
}

// ============================================================
// UTILITAIRES
// ============================================================
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}
function rangePick(range, rng) { return range[0] + rng() * (range[1] - range[0]); }

// ============================================================
// GÈNES
// ============================================================
function genesFromSpecies(speciesName, rng) {
  const sp = BASE_SPECIES[speciesName];
  if (!sp) return genesFromSpecies("Epsilon", rng);
  return {
    speciesName,
    hue: sp.hue + (rng() - 0.5) * 25,
    saturation: 0.7 + rng() * 0.3,
    lightness: 0.5 + rng() * 0.3,
    size: rangePick(sp.size, rng),
    speed: rangePick(sp.speed, rng),
    instability: 0.05 + rng() * 0.3,
    metabolism: rangePick(sp.metabolism, rng),
    limbCount: Math.round(rangePick(sp.limbCount, rng)),
    limbLength: rangePick(sp.limbLength, rng),
    limbSpeed: 0.6 + rng() * 1.4,
    maxAge: rangePick(sp.maxAge, rng),
    fertility: rangePick(sp.fertility, rng),
    reproThreshold: rangePick(sp.reproThreshold, rng),
    baseEnergy: rangePick(sp.baseEnergy, rng),
    isPredator: sp.isPredator,
    preyOf: [...sp.preyOf],
    parentSpecies: [speciesName],
    hybridDepth: 0,
  };
}

function mutateGenes(g, rng, partnerGenes = null) {
  const m = (base, delta, min, max) => clamp(base + (rng() - 0.5) * delta * 2, min, max);
  let speciesName = g.speciesName;
  let hue = g.hue;
  let isPredator = g.isPredator;
  let preyOf = [...(g.preyOf ?? [])];
  let parentSpecies = [...(g.parentSpecies ?? [g.speciesName])];
  let hybridDepth = g.hybridDepth ?? 0;

  if (partnerGenes && partnerGenes.speciesName !== g.speciesName) {
    hybridDepth = Math.max(g.hybridDepth ?? 0, partnerGenes.hybridDepth ?? 0) + 1;
    const nameA = g.speciesName;
    const nameB = partnerGenes.speciesName;
    const halfA = nameA.slice(0, Math.ceil(nameA.length / 2));
    const halfB = nameB.slice(Math.floor(nameB.length / 2)).toLowerCase();
    speciesName = halfA + halfB;
    hue = lerp(g.hue, partnerGenes.hue, 0.5) + (rng() - 0.5) * 15;
    if (g.isPredator || partnerGenes.isPredator) isPredator = rng() < 0.3;
    preyOf = [...new Set([...preyOf, ...(partnerGenes.preyOf ?? [])])];
    parentSpecies = [...new Set([...parentSpecies, ...(partnerGenes.parentSpecies ?? [partnerGenes.speciesName])])];
  }

  const pg = partnerGenes;
  return {
    speciesName,
    hue: (hue + (rng() - 0.5) * 20 + 360) % 360,
    saturation: clamp(g.saturation + (rng() - 0.5) * 0.1, 0.4, 1),
    lightness: clamp(g.lightness + (rng() - 0.5) * 0.1, 0.3, 0.8),
    size: m(pg ? lerp(g.size, pg.size, rng()) : g.size, 0.5, 1.2, 13),
    speed: m(pg ? lerp(g.speed, pg.speed, rng()) : g.speed, 0.12, 0.1, 2.5),
    instability: m(g.instability, 0.03, 0, 0.5),
    metabolism: m(pg ? lerp(g.metabolism, pg.metabolism, rng()) : g.metabolism, 0.1, 0.3, 2.2),
    limbCount: clamp(Math.round((pg ? lerp(g.limbCount, pg.limbCount, rng()) : g.limbCount) + (rng() < 0.08 ? (rng() < 0.5 ? 1 : -1) : 0)), 2, 4),
    limbLength: m(pg ? lerp(g.limbLength, pg.limbLength, rng()) : g.limbLength, 2.5, 3, 32),
    limbSpeed: m(g.limbSpeed, 0.18, 0.2, 2.8),
    maxAge: m(pg ? lerp(g.maxAge, pg.maxAge, rng()) : g.maxAge, 250, 600, 8000),
    fertility: m(pg ? lerp(g.fertility, pg.fertility, rng()) : g.fertility, 0.15, 0.2, 2.8),
    reproThreshold: m(pg ? lerp(g.reproThreshold, pg.reproThreshold, rng()) : g.reproThreshold, 10, 40, 180),
    baseEnergy: m(pg ? lerp(g.baseEnergy, pg.baseEnergy, rng()) : g.baseEnergy, 7, 50, 200),
    isPredator,
    preyOf,
    parentSpecies,
    hybridDepth,
  };
}

// ============================================================
// CLASSE CREATURE
// ============================================================
class Creature {
  constructor(id, x, y, genes, generation, parentId, rng, birthTick) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.genes = genes;
    this.generation = generation;
    this.parentId = parentId ?? null;
    this.birthTick = birthTick ?? 0;
    this.age = 0;
    this.energy = genes.baseEnergy;
    this.angle = rng() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.descendants = 0;
    this.dead = false;
    this.deathTick = null;
    this.deathCause = null;
    this.predatorHue = null;
    this.limbPhases = [];
    for (let i = 0; i < genes.limbCount; i++) {
      this.limbPhases.push(rng() * Math.PI * 2);
    }
  }

  update(tick, rng, neighbors, affinities, speciesCounts) {
    if (this.dead) return null;

    this.age++;
    this.energy -= 0.012 * this.genes.metabolism;

    // Comportement social
    let socialX = 0, socialY = 0;
    let preyNearby = null;
    let closestPreyDist = Infinity;

    neighbors.forEach(n => {
      if (n.dead) return;
      const dx = n.x - this.x, dy = n.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2 || dist > 180) return;

      const myKey = BASE_SPECIES[this.genes.speciesName] ? this.genes.speciesName : (this.genes.parentSpecies?.[0] ?? "Epsilon");
      const theirKey = BASE_SPECIES[n.genes.speciesName] ? n.genes.speciesName : (n.genes.parentSpecies?.[0] ?? "Epsilon");
      let affinity = this.genes.speciesName === n.genes.speciesName ? 0.5 : (affinities[myKey]?.[theirKey] ?? 0);

      const force = affinity / (dist * 0.015);
      socialX += (dx / dist) * force;
      socialY += (dy / dist) * force;

      if (this.genes.isPredator && n.genes.preyOf?.includes(myKey)) {
        const preyCount = speciesCounts[n.genes.speciesName] ?? 0;
        if (preyCount > PREDATION_PROTECTION_THRESHOLD && dist < closestPreyDist) {
          closestPreyDist = dist;
          preyNearby = n;
        }
      }
    });

    if (socialX !== 0 || socialY !== 0) {
      const socialAngle = Math.atan2(socialY, socialX);
      const strength = Math.min(0.08, Math.sqrt(socialX * socialX + socialY * socialY) * 0.01);
      this.targetAngle = lerpAngle(this.targetAngle, socialAngle, strength);
    }

    if (preyNearby && closestPreyDist < 120) {
      const dx = preyNearby.x - this.x, dy = preyNearby.y - this.y;
      this.targetAngle = lerpAngle(this.targetAngle, Math.atan2(dy, dx), 0.15);
      if (closestPreyDist < this.genes.size + preyNearby.genes.size + 4) {
        preyNearby.dead = true;
        preyNearby.deathTick = tick;
        preyNearby.deathCause = "predation";
        preyNearby.predatorHue = this.genes.hue;
        this.energy = Math.min(this.energy + preyNearby.energy * 0.6, this.genes.baseEnergy * 1.5);
      }
    }

    if (tick % 35 === this.id % 35) {
      this.targetAngle += (rng() - 0.5) * this.genes.instability * 2.5;
    }
    this.angle = lerpAngle(this.angle, this.targetAngle, 0.06);
    this.x += Math.cos(this.angle) * this.genes.speed;
    this.y += Math.sin(this.angle) * this.genes.speed;

    const margin = 50;
    if (this.x < margin) this.targetAngle = (rng() - 0.5) * Math.PI * 0.5;
    if (this.x > WORLD_WIDTH - margin) this.targetAngle = Math.PI + (rng() - 0.5) * 0.5;
    if (this.y < margin) this.targetAngle = Math.PI / 2 + (rng() - 0.5) * 0.5;
    if (this.y > WORLD_HEIGHT - margin) this.targetAngle = -Math.PI / 2 + (rng() - 0.5) * 0.5;

    this.x = clamp(this.x, 2, WORLD_WIDTH - 2);
    this.y = clamp(this.y, 2, WORLD_HEIGHT - 2);

    if (this.energy <= 0) { this.dead = true; this.deathTick = tick; this.deathCause = "energy"; return null; }
    if (this.age > this.genes.maxAge) { this.dead = true; this.deathTick = tick; this.deathCause = "age"; return null; }

    if (this.energy > this.genes.reproThreshold && this.age > 80 && rng() < 0.0018 * this.genes.fertility) {
      const partner = this._findPartner(neighbors, affinities, rng);
      this.energy *= 0.55;
      this.descendants++;
      return { type: "reproduce", partner };
    }

    return null;
  }

  _findPartner(neighbors, affinities, rng) {
    const candidates = neighbors.filter(n => {
      if (n.dead) return false;
      if (n.energy < n.genes.reproThreshold * 0.5) return false;
      const dx = n.x - this.x, dy = n.y - this.y;
      return Math.sqrt(dx * dx + dy * dy) < 80;
    });
    if (candidates.length === 0) return null;

    const myKey = BASE_SPECIES[this.genes.speciesName] ? this.genes.speciesName : (this.genes.parentSpecies?.[0] ?? "Epsilon");
    const weights = candidates.map(n => {
      if (this.genes.speciesName === n.genes.speciesName) return 3.0;
      const theirKey = BASE_SPECIES[n.genes.speciesName] ? n.genes.speciesName : (n.genes.parentSpecies?.[0] ?? "Epsilon");
      return Math.max(0.05, 0.5 + (affinities[myKey]?.[theirKey] ?? 0) * 0.5);
    });

    const total = weights.reduce((s, w) => s + w, 0);
    let r = rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[0];
  }

  serialize() {
    return {
      id: this.id, x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10,
      angle: Math.round(this.angle * 100) / 100, age: this.age, generation: this.generation,
      descendants: this.descendants, energy: Math.round(this.energy),
      genes: this.genes, limbPhases: this.limbPhases,
      dead: this.dead, deathTick: this.deathTick, deathCause: this.deathCause,
      predatorHue: this.predatorHue,
    };
  }

  getTraits() {
    const t = [];
    if (this.genes.isPredator) t.push("prédatrice");
    if (this.genes.speed > 1.2) t.push("rapide"); else if (this.genes.speed < 0.4) t.push("lente");
    if (this.genes.size > 8) t.push("massive"); else if (this.genes.size < 2.5) t.push("minuscule");
    if (this.genes.metabolism < 0.6) t.push("économe"); else if (this.genes.metabolism > 1.5) t.push("vorace");
    if (this.genes.fertility > 1.6) t.push("prolifique");
    if ((this.genes.hybridDepth ?? 0) > 0) t.push(`hybride (gen. ${this.genes.hybridDepth})`);
    if (t.length === 0) t.push("équilibrée");
    return t;
  }
}

// ============================================================
// MONDE
// ============================================================
export class World {
  constructor() {
    this.creatures = [];
    this.tick = 0;
    this.nextId = 1;
    this.simRng = mulberry32(hashStr(WORLD_SEED + "-sim"));
    this.totalBorn = 0;
    this.totalDead = 0;
    this.affinities = {};
    this.events = [];
  }

  init() {
    const affRng = mulberry32(hashStr(WORLD_SEED + "-affinities"));
    this.affinities = generateAffinities(affRng);
    const initRng = mulberry32(hashStr(WORLD_SEED + "-init"));
    const speciesNames = Object.keys(BASE_SPECIES);
    const countPerSpecies = 10 + Math.floor(initRng() * 5);

    speciesNames.forEach(sp => {
      for (let i = 0; i < countPerSpecies; i++) {
        const x = 80 + initRng() * (WORLD_WIDTH - 160);
        const y = 80 + initRng() * (WORLD_HEIGHT - 160);
        const genes = genesFromSpecies(sp, initRng);
        this.creatures.push(new Creature(this.nextId++, x, y, genes, 0, null, initRng, 0));
        this.totalBorn++;
      }
    });

    console.log(`Monde initialisé : ${this.creatures.length} créatures, 5 espèces`);
  }

  _countBySpecies() {
    const counts = {};
    this.creatures.forEach(c => {
      if (!c.dead) counts[c.genes.speciesName] = (counts[c.genes.speciesName] ?? 0) + 1;
    });
    return counts;
  }

  _getNeighbors(creature, radius = 200) {
    return this.creatures.filter(c => {
      if (c.id === creature.id || c.dead) return false;
      const dx = c.x - creature.x, dy = c.y - creature.y;
      return dx * dx + dy * dy < radius * radius;
    });
  }

  step() {
    this.tick++;
    const newBorns = [];
    const speciesCounts = this._countBySpecies();

    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i];
      if (c.dead) continue;
      const neighbors = this._getNeighbors(c);
      const result = c.update(this.tick, this.simRng, neighbors, this.affinities, speciesCounts);

      if (result?.type === "reproduce") {
        const childGenes = mutateGenes(c.genes, this.simRng, result.partner?.genes ?? null);
        const ox = (this.simRng() - 0.5) * 12, oy = (this.simRng() - 0.5) * 12;
        const child = new Creature(
          this.nextId++,
          clamp(c.x + ox, 5, WORLD_WIDTH - 5),
          clamp(c.y + oy, 5, WORLD_HEIGHT - 5),
          childGenes, c.generation + 1, c.id, this.simRng, this.tick
        );
        newBorns.push(child);
        this.totalBorn++;

        if ((childGenes.hybridDepth ?? 0) === 1) {
          this.events.push({ tick: this.tick, type: "hybrid", message: `Nouvelle lignée ${childGenes.speciesName} apparue` });
        }
      }
    }

    this.creatures.push(...newBorns);

    this.creatures = this.creatures.filter(c => {
      if (c.dead && this.tick - c.deathTick > 80) { this.totalDead++; return false; }
      return true;
    });

    const livingCount = this.creatures.filter(c => !c.dead).length;
    if (livingCount > MAX_CREATURES) {
      const living = this.creatures.filter(c => !c.dead);
      living.sort((a, b) => b.age - a.age);
      living.slice(0, 3).forEach(c => { c.dead = true; c.deathTick = this.tick; c.deathCause = "age"; });
    }

    if (this.events.length > 20) this.events = this.events.slice(-20);
  }

  save() {
    return {
      tick: this.tick, nextId: this.nextId, totalBorn: this.totalBorn, totalDead: this.totalDead,
      affinities: this.affinities, events: this.events,
      creatures: this.creatures.map(c => c.serialize()),
    };
  }

  load(data) {
    this.tick = data.tick;
    this.nextId = data.nextId;
    this.totalBorn = data.totalBorn ?? 0;
    this.totalDead = data.totalDead ?? 0;
    this.affinities = data.affinities ?? generateAffinities(mulberry32(hashStr(WORLD_SEED + "-affinities")));
    this.events = data.events ?? [];
    this.simRng = mulberry32(hashStr(WORLD_SEED + "-sim-" + this.tick));

    this.creatures = data.creatures.map(d => {
      const c = new Creature(d.id, d.x, d.y, d.genes, d.generation, d.parentId,
        mulberry32(hashStr("limb-" + d.id)), d.birthTick ?? 0);
      c.age = d.age; c.energy = d.energy; c.angle = d.angle; c.targetAngle = d.angle;
      c.descendants = d.descendants; c.dead = d.dead; c.deathTick = d.deathTick;
      c.deathCause = d.deathCause ?? null; c.predatorHue = d.predatorHue ?? null;
      c.limbPhases = d.limbPhases ?? [];
      return c;
    });

    console.log(`Monde restauré : tick ${this.tick}, ${this.creatures.filter(c => !c.dead).length} créatures vivantes`);
  }

  snapshot() {
    return {
      tick: this.tick, worldBirth: WORLD_BIRTH,
      totalBorn: this.totalBorn, totalDead: this.totalDead,
      events: this.events.slice(-5),
      speciesCounts: this._countBySpecies(),
      creatures: this.creatures.map(c => c.serialize()),
    };
  }

  livingCount() { return this.creatures.filter(c => !c.dead).length; }
}
