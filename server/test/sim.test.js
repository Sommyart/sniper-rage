/* Simulation tests. No sockets, no browser: the simulation is driven directly
   with a fake clock, which makes every rule of the co-op game checkable in
   well under a second.   node test/sim.test.js                              */
const { RoomState, LIFE, EST } = require("../src/state");
const { Simulation } = require("../src/sim/simulation");
const W = require("../src/sim/world");
const config = require("../src/config");

let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) pass++; else fail++;
  console.log((cond ? "  PASS  " : "  FAIL  ") + name + (detail !== undefined ? "  [" + detail + "]" : ""));
}
function make(names) {
  const s = new RoomState();
  s.phase = "lobby"; s.hostId = ""; s.sector = 0; s.wave = 0; s.waveState = "idle";
  s.score = 0; s.credits = 0; s.kills = 0; s.headshots = 0; s.remaining = 0; s.countdown = 0;
  const log = [];
  const sim = new Simulation(s, {
    broadcast: (t, m, ex) => log.push({ t, m, ex }),
    send: (sid, t, m) => log.push({ t, m, to: sid })
  });
  for (const n of names) sim.addPlayer(n, { name: n.toUpperCase(), unlocked: [0, 1] });
  return { s, sim, log };
}
const run = (sim, secs, dt = .05) => { for (let t = 0; t < secs; t += dt) sim.tick(dt); };
const of = (log, t) => log.filter(x => x.t === t);
let clock = 1e6;                           // fake wall clock for rate checks, ms
const later = ms => (clock += ms);

/* aim a perfect shot from player p at enemy e */
function aimAt(p, e, yOff) {
  const tx = e.st.x, ty = e.baseY + yOff * e.def.scale, tz = e.st.z;
  const d = [tx - p.st.x, ty - p.st.y, tz - p.st.z], l = Math.hypot(...d);
  return [p.st.x, p.st.y, p.st.z, d[0] / l, d[1] / l, d[2] / l];
}
/* find a live enemy the given player has a clear line to */
function visibleEnemy(sim, p, yOff = .65) {
  for (const e of sim.E.values()) {
    if (!e.alive) continue;
    if (!W.blocked(sim.state.sector, p.st.x, p.st.y, p.st.z, e.st.x, e.baseY + yOff * e.def.scale, e.st.z, 1.1)) return e;
  }
  return null;
}

console.log("\n--- world data ---");
ck("five sectors exported", W.SECTORS.length === 5);
ck("every sector has cover, spawns and walls", W.SECTORS.every(s => s.cover.length > 20 && s.occluders.length > 20 && Object.keys(s.spawns).length >= 4));
{
  // a wall must block and open air must not: straight down through the deck, and straight up
  const v = W.SECTORS[0].vantage;
  ck("the deck slab blocks a line straight down through it", W.blocked(0, v.sx, v.y + 1.6, v.sz, v.sx, v.y - 3, v.sz, 0) === true);
  ck("open sky is not blocked", W.blocked(0, v.sx, v.y + 40, v.sz, v.sx + 5, v.y + 60, v.sz, 0) === false);
}

console.log("\n--- lobby and start ---");
{
  const { s, sim, log } = make(["a", "b", "c"]);
  ck("first player in is host", s.hostId === "a");
  ck("players get distinct slots", new Set([...sim.P.values()].map(p => p.st.slot)).size === 3);
  const xs = [...sim.P.values()].map(p => p.st.x.toFixed(1));
  ck("players spawn apart on the deck", new Set(xs).size === 3, xs.join(" "));
  ck("nothing simulates in the lobby", (run(sim, 2), s.enemies.size === 0 && s.wave === 0));
  sim.startGame();
  ck("start puts the room in play on wave 1", s.phase === "play" && s.wave === 1 && s.waveState === "spawning");
  const solo = make(["x"]); solo.sim.startGame();
  ck("solo wave 1 keeps the original 5 hostiles", solo.s.remaining === 5, solo.s.remaining);
  ck("a team of 3 faces more: 5 scaled by team size", s.remaining === Math.round(5 * (1 + config.enemiesPerExtraPlayer * 2)), s.remaining);
  ck("wave start is announced to everyone", of(log, "wave").length === 1);
  run(sim, 8);
  ck("hostiles spawn over time", s.enemies.size > 2, s.enemies.size + " on the field");
  const e = [...sim.E.values()][0];
  const x0 = e.st.x, z0 = e.st.z; run(sim, 1.5);
  ck("hostiles are assigned a target player", [...sim.E.values()].every(q => !q.alive || ["a", "b", "c"].includes(q.tgt)));
  ck("hostiles move under server control", [...sim.E.values()].some(q => q.state !== "advance") || Math.hypot(e.st.x - x0, e.st.z - z0) > .1);
}

