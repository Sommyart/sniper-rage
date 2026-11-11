/* The authoritative simulation.

   Everything that decides an outcome happens here and only here: where the
   enemies are and what they are doing, whether a shot connected, how much it
   hurt, who is down, when a wave is over, what the score is. Clients send
   intent ("I moved here", "I fired along this line at that man") and this
   file decides what is true.

   It knows nothing about sockets. It is handed the shared state and three
   callbacks, which is what lets test/sim.test.js drive it directly. */
const W = require("./world");
const config = require("../config");
const { PlayerState, EnemyState, LIFE, EST, ETYPE_KEYS } = require("../state");

const C = W.constants;
const G = W.grenade;
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = a => a[Math.floor(Math.random() * a.length)];

const WALK_SPEED = 3.4;            // the client's top speed on the deck, m/s
const BODY_Y = 0.65, HEAD_Y = 1.48;
const WAVE_COUNTS = [5, 8, 12, 15, 20];

class Simulation {
  /* hooks: broadcast(type, msg, exceptSid), send(sid, type, msg) */
  constructor(state, hooks) {
    this.state = state;
    this.hooks = hooks;
    this.t = 0;                       // simulation clock, seconds
    this.P = new Map();               // sessionId -> private player record
    this.E = new Map();               // enemy id  -> private enemy record
    this.nextEnemyId = 1;
    this.queue = [];
    this.taken = new Map();           // cover index -> enemy id
    this.spawnT = 0; this.interval = 1.4; this.maxAlive = 6;
    this.interT = 0;
    this.stallT = 0; this.stallStage = 0;
    this.lastKillT = -9;
  }

  /* ------------------------------------------------------------ players */
  addPlayer(sid, opts) {
    const st = new PlayerState();
    const used = new Set(); this.state.players.forEach(p => used.add(p.slot));
    let slot = 0; while (used.has(slot)) slot++;
    st.name = opts.name; st.slot = slot; st.connected = true; st.ping = 0;
    st.yaw = 0; st.pitch = 0; st.moving = false; st.steady = false; st.ads = false;
    st.hp = 100; st.life = LIFE.ALIVE; st.bleed = 0; st.revive = 0; st.reviving = "";
    st.weapon = 0; st.ammo = W.weapons[0].mag; st.reloading = false;
    st.nades = G.start; st.shots = 0; st.kills = 0; st.headshots = 0;
    const sp = W.spawnPoint(this.state.sector, slot);
    st.x = sp.x; st.y = sp.y; st.z = sp.z;
    this.state.players.set(sid, st);

    /* The armory is saved in each player's own browser and there are no
       accounts, so which rifles a player owns is the one thing the server has
       to take on trust. It is bounded to real weapon ids and nothing else
       about a shot is taken on trust. */
    const unlocked = new Set([0]);
    if (Array.isArray(opts.unlocked))
      for (const i of opts.unlocked) if (Number.isInteger(i) && i >= 0 && i < W.weapons.length) unlocked.add(i);

    this.P.set(sid, {
      sid, st, hp: 100, unlocked,
      ammoBy: W.weapons.map(w => w.mag),
      lastMoveMs: 0, lastShotMs: 0, reloadEnd: 0,
      lastHitT: -99, invulnT: 0, lastKillT: -9,
      throws: [], bleedT: 0, reviveT: 0
    });
    if (opts.weapon !== undefined) this.switchWeapon(sid, opts.weapon | 0);
    if (!this.state.hostId) this.state.hostId = sid;
    return st;
  }

  removePlayer(sid) {
    this.P.delete(sid);
    this.state.players.delete(sid);
    this.state.players.forEach(p => { if (p.reviving === sid) p.reviving = ""; });
    if (this.state.hostId === sid) {
      this.state.hostId = "";
      this.state.players.forEach((p, id) => { if (!this.state.hostId && p.connected) this.state.hostId = id; });
      if (!this.state.hostId) this.state.players.forEach((p, id) => { if (!this.state.hostId) this.state.hostId = id; });
    }
    for (const e of this.E.values()) if (e.tgt === sid) this.retarget(e);
    this.checkEliminated();
  }

  setConnected(sid, on) {
    const p = this.P.get(sid); if (!p) return;
    p.st.connected = on;
    if (!on) {
      p.st.moving = false; p.st.reviving = "";
      for (const e of this.E.values()) if (e.tgt === sid) this.retarget(e);
      if (this.state.hostId === sid) {
        let next = "";
        this.state.players.forEach((q, id) => { if (!next && q.connected) next = id; });
        if (next) this.state.hostId = next;
      }
      this.checkEliminated();
    } else {
      p.lastMoveMs = 0;
    }
  }

