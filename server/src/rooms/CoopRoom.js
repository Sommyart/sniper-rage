/* One co-op match.

   The room is the thin layer between sockets and the simulation: it admits
   players, turns their messages into calls on the simulation, and turns the
   simulation's events back into messages. It makes no gameplay decisions of
   its own. */
const { Room } = require("colyseus");
const config = require("../config");
const { RoomState } = require("../state");
const { Simulation } = require("../sim/simulation");
const { cleanName, uniqueName, roomCode } = require("../identity");

const CODES = "sniper-rage:codes";
const MSG_PER_SECOND = 90;             // far above honest play, far below a flood

class CoopRoom extends Room {
  async onCreate(options) {
    // a short code people can read out, checked for collisions
    let code = roomCode();
    for (let i = 0; i < 20 && await this.presence.sismember(CODES, code); i++) code = roomCode();
    await this.presence.sadd(CODES, code);
    this.roomId = code;

    this.maxClients = config.maxPlayers;
    this.setState(new RoomState());
    const s = this.state;
    s.code = code; s.phase = "lobby"; s.hostId = ""; s.maxPlayers = config.maxPlayers;
    s.isPublic = !(options && options.private);
    s.wave = 0; s.waveState = "idle"; s.remaining = 0; s.countdown = 0; s.sector = 0;
    s.score = 0; s.credits = 0; s.kills = 0; s.headshots = 0;
    // a private room is reachable by its code and never offered to matchmaking
    if (!s.isPublic) await this.setPrivate(true);

    this.sim = new Simulation(s, {
      broadcast: (type, msg, exceptSid) => {
        if (exceptSid) { const c = this.clients.getById(exceptSid); this.broadcast(type, msg, c ? { except: c } : undefined); }
        else this.broadcast(type, msg);
      },
      send: (sid, type, msg) => { const c = this.clients.getById(sid); if (c) c.send(type, msg); }
    });
    this.budget = new Map();

    this.setPatchRate(1000 / config.patchHz);
    this.setSimulationInterval(ms => this.sim.tick(Math.min(.1, ms / 1000)), 1000 / config.tickHz);

    const on = (type, fn) => this.onMessage(type, (client, msg) => {
      if (!this.allow(client)) return;
      try { fn(client, msg); } catch (err) { console.error("[" + code + "] " + type + " failed:", err.message); }
    });
    const sim = this.sim;
    const isHost = c => s.hostId === c.sessionId;

    on("m", (c, m) => { if (Array.isArray(m)) sim.move(c.sessionId, +m[0], +m[1], +m[2], +m[3], m[4] | 0, Date.now()); });
    on("s", (c, m) => sim.shoot(c.sessionId, m, Date.now()));
    on("r", c => sim.reload(c.sessionId));
    on("w", (c, m) => sim.switchWeapon(c.sessionId, m | 0));
    on("gt", (c, m) => sim.throwNade(c.sessionId, m, Date.now()));
    on("gb", (c, m) => sim.burstNade(c.sessionId, m, Date.now()));
    on("rv", (c, m) => sim.setReviving(c.sessionId, typeof m === "string" ? m : ""));

    // heartbeat: the client times the round trip and reports it back
    on("ping", (c, m) => {
      const p = s.players.get(c.sessionId);
      if (p && Array.isArray(m) && Number.isFinite(m[1])) p.ping = Math.max(0, Math.min(9999, m[1] | 0));
      c.send("pong", Array.isArray(m) ? m[0] : 0);
    });

    on("start", c => { if (isHost(c) && s.phase === "lobby") { sim.startGame(); this.lockIfFull(); } });
    on("again", c => { if (isHost(c) && s.phase === "over") sim.startGame(); });
    on("lobby", c => { if (isHost(c) && s.phase === "over") sim.backToLobby(); });
    on("public", (c, m) => { if (isHost(c) && s.phase === "lobby") { s.isPublic = !!m; this.setPrivate(!m); } });

    console.log("[" + code + "] room created (" + (s.isPublic ? "public" : "private") + ")");
  }

  allow(client) {
    const now = Date.now();
    let b = this.budget.get(client.sessionId);
    if (!b || now - b.t > 1000) { b = { t: now, n: 0 }; this.budget.set(client.sessionId, b); }
    return ++b.n <= MSG_PER_SECOND;
  }

  lockIfFull() { if (this.clients.length >= this.maxClients) this.lock(); }

  onJoin(client, options) {
    const taken = new Set(); this.state.players.forEach(p => taken.add(p.name));
    const name = uniqueName(cleanName(options && options.name), taken);
    this.sim.addPlayer(client.sessionId, {
      name,
      unlocked: options && options.unlocked,
      weapon: options && options.weapon
    });
    console.log("[" + this.roomId + "] " + name + " joined (" + this.clients.length + "/" + this.maxClients + ")");
  }

  async onLeave(client, consented) {
    const p = this.state.players.get(client.sessionId);
    const name = p ? p.name : client.sessionId;
    if (consented) {
      this.sim.removePlayer(client.sessionId);
      console.log("[" + this.roomId + "] " + name + " left");
      return;
    }
    // dropped, not quit: hold the seat and everything that goes with it
    this.sim.setConnected(client.sessionId, false);
    console.log("[" + this.roomId + "] " + name + " lost connection, holding the seat for " + config.reconnectSeconds + "s");
    try {
      await this.allowReconnection(client, config.reconnectSeconds);
      this.sim.setConnected(client.sessionId, true);
      console.log("[" + this.roomId + "] " + name + " reconnected");
    } catch (e) {
      this.sim.removePlayer(client.sessionId);
      console.log("[" + this.roomId + "] " + name + " did not come back");
    }
  }

  onDispose() {
    this.presence.srem(CODES, this.roomId);
    console.log("[" + this.roomId + "] room closed");
  }
}

module.exports = { CoopRoom };