console.log("\n--- enemies hurt players only through the server ---");
{
  const { s, sim, log } = make(["a"]);
  sim.startGame(); sim.P.get("a").invulnT = 0;
  run(sim, 70);
  const shots = of(log, "ef").length, hurts = of(log, "hurt").length;
  ck("hostiles open fire", shots > 0, shots + " shots");
  ck("some rounds land and some miss", hurts > 0 && hurts < shots, hurts + " hits of " + shots);
  ck("every hit is reported to the victim", of(log, "hurt").every(h => h.to === "a"));
  ck("health fell by what the server dealt, or the player is down", sim.P.get("a").hp < 100 || s.phase === "over");
}

console.log("\n--- shot validation ---");
{
  const { s, sim, log } = make(["a"]);
  sim.startGame(); const p = sim.P.get("a"); p.invulnT = 1e9;
  let e = null; for (let i = 0; i < 400 && !e; i++) { run(sim, .25); e = visibleEnemy(sim, p); }
  ck("found a hostile with a clear line", !!e);
  if (e) {
    const hp0 = e.hp, ammo0 = p.st.ammo;
    const r = sim.shoot("a", [...aimAt(p, e, .65), e.id, 0], later(5000));
    ck("an honest body shot lands", r === "hit" && e.hp < hp0, r + ", " + hp0.toFixed(0) + " -> " + e.hp.toFixed(0));
    ck("damage is the server's own table value", Math.abs((hp0 - e.hp) - W.weapons[0].damage * e.def.armor) < .01);
    ck("the round came out of the server's magazine", p.st.ammo === ammo0 - 1);
    ck("the shooter is told it hit", of(log, "hit").some(h => h.to === "a" && h.m[0] === e.id));

    const hp1 = e.hp;
    ck("firing again inside the rifle's cycle is refused", sim.shoot("a", [...aimAt(p, e, .65), e.id, 0], later(200)) === "cycle" && e.hp === hp1);

    // aim 6 metres to the side but still claim the hit
    const wide = aimAt(p, e, .65); wide[3] += .25; { const l = Math.hypot(wide[3], wide[4], wide[5]); wide[3] /= l; wide[4] /= l; wide[5] /= l; }
    ck("a shot that does not pass through the target is refused", sim.shoot("a", [...wide, e.id, 0], later(5000)) === "wide" && e.hp === hp1);

    // claim a headshot while aiming at the feet: pays out as a body shot at most
    const feet = sim.shoot("a", [...aimAt(p, e, .3), e.id, 1], later(5000));
    const dealt = hp1 - e.hp;
    ck("a false headshot claim is paid as a body shot", feet === "hit" && Math.abs(dealt - W.weapons[0].damage * e.def.armor) < .01, dealt.toFixed(1));

    ck("a shot at a hostile that does not exist is refused", sim.shoot("a", [...aimAt(p, e, .65), 9999, 0], later(5000)) === "gone");
    ck("garbage is refused", sim.shoot("a", [NaN, 0, 0, 0, 0, 1, e.id, 0], later(5000)) === "malformed");

    // spoofed muzzle position: fire "from" 30 metres away, right beside the target
    const live = [...sim.E.values()].find(q => q.alive);
    if (live) {
      const spoof = [live.st.x + 1, live.baseY + .65, live.st.z, -1, 0, 0, live.id, 0];
      const before = live.hp;
      const res = sim.shoot("a", spoof, later(5000));
      ck("a spoofed muzzle position is ignored: the server uses where the player is", res !== "hit" || live.hp === before || !W.blocked(s.sector, p.st.x, p.st.y, p.st.z, live.st.x, live.baseY + .65, live.st.z, 1.1), res);
    }
  }
  // a hostile behind solid cover
  let hidden = null;
  for (let i = 0; i < 200 && !hidden; i++) {
    run(sim, .25);
    for (const q of sim.E.values()) if (q.alive && W.blocked(s.sector, p.st.x, p.st.y, p.st.z, q.st.x, q.baseY + .65, q.st.z, 1.1) && W.blocked(s.sector, p.st.x, p.st.y, p.st.z, q.st.x, q.baseY + 1.1, q.st.z, 1.1) && W.blocked(s.sector, p.st.x, p.st.y, p.st.z, q.st.x, q.baseY + .3, q.st.z, 1.1)) { hidden = q; break; }
  }
  if (hidden) {
    const b = hidden.hp;
    ck("a shot through a wall is refused", sim.shoot("a", [...aimAt(p, hidden, .65), hidden.id, 0], later(5000)) === "blocked" && hidden.hp === b);
  } else ck("a shot through a wall is refused", false, "no hidden hostile turned up to test against");
}