  activePlayers() {
    const out = [];
    for (const p of this.P.values()) if (p.st.connected && p.st.life === LIFE.ALIVE) out.push(p);
    return out;
  }
  connectedCount() { let n = 0; for (const p of this.P.values()) if (p.st.connected) n++; return n; }

  /* ---------------------------------------------------------- game flow */
  startGame() {
    const s = this.state;
    this.clearEnemies();
    s.phase = "play"; s.score = 0; s.credits = 0; s.kills = 0; s.headshots = 0;
    s.wave = 0; s.sector = 0;
    for (const p of this.P.values()) {
      p.hp = 100; p.st.hp = 100; p.st.life = LIFE.ALIVE; p.st.bleed = 0; p.st.revive = 0; p.st.reviving = "";
      p.ammoBy = W.weapons.map(w => w.mag);
      p.st.ammo = W.weapons[p.st.weapon].mag; p.st.reloading = false; p.reloadEnd = 0;
      p.st.nades = G.start; p.st.kills = 0; p.st.headshots = 0; p.st.shots = 0;
      p.lastHitT = -99; p.invulnT = this.t + 2; p.lastKillT = -9; p.throws.length = 0;
    }
    this.lastKillT = -9;
    this.startWave(1);
  }

  backToLobby() {
    this.clearEnemies();
    this.state.phase = "lobby"; this.state.wave = 0; this.state.waveState = "idle";
    this.state.remaining = 0; this.state.countdown = 0;
  }

  clearEnemies() {
    this.E.clear(); this.taken.clear(); this.queue.length = 0;
    const ids = []; this.state.enemies.forEach((e, id) => ids.push(id));
    for (const id of ids) this.state.enemies.delete(id);
  }

  placePlayers() {
    for (const p of this.P.values()) {
      const sp = W.spawnPoint(this.state.sector, p.st.slot);
      p.st.x = sp.x; p.st.y = sp.y; p.st.z = sp.z; p.lastMoveMs = 0;
      this.hooks.send(p.sid, "corr", [sp.x, sp.z, 1]);
    }
  }

  waveCount(w) { return w <= 5 ? WAVE_COUNTS[w - 1] : 20 + (w - 5) * 4; }

