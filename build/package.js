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

let html = fs.readFileSync(SRC, "utf8");
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
const site = inlined.replace(
  /<title>/,
  '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="theme-color" content="#0a0c0e">\n<title>'
);
if (site === inlined) { console.error("! could not find <title> to anchor the manifest link"); process.exit(1); }
fs.writeFileSync(path.join(SITE, "index.html"), site);

const manifest = {
  name: "Sniper Rage",
  short_name: "Sniper Rage",
  description: "Tactical sniper operations. Five sectors, endless waves, frag grenades, offline play.",
  start_url: "./index.html",
  scope: "./",
  display: "fullscreen",
  orientation: "landscape",
  background_color: "#050708",
  theme_color: "#0a0c0e",
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
const MODELS = ["ruins.glb", "construction.glb", "stairs.glb", "props.glb"];
const referenced = [...new Set((inlined.match(/assets\/[a-zA-Z0-9_.-]+\.glb/g) || []))]
  .map(s => s.replace("assets/", ""));
const missingRef = referenced.filter(m => !MODELS.includes(m));
if (missingRef.length) { console.error("! the page fetches models the packager does not ship:", missingRef); process.exit(1); }
fs.mkdirSync(path.join(SITE, "assets"), { recursive: true });
for (const m of MODELS) {
  const from = path.join(ASSET_SRC, m);
  if (!fs.existsSync(from)) { console.error("! missing model " + m + " in build/assets/"); process.exit(1); }
  fs.copyFileSync(from, path.join(SITE, "assets", m));
}

/* ---- service worker: precache everything, then never touch the network ---- */
const stamp = "v" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + String(inlined.length);
const sw = `/* Sniper Rage offline cache.
   The whole game is one page with three.js, the soundtrack and every model
   inlined, so precaching that page is precaching the game. Nothing here ever
   needs the network after the first visit. CACHE is stamped with the build so
   a new deploy replaces the old copy instead of being shadowed by it. */
const CACHE = "sniper-rage-${stamp}";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png",
${MODELS.map(m => '  "./assets/' + m + '"').join(",\n")}];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // one at a time, so a single failure cannot abort the whole install
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
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
