/* Packager.

   The source page pulls three.js from a CDN, which is fine on the web and
   useless in an APK or with the network off. Everything here produces builds
   with three.js inlined, so the game has no external dependency at all: the
   soundtrack and every model are already base64 inside the page.

   Outputs:
     public/                the hosted site, and Vercel's output directory
     public/index.html      the game, with a manifest so it installs
     public/sniper-rage.html  the same game as one standalone file to download
     public/assets/         the four environment models, also precached
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "sniper-rage.html");
const THREE = path.join(__dirname, "vendor/three.min.js");
const OUT = path.join(ROOT, "public");
const SITE = OUT;   // the hosted site IS the output directory

fs.mkdirSync(SITE, { recursive: true });

const version = (fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8").match(/^## (v\d+)/gm) || ["v0"]).pop().slice(3);
let html = fs.readFileSync(SRC, "utf8").split("__SR_VERSION__").join(version);
const three = fs.readFileSync(THREE, "utf8");

/* ---- inline three.js ---- */
const tag = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/;
if (!tag.test(html)) { console.error("! the three.js CDN tag was not found; refusing to guess"); process.exit(1); }
const inlined = html.replace(
  tag,
  "<!-- three.js r128, inlined so the build needs no network at all -->\n<script>" +
  three.replace(/<\/script>/gi, "<\\/script>") + "</script>"
);
if (/cdnjs|unpkg|jsdelivr/.test(inlined.replace(/inlined so the build needs no network[\s\S]{0,40}/, ""))) {
  // only the comment above may still mention a CDN
  const left = inlined.match(/https?:\/\/[^"'\s)]*(cdnjs|unpkg|jsdelivr)[^"'\s)]*/g);
  if (left) { console.error("! external script references remain:", left.slice(0, 5)); process.exit(1); }
}

fs.writeFileSync(path.join(OUT, "sniper-rage.html"), inlined);

/* ---- icons, pulled straight out of the page's own constants ---- */
function grab(name) {
  const m = inlined.match(new RegExp("const " + name + '="data:image\\/png;base64,([A-Za-z0-9+/=]+)"'));
  if (!m) throw new Error("icon constant " + name + " not found");
  return Buffer.from(m[1], "base64");
}
const icons = { "icon-192.png": grab("ICON192"), "icon-512.png": grab("ICON512"), "icon-512-maskable.png": grab("ICONMSK") };
for (const f in icons) fs.writeFileSync(path.join(SITE, f), icons[f]);

/* ---- the hosted page: same file, with a real manifest linked ---- */
const site0 = inlined.replace(
  /<title>/,
  '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="theme-color" content="#000000">\n<title>'
);
if (site0 === inlined) { console.error("! could not find <title> to anchor the manifest link"); process.exit(1); }

/* ---- the hosted page keeps its big blobs as separate files ----
   Fifty megabytes of base64 inside the HTML makes the phone's main thread
   parse for many seconds, freezing the intro and every timer. The hosted
   page instead references them as files, which download in parallel off the
   main thread, are cached by hash, and decode asynchronously. The standalone
   sniper-rage.html keeps everything inline. */
const crypto = require("crypto");
const BLOBDIR = path.join(SITE, "assets");
fs.mkdirSync(BLOBDIR, { recursive: true });
for (const f of fs.readdirSync(BLOBDIR)) if (/^x-/.test(f)) fs.unlinkSync(path.join(BLOBDIR, f));
const EXT = {"model/gltf-binary":"glb","video/mp4":"mp4","audio/mpeg":"mp3","image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/octet-stream":"bin","image/vnd.radiance":"hdr"};
const BLOBS = [];
let site = "", at = 0;
for (;;) {
  const i = site0.indexOf('"data:', at); if (i < 0) { site += site0.slice(at); break; }
  const semi = site0.indexOf(";base64,", i), end = site0.indexOf('"', i + 1);
  if (semi < 0 || end < 0 || semi > end || end - semi < 65536) { site += site0.slice(at, i + 1); at = i + 1; continue; }
  const mime = site0.slice(i + 6, semi), buf = Buffer.from(site0.slice(semi + 8, end), "base64");
  const name = "x-" + crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) + "." + (EXT[mime] || "bin");
  if (!BLOBS.some(x => x.name === name)) { fs.writeFileSync(path.join(BLOBDIR, name), buf); BLOBS.push({name, size: buf.length}); }
  site += site0.slice(at, i) + '"assets/' + name + '"'; at = end + 1;
}
console.log("  externalised", BLOBS.length, "blobs,", Math.round(BLOBS.reduce((a,b)=>a+b.size,0)/1048576), "MB; page now", Math.round(site.length/1048576*10)/10, "MB");
fs.writeFileSync(path.join(SITE, "index.html"), site);

const manifest = {
  name: "Sniper Rage",
  short_name: "Sniper Rage",
  description: "Tactical sniper operations. Five sectors, endless waves, frag grenades, offline play.",
  start_url: "./index.html",
  scope: "./",
  display: "fullscreen",
  orientation: "landscape",
  background_color: "#000000",
  theme_color: "#000000",
  categories: ["games"],
  icons: [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]
};
fs.writeFileSync(path.join(SITE, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));

/* ---- external models ----
   The page has the rifle, the soldier and the soundtrack inlined, but the four
   environment models are too big to embed and are fetched from assets/ at run
   time. They have to travel with the site, and they have to be precached, or
   "offline" means playing in an empty lot with no ruins and no scaffolding. */
const ASSET_SRC = path.join(ROOT, "assets");
// No external models ship any more; the third-party models were removed.
// The check below still refuses a build whose page fetches a model not listed.
const MODELS = [];
const referenced = [...new Set((inlined.match(/assets\/[a-zA-Z0-9_.-]+\.glb/g) || []))]
  .map(s => s.replace("assets/", ""));
const missingRef = referenced.filter(m => !MODELS.includes(m));
if (missingRef.length) { console.error("! the page fetches models the packager does not ship:", missingRef); process.exit(1); }
if (MODELS.length) fs.mkdirSync(path.join(SITE, "assets"), { recursive: true });
for (const m of MODELS) {
  const from = path.join(ASSET_SRC, m);
  if (!fs.existsSync(from)) { console.error("! missing model " + m + " in build/assets/"); process.exit(1); }
  fs.copyFileSync(from, path.join(SITE, "assets", m));
}


/* ---- static files copied as they are: Android's digital asset links file
   proves the app and the site belong together, so the installed app runs
   fullscreen with no browser address bar ---- */
const STATIC = path.join(__dirname, "static");
(function copyDir(from, to){
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
})(STATIC, SITE);

/* ---- service worker: precache everything, then never touch the network ---- */
const stamp = version + "-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(inlined.length);
const sw = `/* Sniper Rage offline cache.
   The whole game is one page with three.js, the soundtrack and every model
   inlined, so precaching that page is precaching the game. Nothing here ever
   needs the network after the first visit. CACHE is stamped with the build so
   a new deploy replaces the old copy instead of being shadowed by it. */
const CACHE = "sniper-rage-${stamp}";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png",
${MODELS.map(m => '  "./assets/' + m + '"').join(",\n")}].filter(Boolean);

const VERSION = "${version}";
const FILES = ${JSON.stringify([["./index.html", Buffer.byteLength(site)]].concat(BLOBS.map(b => ["./assets/" + b.name, b.size])))};
const EXPECT = FILES.reduce((a, f) => a + f[1], 0);
function tell(msg){ self.clients.matchAll({includeUncontrolled:true}).then(cs => cs.forEach(c => c.postMessage(msg))); }

/* The page is the whole game, so it is fetched by hand to report progress to
   the update banner while the player keeps playing the old version. */
let got = 0, last = 0;
async function fetchOne(c, url, size){
  // hashed files never change: reuse them from the previous version's cache
  if (url.indexOf("/assets/x-") >= 0) { const old = await caches.match(url); if (old) { await c.put(url, old); got += size; return; } }
  const res = await fetch(url, {cache:"no-store"});
  if (!res.ok || !res.body) { await c.add(url); got += size; return; }
  const reader = res.body.getReader(), parts = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    parts.push(value); got += value.length;
    const pct = Math.min(99, Math.floor(got / EXPECT * 100));
    if (pct !== last) { last = pct; tell({type:"sr-progress", version:VERSION, pct}); }
  }
  const type = res.headers.get("content-type") || "application/octet-stream";
  const r = new Response(new Blob(parts, {type}), {headers:{"content-type":type}});
  if (url === "./index.html") await c.put("./", r.clone());
  await c.put(url, r);
}
async function fetchPage(c){
  for (const [u, n] of FILES) await fetchOne(c, u, n);
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try { await fetchPage(c); } catch (err) { await Promise.all(FILES.map(f => c.add(f[0]).catch(() => null))); }
    // the rest one at a time, so a single failure cannot abort the install
    await Promise.all(ASSETS.filter(u => u !== "./" && u !== "./index.html").map(u => c.add(u).catch(() => null)));
    tell({type:"sr-ready", version:VERSION});
    // a first install takes over at once; an update waits for the player's tap
    const old = await caches.keys();
    // builds before v31 have no update banner to ask with, so take over from those directly
    if (!old.some(k => /^sniper-rage-v[0-9]+-/.test(k) && k !== CACHE)) self.skipWaiting();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "sr-skip") self.skipWaiting();
  if (e.data === "sr-version" && e.source) e.source.postMessage({type:"sr-version", version:VERSION});
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
`;
fs.writeFileSync(path.join(SITE, "sw.js"), sw);

/* a plain file list so the deploy step has nothing to guess */
const list = fs.readdirSync(SITE).filter(f => fs.statSync(path.join(SITE, f)).isFile())
  .map(f => ({ f, bytes: fs.statSync(path.join(SITE, f)).size }));
console.log("public/sniper-rage.html  " + (fs.statSync(path.join(OUT, "sniper-rage.html")).size / 1048576).toFixed(2) + " MB  (standalone)");
console.log("public/");
for (const x of list) console.log("  " + x.f.padEnd(26) + (x.bytes / 1024).toFixed(0).padStart(7) + " KB");
console.log("cache stamp: " + stamp);

/* ---- the Android app's update bundle ----
   The installed app carries the game inside it and never loads it from the
   web. To update it on the screen, it reads app/update.json, downloads this
   zip of the hosted site and switches to it. Stored, not deflated: almost
   everything inside is already compressed. */
(function makeBundle(){
  const APPDIR = path.join(SITE, "app");
  fs.rmSync(APPDIR, { recursive: true, force: true });
  fs.mkdirSync(APPDIR, { recursive: true });
  const files = [["index.html", path.join(SITE, "index.html")]]
    .concat(["icon-192.png","icon-512.png","icon-512-maskable.png","manifest.webmanifest"].map(f => [f, path.join(SITE, f)]))
    .concat(fs.readdirSync(path.join(SITE, "assets")).map(f => ["assets/" + f, path.join(SITE, "assets", f)]))
    .filter(f => fs.existsSync(f[1]));
  const T = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c; }
  const crc = b => { let c = -1; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const local = [], central = []; let off = 0;
  for (const [name, file] of files) {
    const data = fs.readFileSync(file), nm = Buffer.from(name), c = crc(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(c, 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    local.push(h, nm, data);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt32LE(c, 16);
    d.writeUInt32LE(data.length, 20); d.writeUInt32LE(data.length, 24); d.writeUInt16LE(nm.length, 28); d.writeUInt32LE(off, 42);
    central.push(d, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  const zipName = "bundle-" + version + ".zip";
  fs.writeFileSync(path.join(APPDIR, zipName), Buffer.concat(local.concat([cd, e])));
  fs.writeFileSync(path.join(APPDIR, "update.json"), JSON.stringify({ version, url: "https://sniper-rage.vercel.app/app/" + zipName }, null, 2));
  console.log("  app bundle", zipName, Math.round((off + cd.length) / 1048576), "MB");
})();