  composition(w, team) {
    const sec = W.SECTORS[this.state.sector];
    const scale = 1 + config.enemiesPerExtraPlayer * Math.max(0, team - 1);
    const n = Math.round(this.waveCount(w) * scale);
    const weights =
      w <= 1 ? { basic: 1 } :
      w === 2 ? { basic: .85, armored: .15 } :
      w === 3 ? { basic: .68, armored: .32 } :
      w === 4 ? { basic: .54, armored: .31, elite: .15 } :
      w === 5 ? { basic: .44, armored: .31, elite: .25 } :
      w === 6 ? { basic: .34, armored: .3, elite: .21, heavy: .15 } :
      { basic: Math.max(.12, .34 - (w - 6) * .03), armored: .28, elite: Math.min(.36, .21 + (w - 6) * .02), heavy: Math.min(.28, .15 + (w - 6) * .015) };
    const keys = Object.keys(weights);
    let zones = sec.activeZones.slice();
    if (w <= 1) zones = zones.filter(z => z !== "second");
    if (!zones.length) zones = sec.activeZones.slice();
    if (!zones.length) zones = ["street"];
    let zi = Math.floor(Math.random() * zones.length);
    const list = [];
    let tot = 0; for (const k of keys) tot += weights[k];
    for (let i = 0; i < n; i++) {
      let r = Math.random() * tot, acc = 0, tk = "basic";
      for (const k of keys) { acc += weights[k]; if (r <= acc) { tk = k; break; } }
      list.push({ type: tk, zone: zones[zi % zones.length] }); zi++;
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
    return list;
  }

  startWave(w) {
    const s = this.state;
    const want = W.sectorForWave(w);
    const moved = want !== s.sector || w === 1;
    if (want !== s.sector) { this.clearEnemies(); s.sector = want; }
    if (moved) this.placePlayers();
    const team = Math.max(1, this.connectedCount());
    s.wave = w;
    this.queue = this.composition(w, team);
    this.spawnT = .6;
    this.interval = Math.max(.3, (1.55 - w * .06) / (1 + .3 * (team - 1)));
    this.maxAlive = Math.min(config.maxAliveCap, Math.round(Math.min(14, 4 + Math.floor(w * 1.2)) * (1 + .4 * (team - 1))));
    this.stallT = 0; this.stallStage = 0;
    s.waveState = "spawning"; s.countdown = 0;
    this.syncRemaining();
    this.hooks.broadcast("wave", [w, s.sector, this.queue.length ? this.queue[0].zone : "street"]);
  }

  syncRemaining() {
    let live = 0; for (const e of this.E.values()) if (e.alive) live++;
    this.state.remaining = this.queue.length + live;
  }

  /* ------------------------------------------------------------ enemies */
  spawnOne() {
    const item = this.queue.shift(); if (!item) return;
    const sec = W.SECTORS[this.state.sector];
    const def = W.etypes[item.type];
    const sp = pick(sec.spawns[item.zone] || sec.spawns.street);
    const w = this.state.wave;
    const id = this.nextEnemyId++;
    const st = new EnemyState();
    st.type = ETYPE_KEYS.indexOf(item.type);
    st.x = sp[0] + rand(-.7, .7); st.y = sp[1]; st.z = sp[2] + rand(-.7, .7);
    st.st = EST.ADVANCE;
    const maxHp = def.hp * (1 + (w - 1) * .085);
    st.hp = Math.round(maxHp); st.maxHp = Math.round(maxHp); st.target = "";
    const e = {
      id, st, def, type: item.type, zone: item.zone, baseY: sp[1],
      hp: maxHp, maxHp,
      speed: def.speed * Math.min(1.45, 1 + (w - 1) * .028),
      acc: Math.min(.9, def.acc * (1 + (w - 1) * .045)),
      aimTime: Math.max(.32, def.aim * (1 - (w - 1) * .035)),
      dmg: def.dmg * Math.min(1.7, 1 + (w - 1) * .05),
      state: "advance", stateT: 0, burstLeft: 0, burstT: 0,
      losT: rand(0, .3), los: false, noLos: 0, cover: -1,
      tgt: "", retargetT: rand(5, 9), alive: true, deadT: 0
    };
    this.E.set(id, e);
    this.state.enemies.set(String(id), st);
    this.retarget(e);
    this.pickCover(e, true);
  }

  retarget(e) {
    const act = this.activePlayers();
    if (!act.length) { e.tgt = ""; e.st.target = ""; return null; }
    // lean toward whoever is nearest, without every hostile piling onto one man
    let best = null, bestS = -1e9;
    for (const p of act) {
      const d = Math.hypot(p.st.x - e.st.x, p.st.z - e.st.z);
      const sc = -d * .15 + rand(0, 10);
      if (sc > bestS) { bestS = sc; best = p; }
    }
    e.tgt = best.sid; e.st.target = best.sid; e.retargetT = rand(6, 11);
    return best;
  }

  targetOf(e) {
    const p = e.tgt ? this.P.get(e.tgt) : null;
    if (p && p.st.connected && p.st.life === LIFE.ALIVE) return p;
    return this.retarget(e);
  }

  sees(e, p) {
    return !W.blocked(this.state.sector, e.st.x, e.baseY + 1.35, e.st.z, p.st.x, p.st.y, p.st.z, .4);
  }

  releaseCover(e) { if (e.cover >= 0 && this.taken.get(e.cover) === e.id) this.taken.delete(e.cover); e.cover = -1; }

  pickCover(e, initial, needLos) {
    const sec = W.SECTORS[this.state.sector];
    const tp = this.targetOf(e);
    const px = tp ? tp.st.x : sec.vantage.sx, pz = tp ? tp.st.z : sec.vantage.sz, py = sec.vantage.y;
    let best = -1, bestScore = -1e9, any = false;
    for (let pass = 0; pass < 2 && best < 0; pass++) {
      for (let i = 0; i < sec.cover.length; i++) {
        const c = sec.cover[i];
        if (c.zone !== e.zone || Math.abs(c.y - e.baseY) >= .6) continue;
        const holder = this.taken.get(i);
        if (holder !== undefined && holder !== e.id) continue;
        // first pass honours needLos, second pass takes anything rather than nothing
        if (needLos && pass === 0 && !c.los) continue;
        any = true;
        const dPlayer = Math.hypot(c.x - px, c.y - py, c.z - pz);
        const dSelf = Math.hypot(c.x - e.st.x, c.z - e.st.z);
        if (!initial && dSelf < 1.5) continue;
        let sc = (c.los ? 42 : 0) - dPlayer * .5 - dSelf * .35 + rand(0, 9);
        if (dPlayer < 7) sc -= 25;
        if (sc > bestScore) { bestScore = sc; best = i; }
      }
      if (!needLos) break;
    }
    this.releaseCover(e);
    if (best >= 0) { e.cover = best; this.taken.set(best, e.id); }
    return any;
  }

  /* Stall breaker: find a slot with a line of fire checked against where the
     target is standing right now, anywhere on the map, and walk there. */
  expose(e, hard) {
    const sec = W.SECTORS[this.state.sector];
    const tp = this.targetOf(e); if (!tp) return false;
    let best = -1, bestD = 1e9;
    for (let i = 0; i < sec.cover.length; i++) {
      const c = sec.cover[i];
      const holder = this.taken.get(i);
      if (holder !== undefined && holder !== e.id) continue;
      const d = Math.hypot(c.x - tp.st.x, c.y + 1.35 - tp.st.y, c.z - tp.st.z);
      if (hard && d > 52) continue;
      if (W.blocked(this.state.sector, c.x, c.y + 1.35, c.z, tp.st.x, tp.st.y, tp.st.z, .5)) continue;
      const dd = (c.x - e.st.x) ** 2 + (c.z - e.st.z) ** 2;
      if (dd < bestD) { bestD = dd; best = i; }
    }
    if (best < 0) return false;
    this.releaseCover(e);
    e.cover = best; this.taken.set(best, e.id);
    e.baseY = sec.cover[best].y; e.st.y = e.baseY; e.zone = sec.cover[best].zone;
    e.state = "advance"; e.stateT = 0; e.noLos = 0;
    return true;
  }

  enemyFire(e, tp) {
    const mx = e.st.x, my = e.baseY + 1.3, mz = e.st.z;
    const dist = Math.hypot(tp.st.x - mx, tp.st.y - my, tp.st.z - mz);
    const spread = (1 - e.acc) * 1.9 * (.55 + dist / 45);
    const ang = rand(0, 6.283), rad = Math.sqrt(Math.random()) * spread;
    // offset in the plane facing the shooter: "right" is level, "up" is world up
    let fx = tp.st.x - mx, fz = tp.st.z - mz; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;
    const ox = rx * Math.cos(ang) * rad, oy = Math.sin(ang) * rad, oz = rz * Math.cos(ang) * rad;
    const hit = rad < .58 && this.t >= tp.invulnT;
    this.hooks.broadcast("ef", [e.id, tp.sid, +ox.toFixed(2), +oy.toFixed(2), +oz.toFixed(2), hit ? 1 : 0]);
    if (hit) this.hurtPlayer(tp, e.dmg, e.st.x, e.baseY, e.st.z);
  }

  updateEnemy(e, dt) {
    const sec = W.SECTORS[this.state.sector];
    if (!e.alive) {
      e.deadT += dt;
      if (e.deadT > 6.4) { this.E.delete(e.id); this.state.enemies.delete(String(e.id)); }
      return;
    }
    e.stateT -= dt;
    e.retargetT -= dt;
    if (e.retargetT <= 0) this.retarget(e);
    const tp = this.targetOf(e);

    e.losT -= dt;
    if (e.losT <= 0) { e.losT = .3 + Math.random() * .25; e.los = !!tp && this.sees(e, tp); }
    e.noLos = e.los ? 0 : e.noLos + dt;
    if (e.noLos > 6.5 && e.state !== "advance") { e.noLos = 0; this.pickCover(e, false, true); e.state = "advance"; }

    switch (e.state) {
      case "advance": {
        if (e.cover < 0) { this.pickCover(e); if (e.cover < 0) { e.state = "cover"; e.stateT = 1; break; } }
        const c = sec.cover[e.cover];
        const dx = c.x - e.st.x, dz = c.z - e.st.z, d = Math.hypot(dx, dz);
        if (d < .25) { e.state = "cover"; e.stateT = rand(e.def.cover[0], e.def.cover[1]) * .7; }
        else { const step = Math.min(d, e.speed * dt); e.st.x += dx / d * step; e.st.z += dz / d * step; }
        break;
      }
      case "cover":
        if (e.stateT <= 0) {
          if (e.los && Math.random() < .78) { e.state = "peek"; e.stateT = e.aimTime; }
          else { this.pickCover(e); e.state = "advance"; }
        }
        break;
      case "peek":
        if (e.stateT <= 0) { e.state = "fire"; e.burstLeft = randi(e.def.burst[0], e.def.burst[1]); e.burstT = 0; }
        break;
      case "fire":
        e.burstT -= dt;
        if (e.burstT <= 0) {
          if (e.los && tp) this.enemyFire(e, tp);
          e.burstLeft--;
          e.burstT = .16 + Math.random() * .14;
          if (e.burstLeft <= 0) {
            e.state = "cover"; e.stateT = rand(e.def.cover[0], e.def.cover[1]);
            if (Math.random() < .45) { this.pickCover(e); e.state = "advance"; }
          }
        }
        break;
    }
    const code = e.state === "advance" ? EST.ADVANCE : e.state === "cover" ? EST.COVER : e.state === "peek" ? EST.PEEK : EST.FIRE;
    if (e.st.st !== code) e.st.st = code;
  }

  damageEnemy(e, dealt, shooter, isHead, viaNade) {
    if (!e.alive) return false;
    e.hp -= dealt;
    e.st.hp = Math.max(0, Math.round(e.hp));
    if (e.hp > 0) {
      if (e.state === "peek" && Math.random() < .7) { e.state = "cover"; e.stateT = rand(.6, 1.4); }
      return false;
    }
    e.alive = false; e.state = "dead"; e.deadT = 0; e.st.st = EST.DEAD; e.st.hp = 0;
    this.releaseCover(e);
    this.onKill(e, shooter, isHead, viaNade);
    return true;
  }

  onKill(e, shooter, isHead, viaNade) {
    const s = this.state, def = e.def;
    let credits = def.credits, score = def.score, tags = 0;
    if (isHead) { credits = 200 + (def.credits - 100); score = 250 + (def.score - 100); tags |= 1; s.headshots++; }
    let dist = 0;
    if (shooter) {
      dist = Math.hypot(e.st.x - shooter.st.x, e.baseY + 1 - shooter.st.y, e.st.z - shooter.st.z);
      if (!viaNade && dist > C.LONG_SHOT_M) { score += 300; tags |= 2; }
      if (this.t - shooter.lastKillT < 1.6) { score += 150; credits += 50; tags |= 4; }
      shooter.lastKillT = this.t;
      shooter.st.kills++; if (isHead) shooter.st.headshots++;
    }
    if (e.type === "elite") tags |= 8;
    s.kills++; s.score += score; s.credits += credits;
    this.lastKillT = this.t; this.stallT = 0; this.stallStage = 0;
    this.syncRemaining();
    this.hooks.broadcast("kill", [e.id, shooter ? shooter.sid : "", tags, credits, score, Math.round(dist)]);
  }

  /* ------------------------------------------------------------- players */
  hurtPlayer(p, amount, fx, fy, fz) {
    if (p.st.life !== LIFE.ALIVE || this.state.phase !== "play") return;
    p.hp -= amount; p.lastHitT = this.t;
    p.st.hp = Math.max(0, Math.round(p.hp));
    this.hooks.send(p.sid, "hurt", [+amount.toFixed(1), +fx.toFixed(1), +fy.toFixed(1), +fz.toFixed(1)]);
    if (p.hp <= 0) this.downPlayer(p);
  }

  downPlayer(p) {
    p.hp = 0; p.st.hp = 0; p.st.life = LIFE.DOWNED;
    p.bleedT = config.bleedoutSeconds; p.st.bleed = Math.ceil(p.bleedT);
    p.reviveT = 0; p.st.revive = 0; p.st.reviving = ""; p.st.moving = false; p.st.ads = false;
    p.st.reloading = false; p.reloadEnd = 0;
    for (const e of this.E.values()) if (e.tgt === p.sid) this.retarget(e);
    this.hooks.broadcast("down", [p.sid]);
    this.checkEliminated();
  }

  revivePlayer(p, hp, bySid) {
    p.hp = hp; p.st.hp = hp; p.st.life = LIFE.ALIVE; p.st.bleed = 0; p.st.revive = 0;
    p.reviveT = 0; p.lastHitT = this.t; p.invulnT = this.t + 3;
    this.hooks.broadcast("revived", [p.sid, bySid || ""]);
  }

  /* The team is finished when nobody who is still connected is on their feet.
     A room everyone has dropped out of is left alone: it is not a defeat, and
     the simulation idles until someone comes back or the room is disposed. */
  checkEliminated() {
    if (this.state.phase !== "play") return false;
    let connected = 0, standing = 0;
    for (const p of this.P.values()) {
      if (!p.st.connected) continue;
      connected++;
      if (p.st.life === LIFE.ALIVE) standing++;
    }
    if (connected === 0 || standing > 0) return false;
    this.gameOver();
    return true;
  }

  gameOver() {
    const s = this.state;
    s.phase = "over"; s.waveState = "idle"; s.countdown = 0;
    const rows = [];
    for (const p of this.P.values()) rows.push([p.sid, p.st.name, p.st.kills, p.st.headshots]);
    this.hooks.broadcast("over", [s.wave, s.score, s.credits, s.kills, s.headshots, rows]);
    this.clearEnemies();
    s.remaining = 0;
  }

  /* "I am here now." Movement is predicted on the client so the controls feel
     instant, and checked here: stay on the deck, and no faster than a person
     can walk. A report that breaks either rule is pulled back and the client
     is told where it really is. */
  move(sid, x, z, yaw, pitch, flags, nowMs) {
    const p = this.P.get(sid); if (!p || this.state.phase !== "play") return;
    if (![x, z, yaw, pitch].every(Number.isFinite)) return;
    const st = p.st;
    st.yaw = yaw; st.pitch = clamp(pitch, -1.4, 1.1);
    if (st.life !== LIFE.ALIVE) { st.moving = false; return; }
    const v = W.SECTORS[this.state.sector].vantage;
    let nx = clamp(x, v.x0, v.x1), nz = clamp(z, v.z0, v.z1);
    let corrected = nx !== x || nz !== z;
    if (p.lastMoveMs) {
      const el = clamp((nowMs - p.lastMoveMs) / 1000, 0, 1);
      const allowed = WALK_SPEED * el * 1.6 + .6;
      const dx = nx - st.x, dz = nz - st.z, d = Math.hypot(dx, dz);
      if (d > allowed) { nx = st.x + dx / d * allowed; nz = st.z + dz / d * allowed; corrected = true; }
      st.moving = d > .02 * Math.max(1, el * 20);
    }
    p.lastMoveMs = nowMs;
    st.x = nx; st.z = nz; st.y = v.y + C.EYE;
    st.ads = !!(flags & 1); st.steady = !!(flags & 2);
    if (corrected) this.hooks.send(sid, "corr", [+nx.toFixed(2), +nz.toFixed(2), 0]);
  }

  switchWeapon(sid, idx) {
    const p = this.P.get(sid); if (!p) return false;
    if (!Number.isInteger(idx) || !p.unlocked.has(idx) || idx === p.st.weapon) return false;
    p.ammoBy[p.st.weapon] = p.st.ammo;
    p.st.weapon = idx; p.st.ammo = clamp(p.ammoBy[idx], 0, W.weapons[idx].mag);
    p.st.reloading = false; p.reloadEnd = 0;
    return true;
  }

  reload(sid) {
    const p = this.P.get(sid); if (!p || p.st.life !== LIFE.ALIVE) return;
    if (p.st.reloading || p.st.ammo >= W.weapons[p.st.weapon].mag) return;
    p.st.reloading = true; p.reloadEnd = this.t + C.RELOAD_TIME;
  }

  /* A shot. The client says where it fired from, along what line, and who it
     believes it hit. Nothing in that claim is believed without checking:
       - the shooter must be on their feet, with a round in the magazine, not
         mid reload, and not firing faster than the rifle cycles
       - the muzzle must be where the server has the shooter standing
       - the line must actually pass through the target as the server has him
       - there must be no wall between the two
     Only then is damage applied, from the server's own weapon table. */
  shoot(sid, m, nowMs) {
    const p = this.P.get(sid);
    if (!p || this.state.phase !== "play" || p.st.life !== LIFE.ALIVE) return "state";
    if (!Array.isArray(m) || m.length < 8 || !m.slice(0, 8).every(Number.isFinite)) return "malformed";
    const wpn = W.weapons[p.st.weapon];
    if (p.st.reloading) {
      // the client finished its own 3.0s a network delay before we did
      if (p.reloadEnd - this.t < .4) this.finishReload(p); else return "reloading";
    }
    if (p.st.ammo <= 0) return "empty";
    if (nowMs - p.lastShotMs < wpn.cycle * 1000 * .8) return "cycle";
    p.lastShotMs = nowMs;
    p.st.ammo--; p.ammoBy[p.st.weapon] = p.st.ammo; p.st.shots = (p.st.shots + 1) & 0xffff;
    if (p.st.ammo <= 0) { p.st.reloading = true; p.reloadEnd = this.t + C.RELOAD_TIME; }

    let [ox, oy, oz, dx, dy, dz] = m;
    const dl = Math.hypot(dx, dy, dz); if (dl < .5 || dl > 1.5) return "malformed";
    dx /= dl; dy /= dl; dz /= dl;
    this.hooks.broadcast("ps", [sid, +dx.toFixed(3), +dy.toFixed(3), +dz.toFixed(3)], sid);

    const enemyId = m[6] | 0, claimHead = !!m[7];
    if (enemyId <= 0) return "miss";
    const e = this.E.get(enemyId);
    if (!e || !e.alive) return "gone";
    // the muzzle has to be where we have the shooter, give or take lag and bob
    if (Math.hypot(ox - p.st.x, oy - p.st.y, oz - p.st.z) > 2.2) { ox = p.st.x; oy = p.st.y; oz = p.st.z; }

    const sc = e.def.scale;
    const tol = .8 + e.speed * .3;         // how far he can have walked inside the lag window
    const nearest = (cx, cy, cz) => {
      const t = Math.max(0, (cx - ox) * dx + (cy - oy) * dy + (cz - oz) * dz);
      return { d: Math.hypot(ox + dx * t - cx, oy + dy * t - cy, oz + dz * t - cz), t };
    };
    const head = nearest(e.st.x, e.baseY + HEAD_Y * sc, e.st.z);
    // the body is a column, so test the line against three points up its height
    let body = { d: 1e9, t: 0 };
    for (const h of [.3, BODY_Y, 1.1]) { const r = nearest(e.st.x, e.baseY + h * sc, e.st.z); if (r.d < body.d) body = r; }
    const isHead = claimHead && head.d <= .32 + tol * .55;
    if (!isHead && body.d > .5 + tol) return "wide";

    const aim = isHead ? head : body;
    const hx = ox + dx * aim.t, hy = oy + dy * aim.t, hz = oz + dz * aim.t;
    if (W.blocked(this.state.sector, ox, oy, oz, hx, hy, hz, 1.1)) return "blocked";

    const dealt = isHead ? wpn.damage * C.HEADSHOT_MULT : wpn.damage * e.def.armor;
    const killed = this.damageEnemy(e, dealt, p, isHead, false);
    this.hooks.send(sid, "hit", [e.id, isHead ? 1 : 0, killed ? 1 : 0]);
    return "hit";
  }

  finishReload(p) {
    p.st.reloading = false; p.reloadEnd = 0;
    p.st.ammo = W.weapons[p.st.weapon].mag; p.ammoBy[p.st.weapon] = p.st.ammo;
  }

  /* Grenades. The thrower's client flies the grenade, because the bounce
     depends on triangle-accurate geometry the server does not carry. What the
     server owns is the count, the timing and every point of damage. */
  throwNade(sid, m, nowMs) {
    const p = this.P.get(sid);
    if (!p || this.state.phase !== "play" || p.st.life !== LIFE.ALIVE) return false;
    if (!Array.isArray(m) || m.length < 6 || !m.every(Number.isFinite)) return false;
    if (p.st.nades <= 0) return false;
    const sp = Math.hypot(m[3], m[4], m[5]);
    if (sp > G.speedMax * 1.08) return false;
    if (Math.hypot(m[0] - p.st.x, m[1] - p.st.y, m[2] - p.st.z) > 2.5) return false;
    p.st.nades--;
    p.throws.push({ at: nowMs, x: m[0], y: m[1], z: m[2] });
    this.hooks.broadcast("gt", [sid, ...m.map(v => +v.toFixed(2))], sid);
    return true;
  }

  burstNade(sid, m, nowMs) {
    const p = this.P.get(sid);
    if (!p || !Array.isArray(m) || m.length < 3 || !m.every(Number.isFinite)) return false;
    // it has to be one this player really threw, about a fuse ago, within reach
    const i = p.throws.findIndex(t => {
      const el = (nowMs - t.at) / 1000;
      return el > G.fuse - .7 && el < G.fuse + 2 &&
        Math.hypot(m[0] - t.x, m[1] - t.y, m[2] - t.z) < G.speedMax * G.fuse * 1.1 + 6;
    });
    if (i < 0) return false;
    p.throws.splice(i, 1);
    const [bx, by, bz] = m;
    this.hooks.broadcast("gb", [sid, +bx.toFixed(2), +by.toFixed(2), +bz.toFixed(2)], sid);
    if (this.state.phase !== "play") return true;
    let hitAny = 0;
    for (const e of Array.from(this.E.values())) {
      if (!e.alive) continue;
      const cx = e.st.x, cy = e.baseY + 1 * e.def.scale, cz = e.st.z;
      const d = Math.hypot(cx - bx, cy - by, cz - bz);
      if (d > G.radius) continue;
      const f = 1 - d / G.radius, falloff = f * f * .55 + f * .45;
      const cover = W.blocked(this.state.sector, bx, by, bz, cx, cy, cz, .2);
      const dmg = G.damage * falloff * (cover ? G.coverFactor : 1) * e.def.armor;
      if (dmg <= 0) continue;
      hitAny++;
      this.damageEnemy(e, dmg, p, false, true);
    }
    if (hitAny) this.hooks.send(sid, "hit", [0, 0, 0]);
    // a lob dropped at your own feet costs you; it never hurts a teammate
    const pd = Math.hypot(p.st.x - bx, p.st.y - by, p.st.z - bz);
    if (pd < G.selfRadius && this.t >= p.invulnT) { const f = 1 - pd / G.selfRadius; this.hurtPlayer(p, G.selfDamage * f * f, bx, by, bz); }
    return true;
  }

  setReviving(sid, targetSid) {
    const p = this.P.get(sid); if (!p) return;
    if (!targetSid || p.st.life !== LIFE.ALIVE) { p.st.reviving = ""; return; }
    const t = this.P.get(targetSid);
    if (!t || t.st.life !== LIFE.DOWNED) { p.st.reviving = ""; return; }
    p.st.reviving = targetSid;
  }

  updatePlayers(dt) {
    for (const p of this.P.values()) {
      const st = p.st;
      if (st.reloading && this.t >= p.reloadEnd) this.finishReload(p);
      if (p.throws.length && p.throws[0].at < Date.now() - 15000) p.throws.shift();
      if (st.life === LIFE.ALIVE) {
        if (this.t - p.lastHitT > 9 && p.hp < 100) { p.hp = Math.min(100, p.hp + dt * 4.5); const r = Math.round(p.hp); if (r !== st.hp) st.hp = r; }
        // carry out a revive in progress
        if (st.reviving) {
          const t = this.P.get(st.reviving);
          const ok = t && t.st.life === LIFE.DOWNED && st.connected &&
            Math.hypot(t.st.x - st.x, t.st.z - st.z) <= config.reviveRange;
          if (!ok) st.reviving = "";
        }
      } else if (st.life === LIFE.DOWNED) {
        let helpers = 0, by = "";
        for (const q of this.P.values()) if (q.st.reviving === p.sid && q.st.life === LIFE.ALIVE) { helpers++; by = q.sid; }
        if (helpers) {
          p.reviveT += dt * (1 + (helpers - 1) * .5);
          const pr = Math.min(100, Math.round(p.reviveT / config.reviveSeconds * 100));
          if (pr !== st.revive) st.revive = pr;
          if (p.reviveT >= config.reviveSeconds) {
            for (const q of this.P.values()) if (q.st.reviving === p.sid) q.st.reviving = "";
            this.revivePlayer(p, config.reviveHp, by);
          }
        } else {
          // the clock only runs while nobody is working on him
          if (p.reviveT > 0) { p.reviveT = Math.max(0, p.reviveT - dt * 2); st.revive = Math.round(p.reviveT / config.reviveSeconds * 100); }
          p.bleedT -= dt;
          const b = Math.max(0, Math.ceil(p.bleedT)); if (b !== st.bleed) st.bleed = b;
          if (p.bleedT <= 0) { st.life = LIFE.DEAD; st.bleed = 0; st.revive = 0; this.hooks.broadcast("died", [p.sid]); this.checkEliminated(); }
        }
      }
    }
  }

  /* --------------------------------------------------------------- tick */
  tick(dt) {
    this.t += dt;
    const s = this.state;
    if (s.phase !== "play") return;
    this.updatePlayers(dt);
    if (s.phase !== "play") return;
    if (this.connectedCount() === 0) return;          // nobody home: hold everything

    for (const e of Array.from(this.E.values())) this.updateEnemy(e, dt);
    if (s.phase !== "play") return;

    if (s.waveState === "spawning") {
      let live = 0; for (const e of this.E.values()) if (e.alive) live++;
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.queue.length && live < this.maxAlive) {
        this.spawnOne(); live++;
        this.spawnT = this.interval * rand(.7, 1.3);
      }
      // stall breaker: nothing has died for a while, so go and find the players
      if (live) {
        this.stallT += dt;
        if (this.stallStage < 1 && this.stallT > 18) { this.stallStage = 1; for (const e of this.E.values()) if (e.alive) this.expose(e, false); }
        else if (this.stallStage < 2 && this.stallT > 34) { this.stallStage = 2; for (const e of this.E.values()) if (e.alive && !this.expose(e, true)) e.speed *= 1.35; }
      } else { this.stallT = 0; this.stallStage = 0; }
      this.syncRemaining();
      if (!this.queue.length && live === 0) this.waveCleared();
    } else if (s.waveState === "intermission") {
      this.interT -= dt;
      const c = Math.max(0, Math.ceil(this.interT - .2)); if (c !== s.countdown) s.countdown = c;
      if (this.interT <= 0) this.startWave(s.wave + 1);
    }
  }

  waveCleared() {
    const s = this.state;
    s.waveState = "intermission"; this.interT = 4.2; s.countdown = 4;
    s.credits += 500; s.score += 500;
    for (const p of this.P.values()) {
      if (p.st.nades < G.max) p.st.nades++;
      // a cleared wave puts the whole team back on its feet
      if (p.st.life !== LIFE.ALIVE) this.revivePlayer(p, config.waveReviveHp, "");
    }
    this.hooks.broadcast("clear", [s.wave]);
  }
}

module.exports = { Simulation };
