/* World exporter.

   The co-op server has to decide who can see whom and whether a shot was
   possible, and it has to do it without a GPU or three.js. So the real game is
   booted once in a browser, every sector is loaded, and the parts of it that
   matter tactically are written out as plain numbers:

     - the firing deck each player is confined to
     - every cover slot and every spawn point, by zone
     - every occluder as an oriented box (inverse world matrix + local bounds)
     - the weapon, enemy and grenade tables, so the server and the client can
       never drift apart on a damage number

   Output: server/data/world.json. Re-run it whenever the level geometry or a
   balance table changes:   node build/package.js && node build/export-world.js
*/
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..", "public");
const OUT = path.join(__dirname, "..", "server", "data", "world.json");
const T = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webmanifest": "application/manifest+json", ".glb": "model/gltf-binary" };

const srv = http.createServer((q, s) => {
  let p = q.url.split("?")[0]; if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(s);
});

(async () => {
  await new Promise(r => srv.listen(8111, r));
  const b = await chromium.launch({
    executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--mute-audio"]
  });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto("http://localhost:8111/index.html", { waitUntil: "load", timeout: 180000 });
  await p.waitForFunction("typeof Game!=='undefined' && typeof World!=='undefined'", { timeout: 180000 });
  await p.waitForTimeout(9000);          // let the external models settle

  const data = await p.evaluate(() => {
    const r3 = v => Math.round(v * 1000) / 1000;
    const sectors = [];
    for (let i = 0; i < MAPS.length; i++) {
      const m = World.load(i);
      scene.updateMatrixWorld(true);
      const occ = [];
      for (const o of occluders) {
        if (!o.geometry) continue;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        o.updateMatrixWorld(true);
        const bb = o.geometry.boundingBox;
        const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
        occ.push({
          inv: Array.from(inv.elements).map(v => Math.round(v * 1e5) / 1e5),
          min: [r3(bb.min.x), r3(bb.min.y), r3(bb.min.z)],
          max: [r3(bb.max.x), r3(bb.max.y), r3(bb.max.z)]
        });
      }
      const spawns = {};
      for (const z in ZONE_SPAWNS) spawns[z] = ZONE_SPAWNS[z].map(s => s.slice());
      sectors.push({
        index: i, name: m.name, brief: m.brief,
        vantage: Object.assign({}, VANTAGE),
        labels: Object.assign({}, ZONE_LABEL),
        activeZones: ACTIVE_ZONES.slice(),
        spawns,
        cover: coverPoints.map(c => ({ zone: c.zone, x: r3(c.pos.x), y: r3(c.pos.y), z: r3(c.pos.z), los: !!c.los })),
        pillars: pillarCols.map(c => ({ x: r3(c.x), z: r3(c.z), r: r3(c.r) })),
        occluders: occ
      });
    }
    World.load(0);
    const strip = o => { const out = {}; for (const k in o) if (typeof o[k] !== "function" && k !== "cols" && k !== "body" && k !== "accent") out[k] = o[k]; return out; };
    const etypes = {}; for (const k in ETYPES) etypes[k] = strip(ETYPES[k]);
    return {
      constants: { EYE, RELOAD_TIME, HEADSHOT_MULT, LONG_SHOT_M, SECTOR_EVERY },
      weapons: WEAPONS.map(strip),
      etypes,
      grenade: Object.assign({}, GRENADE),
      waveCounts: [1, 2, 3, 4, 5, 6, 7, 8].map(w => Waves.count(w)),
      sectors
    };
  });

  data.generated = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log("wrote " + path.relative(process.cwd(), OUT) + "  " + (fs.statSync(OUT).size / 1024).toFixed(0) + " KB");
  for (const s of data.sectors)
    console.log("  " + String(s.index) + " " + s.name.padEnd(18) + " cover " + String(s.cover.length).padStart(3) +
      " (los " + s.cover.filter(c => c.los).length + ")  occluders " + String(s.occluders.length).padStart(4) +
      "  zones " + s.activeZones.join(","));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
