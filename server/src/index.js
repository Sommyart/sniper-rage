/* Sniper Rage co-op server.

   A Node web service: WebSockets for the game, two small HTTP routes for
   humans and health checks. Deployable to Render as it stands. Render (and
   every other host) terminates TLS in front of this process, so the game
   connects with wss:// in production while this file only ever speaks plain
   ws:// to the proxy. */
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server, matchMaker } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const config = require("./config");
const { CoopRoom } = require("./rooms/CoopRoom");
const { normaliseCode } = require("./identity");
const world = require("./sim/world");

const app = express();
app.disable("x-powered-by");
app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : {}));

const started = Date.now();
app.get("/", (req, res) => res.json({
  service: "sniper-rage-server", status: "ok",
  maxPlayers: config.maxPlayers, sectors: world.SECTORS.length,
  uptimeSeconds: Math.round((Date.now() - started) / 1000)
}));
app.get("/health", (req, res) => res.type("text/plain").send("ok"));

/* Does a room with this code exist and have space? Lets the join screen say
   "no such room" or "room is full" before it opens a socket. */
app.get("/rooms/:code", async (req, res) => {
  const code = normaliseCode(req.params.code);
  try {
    const rooms = await matchMaker.query({ roomId: code });
    const r = rooms[0];
    if (!r) return res.status(404).json({ exists: false });
    res.json({ exists: true, players: r.clients, maxPlayers: r.maxClients, full: r.clients >= r.maxClients || !!r.locked });
  } catch (e) { res.status(500).json({ error: "lookup failed" }); }
});

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
    pingInterval: 4000,      // transport heartbeat: a dead socket is noticed in ~12s
    pingMaxRetries: 3,
    maxPayload: 16 * 1024
  })
});
gameServer.define("coop", CoopRoom);

gameServer.listen(config.port).then(() => {
  console.log("sniper-rage-server listening on :" + config.port +
    "  (" + (config.isProd ? "production" : "development") + ", " + config.maxPlayers + " players per room, " +
    config.tickHz + "Hz sim, " + config.patchHz + "Hz patches)");
});

// Render sends SIGTERM on every deploy: let rooms close cleanly
process.on("SIGTERM", () => { gameServer.gracefullyShutdown().finally(() => process.exit(0)); });
