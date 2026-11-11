/* Headless boot harness for Sniper Rage.
   jsdom has no WebGL, so getContext is answered by a mock that returns
   plausible values for everything three.js asks at start-up. The point is not
   to render anything: it is to run the real game code, with the real three.js,
   so the game logic can be exercised and asserted on.                      */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const GL_ENUMS = {};
function glMock() {
  const tex = () => ({ __t: 1 });
  const base = {
    canvas: null,
    drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getExtension(name) {
      if (/texture_float|standard_derivatives|element_index_uint|depth_texture|instanced_arrays|vertex_array_object|texture_filter_anisotropic|blend_minmax|frag_depth|shader_texture_lod|color_buffer_float/i.test(name))
        return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 1, loseContext() {}, drawBuffersWEBGL() {}, createVertexArrayOES: tex, bindVertexArrayOES() {}, deleteVertexArrayOES() {} };
      if (/debug_renderer_info/i.test(name)) return { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 };
      return null;
    },
    getParameter(p) {
      // the handful three actually branches on
      if (p === 0x0d33) return 4096;        // MAX_TEXTURE_SIZE
      if (p === 0x851c) return 4096;        // MAX_CUBE_MAP_TEXTURE_SIZE
      if (p === 0x8872) return 16;          // MAX_TEXTURE_IMAGE_UNITS
      if (p === 0x8b4d) return 32;          // MAX_COMBINED_TEXTURE_IMAGE_UNITS
      if (p === 0x8b4c) return 16;          // MAX_VERTEX_TEXTURE_IMAGE_UNITS
      if (p === 0x8869) return 16;          // MAX_VERTEX_ATTRIBS
      if (p === 0x8dfb) return 1024;        // MAX_VERTEX_UNIFORM_VECTORS
      if (p === 0x8dfd) return 1024;        // MAX_FRAGMENT_UNIFORM_VECTORS
      if (p === 0x8dfc) return 30;          // MAX_VARYING_VECTORS
      if (p === 0x0d3a) return [1, 1];      // MAX_VIEWPORT_DIMS
      if (p === 0x1f00 || p === 0x1f01 || p === 0x1f02) return "mock";
      if (p === 0x846d || p === 0x846e) return [1, 1];
      return 1;
    },
    getShaderPrecisionFormat() { return { rangeMin: 127, rangeMax: 127, precision: 23 }; },
    getProgramParameter() { return true; },
    getShaderParameter() { return true; },
    getProgramInfoLog() { return ""; },
    getShaderInfoLog() { return ""; },
    getError() { return 0; },
    getActiveUniform() { return { name: "u", type: 0x1406, size: 1 }; },
    getActiveAttrib() { return { name: "a", type: 0x1406, size: 1 }; },
    getUniformLocation() { return { __u: 1 }; },
    getAttribLocation() { return 0; },
    getContextAttributes() { return { alpha: true, antialias: true, depth: true, stencil: true }; },
    getSupportedExtensions() { return []; },
    isContextLost() { return false; },
    createTexture: tex, createBuffer: tex, createFramebuffer: tex, createRenderbuffer: tex,
    createProgram: tex, createShader: tex, createVertexArray: tex,
    checkFramebufferStatus() { return 0x8cd5; }, // FRAMEBUFFER_COMPLETE
    readPixels() {},
  };
  // everything else three may call is a silent no-op
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "string" && /^[A-Z0-9_]+$/.test(k)) {
        if (!(k in GL_ENUMS)) GL_ENUMS[k] = Object.keys(GL_ENUMS).length + 0x9000;
        return GL_ENUMS[k];
      }
      return function () { return undefined; };
    },
    has() { return true; },
  });
}

