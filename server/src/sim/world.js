/* The level, as the server knows it.

   world.json is exported from the real game by build/export-world.js, so the
   geometry here is the geometry the players see: same cover slots, same spawn
   points, same walls. Occluders arrive as oriented boxes, an inverse world
   matrix plus local bounds, and a line of sight test is a ray against each
   box in that box's own space. No three.js, no GPU. */
const path = require("path");
const data = require(path.join(__dirname, "..", "..", "data", "world.json"));

const C = data.constants;
const SECTORS = data.sectors;

function sectorForWave(w) {
  return Math.floor((Math.max(1, w) - 1) / C.SECTOR_EVERY) % SECTORS.length;
}

/* Ray against one oriented box. The ray is taken into the box's local space
   with the inverse matrix. Position and direction both go through the same
   linear map, so the parameter t still measures world distance along the ray
   and the classic slab test can be used unchanged. Returns the entry distance
   or -1. */
function rayBox(b, ox, oy, oz, dx, dy, dz, far) {
  const m = b.inv;
  const lox = m[0] * ox + m[4] * oy + m[8] * oz + m[12];
  const loy = m[1] * ox + m[5] * oy + m[9] * oz + m[13];
  const loz = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
  const ldx = m[0] * dx + m[4] * dy + m[8] * dz;
  const ldy = m[1] * dx + m[5] * dy + m[9] * dz;
  const ldz = m[2] * dx + m[6] * dy + m[10] * dz;
  let t0 = 0, t1 = far;
  const lo = [lox, loy, loz], ld = [ldx, ldy, ldz];
  for (let i = 0; i < 3; i++) {
    const mn = b.min[i], mx = b.max[i];
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < mn || lo[i] > mx) return -1;
    } else {
      let a = (mn - lo[i]) / ld[i], c = (mx - lo[i]) / ld[i];
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}

/* Is the straight line from a to b blocked by level geometry?
   `trim` is how much is cut off the far end, so a target standing against a
   wall or crouched behind the lip of his own cover is not counted as hidden
   by the thing he is touching. */
function blocked(sectorIndex, ax, ay, az, bx, by, bz, trim) {
  const s = SECTORS[sectorIndex];
  let dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  const far = len - (trim === undefined ? 0.4 : trim);
  if (far <= 0.01) return false;
  dx /= len; dy /= len; dz /= len;
  const occ = s.occluders;
  for (let i = 0; i < occ.length; i++) {
    const t = rayBox(occ[i], ax, ay, az, dx, dy, dz, far);
    if (t >= 0 && t < far) return true;
  }
  return false;
}

/* Where the n-th player stands when a sector loads: spread along the deck so
   a full room does not spawn inside one another. */
function spawnPoint(sectorIndex, slot) {
  const v = SECTORS[sectorIndex].vantage;
  const cols = 4;
  const col = slot % cols, row = Math.floor(slot / cols) % 3;
  const span = Math.min(9, (v.x1 - v.x0) * 0.6);
  const x = v.sx + (col - (cols - 1) / 2) * (span / (cols - 1));
  const z = Math.min(v.z1 - 0.4, v.sz + row * 1.5);
  return {
    x: Math.max(v.x0 + 0.4, Math.min(v.x1 - 0.4, x)),
    y: v.y + C.EYE,
    z: Math.max(v.z0 + 0.4, z)
  };
}

module.exports = {
  constants: C, SECTORS,
  weapons: data.weapons, etypes: data.etypes, grenade: data.grenade,
  sectorForWave, blocked, rayBox, spawnPoint
};
