/* Guest identity.

   There are no accounts. A player is whoever they say they are for the length
   of a match, so the only jobs here are to make a name safe to show on other
   people's screens and to keep two players in one room from sharing it. */
const CALLSIGNS = ["VIPER", "GHOST", "RAVEN", "COBRA", "HAWK", "WOLF", "LYNX", "ONYX", "EMBER", "NOMAD", "ATLAS", "ORION"];

function cleanName(raw) {
  let s = typeof raw === "string" ? raw : "";
  // letters, digits, space, dash and underscore only: nothing that can be markup
  s = s.normalize("NFKC").replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 14).toUpperCase();
  if (s.length < 2) s = CALLSIGNS[Math.floor(Math.random() * CALLSIGNS.length)] + "-" + String(Math.floor(10 + Math.random() * 90));
  return s;
}

function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  for (let i = 2; i < 99; i++) {
    const n = name.slice(0, 12) + " " + i;
    if (!taken.has(n)) return n;
  }
  return name;
}

/* Room codes are read aloud and typed on phones, so no 0/O, 1/I/L or the
   like. 31^5 is about 28 million, far more than there will ever be rooms. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function roomCode() {
  let s = "";
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
function normaliseCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

module.exports = { cleanName, uniqueName, roomCode, normaliseCode };