console.log("\n--- ammunition and reload ---");
{
  const { sim } = make(["a"]); sim.startGame(); const p = sim.P.get("a");
  ck("magazine starts at 50", p.st.ammo === 50);
  for (let i = 0; i < 50; i++) sim.shoot("a", [p.st.x, p.st.y, p.st.z, 0, 0, -1, 0, 0], later(2000));
  ck("50 rounds empties it and starts the reload", p.st.ammo === 0 && p.st.reloading === true);
  ck("no shot counts during the reload", sim.shoot("a", [p.st.x, p.st.y, p.st.z, 0, 0, -1, 0, 0], later(2000)) === "reloading");
  run(sim, 2.9); ck("still reloading at 2.9s", p.st.reloading === true);
  run(sim, .2); ck("reload completes at exactly 3.0s, full magazine", p.st.reloading === false && p.st.ammo === 50);
  ck("a locked rifle cannot be equipped", sim.switchWeapon("a", 4) === false && p.st.weapon === 0);
  ck("an owned rifle can", sim.switchWeapon("a", 1) === true && p.st.weapon === 1);
}

console.log("\n--- kills, score, wave completion ---");
{
  const { s, sim, log } = make(["a", "b"]); sim.startGame();
  for (const p of sim.P.values()) p.invulnT = 1e9;
  const total = s.remaining;
  let guard = 0;
  while (s.waveState === "spawning" && guard++ < 4000) {
    run(sim, .1);
    for (const e of [...sim.E.values()]) if (e.alive) sim.damageEnemy(e, 9999, sim.P.get(guard % 2 ? "a" : "b"), guard % 3 === 0, false);
  }
  ck("the wave only ends when every hostile is dead", s.waveState === "intermission" && s.kills === total, s.kills + " of " + total);
  ck("kills are credited to whoever made them", sim.P.get("a").st.kills + sim.P.get("b").st.kills === total);
  ck("score and credits are shared by the team", s.score > 500 && s.credits > 500, s.score + " pts, " + s.credits + " cr");
  ck("every kill is announced", of(log, "kill").length === total);
  ck("the clear is announced and pays the 500 bonus", of(log, "clear").length === 1);
  ck("each player is resupplied one frag", [...sim.P.values()].every(p => p.st.nades === 4));
  ck("the countdown runs", s.countdown > 0);
  run(sim, 5);
  ck("the next wave starts by itself", s.wave === 2 && s.waveState === "spawning");
  // push on to wave 4: the sector must change for everyone
  guard = 0;
  while (s.wave < 4 && guard++ < 20000) { run(sim, .1); for (const e of [...sim.E.values()]) if (e.alive) sim.damageEnemy(e, 9999, sim.P.get("a"), false, false); }
  ck("wave 4 redeploys the whole team to sector 2", s.wave === 4 && s.sector === 1);
  const v = W.SECTORS[1].vantage;
  ck("players are placed on the new deck", [...sim.P.values()].every(p => p.st.x >= v.x0 && p.st.x <= v.x1 && Math.abs(p.st.y - (v.y + W.constants.EYE)) < .01));
}

