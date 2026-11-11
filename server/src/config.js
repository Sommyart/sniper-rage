/* Everything an operator might want to change lives here and is read from the
   environment, so nothing about a deployment is baked into the code. Render
   sets PORT itself; the rest have defaults that suit a first deploy. */
const num = (v, d) => (v === undefined || v === "" || isNaN(+v) ? d : +v);

const config = {
  port: num(process.env.PORT, 2567),
  isProd: process.env.NODE_ENV === "production",

  /* Players per room. The spec asks for at least 8; raise MAX_PLAYERS to go
     higher without touching code. Enemy counts scale with the team. */
  maxPlayers: Math.max(1, Math.min(32, num(process.env.MAX_PLAYERS, 8))),

  /* Comma separated list of origins allowed to call the HTTP endpoints, for
     example "https://sniper-rage.vercel.app". Empty means any origin, which is
     fine for a game with no accounts and no cookies. */
  corsOrigins: (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),

  tickHz: num(process.env.TICK_HZ, 20),          // simulation rate
  patchHz: num(process.env.PATCH_HZ, 20),        // state delta broadcast rate
  reconnectSeconds: num(process.env.RECONNECT_SECONDS, 60),

  /* Co-op rules. */
  bleedoutSeconds: num(process.env.BLEEDOUT_SECONDS, 30),
  reviveSeconds: num(process.env.REVIVE_SECONDS, 3),
  reviveRange: 3.2,
  reviveHp: 40,
  waveReviveHp: 50,
  /* Each extra teammate adds this fraction of the solo enemy count to a wave. */
  enemiesPerExtraPlayer: num(process.env.ENEMIES_PER_EXTRA_PLAYER, 0.45),
  maxAliveCap: 26
};

module.exports = config;
