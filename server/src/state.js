/* Shared game state.

   This is the part of the world every client is entitled to know, and nothing
   else. Colyseus tracks changes to these fields and sends only the deltas at
   the patch rate, so a player who stands still costs nothing and an enemy that
   walks costs three floats, not a full snapshot. One-off events (a shot, a
   kill, an explosion) are not state and travel as small messages instead. */
const { schema, MapSchema } = require("@colyseus/schema");

/* player.life */
const LIFE = { ALIVE: 0, DOWNED: 1, DEAD: 2 };
/* enemy.st */
const EST = { ADVANCE: 0, COVER: 1, PEEK: 2, FIRE: 3, DEAD: 4 };
const ETYPE_KEYS = ["basic", "armored", "elite", "heavy"];

const PlayerState = schema({
  name: "string",
  slot: "uint8",            // 0..n, picks the teammate colour and the spawn spot
  connected: "boolean",
  ping: "uint16",           // ms, measured by the heartbeat

  x: "float32", y: "float32", z: "float32",
  yaw: "float32", pitch: "float32",
  moving: "boolean",
  steady: "boolean",        // shift held: slow, braced walk, shown as a crouch
  ads: "boolean",

  hp: "int16",
  life: "uint8",            // LIFE
  bleed: "uint8",           // seconds left before a downed player dies
  revive: "uint8",          // 0..100 progress of the revive being done ON this player
  reviving: "string",       // sessionId this player is reviving, or ""

  weapon: "uint8",
  ammo: "uint8",
  reloading: "boolean",
  nades: "uint8",
  shots: "uint16",          // bumps on every shot, so teammates can animate it

  kills: "uint16",
  headshots: "uint16"
});

const EnemyState = schema({
  type: "uint8",            // index into ETYPE_KEYS
  x: "float32", y: "float32", z: "float32",
  st: "uint8",              // EST
  hp: "int16",
  maxHp: "int16",
  target: "string"          // sessionId of the player it is hunting
});

const RoomState = schema({
  code: "string",
  phase: "string",          // lobby | play | over
  hostId: "string",
  maxPlayers: "uint8",
  isPublic: "boolean",

  wave: "uint16",
  waveState: "string",      // idle | spawning | intermission
  remaining: "uint16",
  countdown: "uint8",       // seconds to the next wave during an intermission
  sector: "uint8",

  score: "uint32",
  credits: "uint32",
  kills: "uint32",
  headshots: "uint32",

  players: { map: PlayerState },
  enemies: { map: EnemyState }
});

module.exports = { PlayerState, EnemyState, RoomState, MapSchema, LIFE, EST, ETYPE_KEYS };