console.log("\n--- downed, revive, elimination ---");
{
  const { s, sim, log } = make(["a", "b"]); sim.startGame();
  const a = sim.P.get("a"), b = sim.P.get("b"); a.invulnT = 0; b.invulnT = 1e9;
  sim.clearEnemies(); sim.queue = [{ type: "basic", zone: "street" }]; sim.maxAlive = 0;   // a wave in progress with nobody on the field
  sim.hurtPlayer(a, 150, 0, 0, 0);
  ck("lethal damage downs a player instead of killing them", a.st.life === LIFE.DOWNED && a.st.bleed === config.bleedoutSeconds);
  ck("the team is told", of(log, "down").length === 1);
  ck("the match continues while a teammate stands", s.phase === "play");
  ck("a downed player cannot shoot", sim.shoot("a", [a.st.x, a.st.y, a.st.z, 0, 0, -1, 0, 0], later(5000)) === "state");
  const ax = a.st.x; sim.move("a", ax + 1, a.st.z, 0, 0, 0, later(500));
  ck("a downed player cannot walk", a.st.x === ax);
  run(sim, 5);
  ck("the bleedout clock runs", a.st.bleed <= config.bleedoutSeconds - 4, a.st.bleed + "s left");

  // too far away: nothing happens
  b.st.x = a.st.x + 9; sim.setReviving("b", "a"); run(sim, 1);
  ck("a revive from out of range does nothing", a.st.revive === 0 && b.st.reviving === "");
  b.st.x = a.st.x + 1; sim.setReviving("b", "a");
  const bleedAt = a.st.bleed; run(sim, 1.5);
  ck("revive progress builds while a teammate holds it", a.st.revive > 30 && a.st.revive < 70, a.st.revive + "%");
  ck("the bleedout clock stops while being revived", a.st.bleed === bleedAt);
  run(sim, 1.7);
  ck("the revive completes after " + config.reviveSeconds + "s", a.st.life === LIFE.ALIVE && a.st.hp === config.reviveHp, "hp " + a.st.hp);
  ck("and is announced", of(log, "revived").some(r => r.m[0] === "a" && r.m[1] === "b"));

  // bleed all the way out
  a.invulnT = 0; sim.hurtPlayer(a, 150, 0, 0, 0);
  run(sim, config.bleedoutSeconds + 1);
  ck("an unrevived player dies when the clock runs out", a.st.life === LIFE.DEAD);
  ck("the match still continues", s.phase === "play");
  b.invulnT = 0; sim.hurtPlayer(b, 150, 0, 0, 0);
  ck("with nobody left standing it is GAME OVER", s.phase === "over");
  ck("the result is sent to everyone", of(log, "over").length === 1 && of(log, "over")[0].m[5].length === 2);
  sim.startGame();
  ck("the host can start again and everyone is restored", s.phase === "play" && a.st.life === LIFE.ALIVE && b.st.hp === 100 && s.score === 0);
}
{
  const { s, sim } = make(["a", "b"]); sim.startGame();
  for (const p of sim.P.values()) p.invulnT = 0;
  sim.hurtPlayer(sim.P.get("a"), 150, 0, 0, 0);
  let g = 0; while (s.waveState === "spawning" && g++ < 4000) { run(sim, .1); sim.P.get("b").invulnT = 1e9; for (const e of [...sim.E.values()]) if (e.alive) sim.damageEnemy(e, 9999, sim.P.get("b"), false, false); if (sim.P.get("a").st.life !== LIFE.DOWNED) break; }
  // force the clear with a still downed
  sim.P.get("a").bleedT = 99; g = 0;
  while (s.waveState === "spawning" && g++ < 4000) { run(sim, .1); for (const e of [...sim.E.values()]) if (e.alive) sim.damageEnemy(e, 9999, sim.P.get("b"), false, false); }
  ck("clearing a wave puts a downed teammate back on their feet", sim.P.get("a").st.life === LIFE.ALIVE && sim.P.get("a").st.hp === config.waveReviveHp);
}

