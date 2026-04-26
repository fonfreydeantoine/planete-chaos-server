/* ============================================================
   PLANÈTE CHAOS — world.js
   Moteur de simulation — tourne côté serveur Railway
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
const MAX_CREATURES = 300;
const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 800;

// ============================================================
// UTILITAIRES
// ============================================================
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

// ============================================================
// GÈNES
// ============================================================
function randomGenes(rng) {
  return {
    size: 2.5 + rng() * 5,
    speed: 0.25 + rng() * 1.2,
    instability: 0.05 + rng() * 0.35,
    metabolism: 0.6 + rng() * 0.9,
    reproThreshold: 70 + rng() * 50,
    baseEnergy: 80 + rng() * 60,
    maxAge: 2000 + rng() * 3000,
    fertility: 0.8 + rng() * 1.2,
    hue: rng() * 360,
    saturation: rng(),
    lightness: rng(),
    limbCount: 2 + Math.floor(rng() * 3),
    limbLength: 6 + rng() * 18,
    limbSpeed: 0.6 + rng() * 1.4,
  };
}

function mutateGenes(g, rng) {
  const m = (base, delta, min, max) => clamp(base + (rng() - 0.5) * delta * 2, min, max);
  return {
    size: m(g.size, 0.6, 1.5, 12),
    speed: m(g.speed, 0.15, 0.15, 2.2),
    instability: m(g.instability, 0.04, 0, 0.6),
    metabolism: m(g.metabolism, 0.12, 0.3, 2.0),
    reproThreshold: m(g.reproThreshold, 12, 50, 160),
    baseEnergy: m(g.baseEnergy, 8, 60, 160),
    maxAge: m(g.maxAge, 300, 800, 6000),
    fertility: m(g.fertility, 0.2, 0.3, 2.5),
    hue: (g.hue + (rng() - 0.5) * 30 + 360) % 360,
    saturation: clamp(g.saturation + (rng() - 0.5) * 0.15, 0, 1),
    lightness: clamp(g.lightness + (rng() - 0.5) * 0.15, 0, 1),
    limbCount: rng() < 0.05 ? clamp(g.limbCount + (rng() < 0.5 ? 1 : -1), 2, 4) : g.limbCount,
    limbLength: m(g.limbLength, 3, 4, 30),
    limbSpeed: m(g.limbSpeed, 0.2, 0.3, 2.5),
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
    this.birthTick = birthTick;
    this.age = 0;
    this.energy = genes.baseEnergy;
    this.angle = rng() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.descendants = 0;
    this.dead = false;
    this.deathTick = null;

    // Phases des membres (déterministes)
    this.limbPhases = [];
    for (let i = 0; i < genes.limbCount; i++) {
      this.limbPhases.push(rng() * Math.PI * 2);
    }
  }

  update(tick, rng) {
    if (this.dead) return null;

    this.age++;
    this.energy -= 0.012 * this.genes.metabolism;

    // Changement de direction
    if (tick % 40 === this.id % 40) {
      this.targetAngle += (rng() - 0.5) * this.genes.instability * 2.5;
    }
    this.angle = lerpAngle(this.angle, this.targetAngle, 0.06);

    this.x += Math.cos(this.angle) * this.genes.speed;
    this.y += Math.sin(this.angle) * this.genes.speed;

    // Rebonds sur les bords
    const margin = 50;
    if (this.x < margin) this.targetAngle = (rng() - 0.5) * Math.PI * 0.5;
    if (this.x > WORLD_WIDTH - margin) this.targetAngle = Math.PI + (rng() - 0.5) * 0.5;
    if (this.y < margin) this.targetAngle = Math.PI / 2 + (rng() - 0.5) * 0.5;
    if (this.y > WORLD_HEIGHT - margin) this.targetAngle = -Math.PI / 2 + (rng() - 0.5) * 0.5;

    this.x = clamp(this.x, 2, WORLD_WIDTH - 2);
    this.y = clamp(this.y, 2, WORLD_HEIGHT - 2);

    // Mort naturelle
    if (this.energy <= 0 || this.age > this.genes.maxAge) {
      this.dead = true;
      this.deathTick = tick;
      return null;
    }

    // Reproduction
    if (
      this.energy > this.genes.reproThreshold &&
      this.age > 80 &&
      rng() < 0.0018 * this.genes.fertility
    ) {
      this.energy *= 0.55;
      this.descendants++;
      return "reproduce";
    }

    return null;
  }

  // Sérialisation compacte pour envoi aux clients
  serialize() {
    return {
      id: this.id,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      angle: Math.round(this.angle * 100) / 100,
      age: this.age,
      generation: this.generation,
      descendants: this.descendants,
      energy: Math.round(this.energy),
      genes: this.genes,
      limbPhases: this.limbPhases,
      dead: this.dead,
      deathTick: this.deathTick,
    };
  }

  getTraits() {
    const traits = [];
    if (this.genes.speed > 1.2) traits.push("rapide");
    else if (this.genes.speed < 0.5) traits.push("lente");
    if (this.genes.size > 7) traits.push("massive");
    else if (this.genes.size < 3) traits.push("minuscule");
    if (this.genes.metabolism < 0.7) traits.push("économe");
    else if (this.genes.metabolism > 1.4) traits.push("vorace");
    if (this.genes.fertility > 1.4) traits.push("prolifique");
    if (traits.length === 0) traits.push("équilibrée");
    return traits;
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
  }

  // Initialisation depuis zéro
  init() {
    const initRng = mulberry32(hashStr(WORLD_SEED + "-init"));
    const count = 50 + Math.floor(initRng() * 20);

    for (let i = 0; i < count; i++) {
      const x = 80 + initRng() * (WORLD_WIDTH - 160);
      const y = 80 + initRng() * (WORLD_HEIGHT - 160);
      const genes = randomGenes(initRng);
      this.creatures.push(new Creature(
        this.nextId++, x, y, genes, 0, null, initRng, 0
      ));
      this.totalBorn++;
    }

    console.log(`Monde initialisé avec ${this.creatures.length} créatures`);
  }

  // Un tick de simulation
  step() {
    this.tick++;
    const newBorns = [];

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c.dead) continue;

      const result = c.update(this.tick, this.simRng);

      if (result === "reproduce") {
        const childGenes = mutateGenes(c.genes, this.simRng);
        const child = new Creature(
          this.nextId++,
          c.x + (this.simRng() - 0.5) * 10,
          c.y + (this.simRng() - 0.5) * 10,
          childGenes,
          c.generation + 1,
          c.id,
          this.simRng,
          this.tick
        );
        newBorns.push(child);
        this.totalBorn++;
      }
    }

    this.creatures.push(...newBorns);

    // Nettoyer les morts (garder un tick pour l'animation côté client)
    this.creatures = this.creatures.filter(c => {
      if (c.dead && this.tick - c.deathTick > 60) {
        this.totalDead++;
        return false;
      }
      return true;
    });

    // Régulation : tuer les plus vieilles si surpopulation
    if (this.creatures.length > MAX_CREATURES) {
      const living = this.creatures.filter(c => !c.dead);
      living.sort((a, b) => b.age - a.age);
      const toKill = living.slice(0, Math.floor(living.length * 0.12));
      toKill.forEach(c => {
        c.dead = true;
        c.deathTick = this.tick;
      });
    }
  }

  // Sérialisation pour sauvegarde disque
  save() {
    return {
      tick: this.tick,
      nextId: this.nextId,
      totalBorn: this.totalBorn,
      totalDead: this.totalDead,
      simRngState: null, // RNG recalculé depuis tick au chargement
      creatures: this.creatures.map(c => c.serialize()),
    };
  }

  // Restauration depuis sauvegarde
  load(data) {
    this.tick = data.tick;
    this.nextId = data.nextId;
    this.totalBorn = data.totalBorn ?? 0;
    this.totalDead = data.totalDead ?? 0;

    // Recréer le RNG à l'état correspondant au tick sauvegardé
    // On avance le RNG de tick * 3 appels (approximation stable)
    this.simRng = mulberry32(hashStr(WORLD_SEED + "-sim-" + this.tick));

    this.creatures = data.creatures.map(d => {
      const c = new Creature(
        d.id, d.x, d.y, d.genes, d.generation, d.parentId,
        mulberry32(hashStr("limb-" + d.id)), d.birthTick
      );
      c.age = d.age;
      c.energy = d.energy;
      c.angle = d.angle;
      c.targetAngle = d.angle;
      c.descendants = d.descendants;
      c.dead = d.dead;
      c.deathTick = d.deathTick;
      c.limbPhases = d.limbPhases;
      return c;
    });

    console.log(`Monde restauré : tick ${this.tick}, ${this.creatures.filter(c => !c.dead).length} créatures vivantes`);
  }

  // Snapshot pour envoi aux clients
  snapshot() {
    return {
      tick: this.tick,
      worldBirth: WORLD_BIRTH,
      totalBorn: this.totalBorn,
      creatures: this.creatures.map(c => c.serialize()),
    };
  }

  livingCount() {
    return this.creatures.filter(c => !c.dead).length;
  }
}
