// Junta videos con los mismos patrones de la página y los guarda en data/cache.json.
// La página lee ese archivo primero: no gasta cuota en vivo ni necesita API key.
//
// Uso:  node scripts/cache.mjs
// Key:  variable YT_API_KEY, o la de config.js si no existe.
// SEARCHES: cuántas búsquedas hacer (cada una ≈ 101 unidades). Por defecto 60,
// para dejar ~4,000 unidades del día a la búsqueda en vivo.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { buildSearch } from "../js/patterns.js";
import { searchVideos, getDetails } from "../js/youtube.js";

const OUT = new URL("../data/cache.json", import.meta.url);
const SEARCHES = Number(process.env.SEARCHES || 60);
const MAX_VIEWS = 1000;  // el filtro más alto de la página; ella aplica los demás
const MAX_VIDEOS = 5000; // los más recientes
const MAX_AGE_DAYS = 60; // después las vistas ya no son confiables

function readKey() {
  if (process.env.YT_API_KEY) return process.env.YT_API_KEY;
  try {
    const cfg = readFileSync(new URL("../config.js", import.meta.url), "utf8");
    return /apiKey:\s*"([^"]+)"/.exec(cfg)?.[1];
  } catch {
    return undefined;
  }
}

function readCache() {
  if (!existsSync(OUT)) return [];
  try {
    return JSON.parse(readFileSync(OUT, "utf8")).videos || [];
  } catch {
    return [];
  }
}

// Una línea por video para que los diffs de git sean legibles.
function writeCache(videos) {
  mkdirSync(new URL(".", OUT), { recursive: true });
  const lines = videos.map((v) => JSON.stringify(v)).join(",\n");
  writeFileSync(OUT, `{"updatedAt":"${new Date().toISOString()}","videos":[\n${lines}\n]}\n`);
}

const key = readKey();
if (!key) {
  console.error("Falta la API key: define YT_API_KEY o ponla en config.js");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
const old = readCache().filter((v) => v.fetchedAt >= cutoff);
const known = new Set(old.map((v) => v.id));
const found = [];
let done = 0;

for (; done < SEARCHES; done++) {
  const { q, start, end, when } = buildSearch("any");
  try {
    const ids = (await searchVideos({ q, start, end, duration: "any" }, key)).filter((id) => !known.has(id));
    const details = await getDetails(ids, key);
    const good = details.filter((v) => v.embeddable && !v.madeForKids && v.views <= MAX_VIEWS);
    for (const v of good) {
      known.add(v.id);
      found.push({ ...v, query: q, when, fetchedAt: today });
    }
    console.log(`${String(done + 1).padStart(3)}. ${q.padEnd(22)} ${when.padEnd(20)} +${good.length}`);
  } catch (err) {
    if (err.reason === "quotaExceeded" || err.reason === "dailyLimitExceeded") {
      console.warn("Se acabó la cuota; guardando lo que hay.");
      break;
    }
    console.warn(`${String(done + 1).padStart(3)}. ${q}: ${err.message}`);
  }
}

const videos = [...found, ...old].slice(0, MAX_VIDEOS);
writeCache(videos);
console.log(`\n${done} búsquedas · ${found.length} nuevos · ${videos.length} en caché`);