console.log("\n--- movement ---");
{
  const { sim, log } = make(["a"]); sim.startGame(); const p = sim.P.get("a");
  const v = W.SECTORS[0].vantage; log.length = 0;
  sim.move("a", p.st.x, p.st.z, 0, 0, 0, later(100));
  sim.move("a", p.st.x + .15, p.st.z, .5, -.2, 1, later(50));
  ck("an honest step is accepted as sent", of(log, "corr").length === 0 && p.st.yaw === .5 && p.st.ads === true);
  const x0 = p.st.x;
  sim.move("a", x0 + 12, p.st.z, 0, 0, 0, later(50));
  ck("a 12 metre jump in 50ms is pulled back", p.st.x - x0 < 1.5 && of(log, "corr").length === 1, "moved " + (p.st.x - x0).toFixed(2) + "m");
  for (let i = 0; i < 400; i++) sim.move("a", p.st.x + .15, p.st.z + .15, 0, 0, 0, later(50));
  ck("a player cannot leave the firing deck", p.st.x <= v.x1 + 1e-6 && p.st.z <= v.z1 + 1e-6, p.st.x.toFixed(1) + ", " + p.st.z.toFixed(1));
}

console.log("\n--- grenades ---");
{
  const { s, sim, log } = make(["a"]); sim.startGame(); const p = sim.P.get("a"); p.invulnT = 1e9;
  let e = null; for (let i = 0; i < 200 && !e; i++) { run(sim, .25); e = [...sim.E.values()].find(q => q.alive); }
  const at = [e.st.x, e.baseY + .4, e.st.z];
  ck("a blast nobody threw is refused", sim.burstNade("a", at, later(100)) === false && e.alive);
  const thrown = sim.throwNade("a", [p.st.x, p.st.y, p.st.z, 0, 6, -20], later(100));
  ck("a throw spends one frag on the server", thrown && p.st.nades === 2);
  ck("a blast the instant after the throw is refused", sim.burstNade("a", at, later(200)) === false && e.alive);
  const hp0 = e.hp;
  const ok = sim.burstNade("a", [e.st.x, e.baseY + .4, e.st.z], later(2500));
  ck("a blast one fuse later is accepted and the server deals the damage", ok && (e.hp < hp0 || !e.alive), hp0.toFixed(0) + " -> " + Math.max(0, e.hp).toFixed(0));
  ck("one throw cannot be detonated twice", sim.burstNade("a", at, later(100)) === false);
  ck("a throw faster than an arm can manage is refused", sim.throwNade("a", [p.st.x, p.st.y, p.st.z, 0, 0, -90], later(100)) === false && p.st.nades === 2);
  sim.throwNade("a", [p.st.x, p.st.y, p.st.z, 0, 6, -20], later(100)); sim.throwNade("a", [p.st.x, p.st.y, p.st.z, 0, 6, -20], later(100));
  ck("no frags left means no throw", p.st.nades === 0 && sim.throwNade("a", [p.st.x, p.st.y, p.st.z, 0, 6, -20], later(100)) === false);
}

console.log("\n--- disconnect and reconnect ---");
{
  const { s, sim } = make(["a", "b"]); sim.startGame();
  for (const p of sim.P.values()) p.invulnT = 1e9;
  run(sim, 6);
  sim.P.get("a").st.kills = 3; sim.P.get("a").hp = 61; sim.P.get("a").st.hp = 61; sim.P.get("a").lastHitT = sim.t;
  sim.setConnected("a", false);
  ck("a dropped player is marked, not removed", s.players.has("a") && s.players.get("a").connected === false);
  ck("the host role passes on", s.hostId === "b");
  run(sim, 3);
  ck("hostiles stop hunting a dropped player", [...sim.E.values()].every(e => !e.alive || e.tgt !== "a"));
  sim.setConnected("a", true);
  ck("on reconnect their kills, health and seat are as they left them", s.players.get("a").connected && s.players.get("a").kills === 3 && s.players.get("a").hp === 61);
  sim.setConnected("b", false); sim.setConnected("a", false);
  const t0 = s.enemies.size, w0 = s.wave; run(sim, 20);
  ck("an empty room holds still rather than playing on", s.phase === "play" && s.wave === w0);
  sim.removePlayer("a");
  ck("a player who never returns is removed cleanly", !s.players.has("a") && !sim.P.has("a"));
}

console.log("\n============ " + pass + " passed, " + fail + " failed ============");
process.exit(fail ? 1 : 0);