function boot(htmlPath, opts) {
  opts = opts || {};
  const html = fs.readFileSync(htmlPath, "utf8");
  // the page pulls three from a CDN that this sandbox cannot reach; swap in the
  // same r128 build from disk so the real library is what runs
  const three = fs.readFileSync(path.join(__dirname, "vendor/three.min.js"), "utf8");
  const patched = html.replace(
    /<script src="https:\/\/cdnjs[^"]*"><\/script>/,
    '<script>' + three.replace(/<\/script>/gi, "<\\/script>") + '</script>'
  );

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => errors.push(String(e && e.message || e)));
  if (opts.verbose) vc.sendTo(console);

  const dom = new JSDOM(patched, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "https://sniper.test/",
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = function (type) {
        if (/webgl/i.test(type)) { const g = glMock(); g.canvas = this; return g; }
        // 2d: enough for the canvas textures the game bakes
        return {
          canvas: this,
          fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
          moveTo() {}, lineTo() {}, closePath() {}, save() {}, restore() {}, translate() {},
          rotate() {}, scale() {}, drawImage() {}, putImageData() {}, setTransform() {},
          createRadialGradient() { return { addColorStop() {} }; },
          createLinearGradient() { return { addColorStop() {} }; },
          createPattern() { return null; },
          getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; },
          measureText() { return { width: 10 }; },
          fillText() {}, strokeText() {},
          set fillStyle(v) {}, get fillStyle() { return "#000"; },
          set strokeStyle(v) {}, get strokeStyle() { return "#000"; },
          set font(v) {}, get font() { return "10px sans"; },
          set lineWidth(v) {}, get lineWidth() { return 1; },
          set globalAlpha(v) {}, get globalAlpha() { return 1; },
          set globalCompositeOperation(v) {}, get globalCompositeOperation() { return "source-over"; },
          set shadowBlur(v) {}, get shadowBlur() { return 0; },
          set shadowColor(v) {}, get shadowColor() { return "#000"; },
          set lineCap(v) {}, get lineCap() { return "butt"; },
          set lineJoin(v) {}, get lineJoin() { return "miter"; },
          set textAlign(v) {}, get textAlign() { return "start"; },
          set textBaseline(v) {}, get textBaseline() { return "alphabetic"; },
        };
      };
      win.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,";
      win.requestAnimationFrame = cb => setTimeout(() => cb(Date.now()), 1000); // slow: tests drive frames by hand
      win.cancelAnimationFrame = id => clearTimeout(id);
      win.matchMedia = q => ({ matches: /pointer:\s*coarse/.test(q) ? !!opts.touch : false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      win.AudioContext = undefined; win.webkitAudioContext = undefined;  // audio stays off
      win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      win.HTMLMediaElement.prototype.pause = function () {};
      win.HTMLMediaElement.prototype.load = function () {};
      win.URL.createObjectURL = () => "blob:mock";
      win.URL.revokeObjectURL = () => {};
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      Object.defineProperty(win.navigator, "serviceWorker", {
        value: {
          register() { const p = Promise.reject(new Error("no sw in tests")); p.catch(() => {}); return p; },
          ready: new Promise(() => {}),
          addEventListener() {}
        },
        configurable: true
      });
      win.onerror = null;
      win.addEventListener("error", e => errors.push(String(e.message || e)));
      // pre-seed localStorage so a cold start with a stored mission can be tested
      if (opts.storage) for (const k in opts.storage) win.localStorage.setItem(k, opts.storage[k]);
      Object.defineProperty(win, "innerWidth", { value: 1280, writable: true });
      Object.defineProperty(win, "innerHeight", { value: 720, writable: true });
      Object.defineProperty(win.screen, "orientation", { value: { lock: () => Promise.reject(new Error("no")), type: "landscape-primary" }, configurable: true });
      win.Element.prototype.requestFullscreen = () => Promise.reject(new Error("no"));
      win.HTMLElement.prototype.requestPointerLock = function () {};
      win.Document.prototype.exitPointerLock = function () {};
    },
  });
  return { dom, win: dom.window, errors };
}

module.exports = { boot, glMock };
