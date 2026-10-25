import { buildSearch, looksLikeFilename } from "./patterns.js";
import { searchVideos, getDetails, formatDuration, durationSeconds, isShort, loadPlayerApi } from "./youtube.js";
import { load, save, getQuota } from "./storage.js";

// ---------- Estado ----------
const $ = (id) => document.getElementById(id);

const state = {
  key: window.RAREZAS_CONFIG?.apiKey || load("apiKey", ""),
  pool: [],                         // videos listos para mostrar
  history: [],                      // lo visto en esta sesión
  pos: -1,                          // posición en history
  seen: new Set(load("seen", [])),  // ids ya mostrados (persistente)
  hidden: new Set(load("hidden", [])),
  favs: load("favs", []),
  // Se mezcla con los valores por defecto para que filtros nuevos tengan valor en navegadores con filtros viejos guardados.
  filters: { year: "any", views: "10", duration: "any", strict: false, noShorts: true, tv: false, ...load("filters", {}) },
  cache: [],                        // videos de data/cache.json
  busy: false,
  player: null,
};

const MAX_SEARCHES_PER_CLICK = 3; // tope para no quemar la cuota en una sola búsqueda
const SEEN_LIMIT = 5000;

// ---------- UI: filtros ----------
function initFilters() {
  const yearSel = $("f-year");
  yearSel.add(new Option("Cualquiera", "any"));
  for (let y = new Date().getFullYear(); y >= 2006; y--) yearSel.add(new Option(String(y), String(y)));

  yearSel.value = state.filters.year;
  $("f-views").value = state.filters.views;
  $("f-duration").value = state.filters.duration;
  $("f-strict").checked = state.filters.strict;
  $("f-noshorts").checked = state.filters.noShorts;
  $("f-tv").checked = state.filters.tv;

  const onChange = () => {
    const prev = searchSignature();
    state.filters = {
      year: yearSel.value,
      views: $("f-views").value,
      duration: $("f-duration").value,
      strict: $("f-strict").checked,
      noShorts: $("f-noshorts").checked,
      tv: $("f-tv").checked,
    };
    save("filters", state.filters);
    // Si cambió algo que afecta la búsqueda, la cola ya no sirve.
    if (prev !== searchSignature()) {
      state.pool = [];
      savePool();
    }
    renderStats();
  };
  ["f-year", "f-views", "f-duration", "f-strict", "f-noshorts", "f-tv"].forEach((id) => $(id).addEventListener("change", onChange));
}

function renderStats() {
  $("s-quota").textContent = `${getQuota().toLocaleString("es-MX")} / 10,000`;
  $("s-pool").textContent = state.pool.length;
  $("s-seen").textContent = state.seen.size.toLocaleString("es-MX");
  $("fav-count").textContent = state.favs.length;
}

const setStatus = (msg) => ($("status").textContent = msg || "");

// ---------- Cola persistente ----------
// La cola sobrante se guarda para no tirar búsquedas (y cuota) al cerrar la página.
// Solo se reusa con los mismos filtros de búsqueda y si no es muy vieja (las vistas cambian).
const POOL_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Filtros que afectan qué videos entran a la cola (el modo TV no).
const searchSignature = () => JSON.stringify({ ...state.filters, tv: null });

function savePool() {
  save("pool", { signature: searchSignature(), savedAt: Date.now(), items: state.pool });
}

function restorePool() {
  const saved = load("pool", null);
  if (!saved || saved.signature !== searchSignature() || Date.now() - saved.savedAt > POOL_MAX_AGE) return;
  state.pool = (saved.items || []).filter((v) => !state.seen.has(v.id) && !state.hidden.has(v.id));
}

// ---------- Búsqueda ----------
// Mismos cortes que videoDuration de search.list.
const DURATION_OK = {
  any: () => true,
  short: (s) => s < 240,
  medium: (s) => s >= 240 && s <= 1200,
  long: (s) => s > 1200,
};

function passes(v) {
  if (!v.embeddable || v.madeForKids) return false;
  if (state.seen.has(v.id) || state.hidden.has(v.id)) return false;
  if (v.views > Number(state.filters.views)) return false;
  if (state.filters.strict && !looksLikeFilename(v.title)) return false;
  if (state.filters.noShorts && isShort(v)) return false;
  // Año y duración ya los filtra la búsqueda en vivo, pero el caché trae de todo.
  if (state.filters.year !== "any" && v.publishedAt.slice(0, 4) !== state.filters.year) return false;
  if (!DURATION_OK[state.filters.duration](durationSeconds(v.duration))) return false;
  return true;
}

// ---------- Caché ----------
// data/cache.json lo genera scripts/cache.mjs cada noche (GitHub Actions).
// Sacar videos de ahí no gasta cuota y no necesita API key.
async function loadCache() {
  try {
    const res = await fetch("data/cache.json", { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    state.cache = data.videos || [];
  } catch {
    /* sin caché: solo búsqueda en vivo */
  }
}

function refillFromCache() {
  const good = state.cache.filter(passes);
  good.sort(() => Math.random() - 0.5);
  state.pool.push(...good.slice(0, 50));
  savePool();
}

async function refill() {
  refillFromCache();
  if (!state.key) return; // sin key, solo hay lo que tenga el caché
  for (let i = 0; i < MAX_SEARCHES_PER_CLICK && state.pool.length === 0; i++) {
    const { q, start, end, when } = buildSearch(state.filters.year);
    setStatus(`Sintonizando «${q}» · ${when}…`);

    const ids = await searchVideos({ q, start, end, duration: state.filters.duration }, state.key);
    const fresh = ids.filter((id) => !state.seen.has(id) && !state.hidden.has(id));
    const details = await getDetails(fresh, state.key);
    const good = details.filter(passes).map((v) => ({ ...v, query: q, when }));

    // Barajar para no ver siempre el primero que dio YouTube.
    good.sort(() => Math.random() - 0.5);
    state.pool.push(...good);
    savePool();
    renderStats();
  }
}

// ---------- Reproducción ----------
async function next() {
  if (state.busy) return;
  if (!state.key && !state.cache.length) return askKey();

  // Si retrocedimos, primero avanzamos por el historial.
  if (state.pos < state.history.length - 1) {
    state.pos++;
    return show(state.history[state.pos]);
  }

  state.busy = true;
  $("btn-next").disabled = true;
  try {
    if (state.pool.length === 0) await refill();
    const v = state.pool.shift();
    savePool();
    if (!v) {
      setStatus(
        state.key
          ? "Nada pasó los filtros en esta vuelta. Prueba subir las vistas máximas o quitar «solo nombres de archivo»."
          : "El caché no tiene más videos con estos filtros. Prueba otros filtros o agrega tu API key para buscar en vivo."
      );
      return;
    }
    state.history.push(v);
    state.pos = state.history.length - 1;
    markSeen(v.id);
    show(v);
  } catch (err) {
    handleApiError(err);
  } finally {
    state.busy = false;
    $("btn-next").disabled = false;
    renderStats();
  }
}

function prev() {
  if (state.pos <= 0) return;
  state.pos--;
  show(state.history[state.pos]);
}

function markSeen(id) {
  state.seen.add(id);
  let arr = [...state.seen];
  if (arr.length > SEEN_LIMIT) arr = arr.slice(-SEEN_LIMIT);
  save("seen", arr);
}

async function show(v) {
  setStatus("");
  $("screen-msg").hidden = true;
  $("v-title").textContent = v.title;
  const date = new Date(v.publishedAt).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
  $("v-meta").textContent = `${v.channel} · ${date} · ${formatDuration(v.duration)}`;
  $("v-rarity").textContent =
    v.views === 0 ? "Nadie lo había visto antes que tú." : `${v.views.toLocaleString("es-MX")} ${v.views === 1 ? "vista" : "vistas"} en total`;
  // «Teletransporte»: de qué búsqueda salió. Los guardados antes de esta función no lo traen.
  const origin = $("v-origin");
  origin.hidden = !v.query;
  if (v.query) {
    origin.replaceChildren("Sintonizado con ", Object.assign(document.createElement("code"), { textContent: v.query }), ` · ${v.when}`);
  }
  const link = $("v-link");
  link.href = `https://www.youtube.com/watch?v=${v.id}`;
  link.hidden = false;
  renderFavButton();

  const YT = await loadPlayerApi();
  if (!state.player) {
    state.player = new YT.Player("player", {
      videoId: v.id,
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED && state.filters.tv) next();
        },
        // 100: borrado/privado · 101/150: no se puede incrustar
        onError: () => {
          setStatus("Este video no se puede reproducir aquí, saltando…");
          setTimeout(next, 800);
        },
      },
    });
  } else {
    state.player.loadVideoById(v.id);
  }
}

function current() {
  return state.history[state.pos];
}

// ---------- Guardados / ocultos ----------
function isFav(id) {
  return state.favs.some((f) => f.id === id);
}

function toggleFav() {
  const v = current();
  if (!v) return;
  if (isFav(v.id)) {
    state.favs = state.favs.filter((f) => f.id !== v.id);
  } else {
    state.favs.unshift({ id: v.id, title: v.title, channel: v.channel, thumb: v.thumb, views: v.views, publishedAt: v.publishedAt, query: v.query, when: v.when, savedAt: Date.now() });
  }
  save("favs", state.favs);
  renderFavButton();
  renderStats();
}

function renderFavButton() {
  const v = current();
  const on = v && isFav(v.id);
  $("btn-fav").textContent = on ? "★ Guardado" : "☆ Guardar";
  $("btn-fav").classList.toggle("active", !!on);
}

function hideCurrent() {
  const v = current();
  if (!v) return;
  state.hidden.add(v.id);
  save("hidden", [...state.hidden]);
  state.favs = state.favs.filter((f) => f.id !== v.id);
  save("favs", state.favs);
  // Lo sacamos del historial (todas sus copias) para que «anterior» no lo regrese.
  const before = state.history.slice(0, state.pos).filter((x) => x.id !== v.id).length;
  state.history = state.history.filter((x) => x.id !== v.id);
  // Si estábamos a mitad del historial, seguimos con el que venía después.
  if (before < state.history.length) {
    state.pos = before;
    show(state.history[before]);
  } else {
    state.pos = state.history.length - 1;
    next();
  }
}

function openFavs() {
  const list = $("fav-list");
  list.innerHTML = "";
  $("fav-empty").hidden = state.favs.length > 0;
  for (const f of state.favs) {
    const li = document.createElement("li");
    const img = document.createElement("img");
    img.src = f.thumb || "";
    img.alt = "";
    const text = document.createElement("div");
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = f.title;
    const m = document.createElement("div");
    m.className = "m";
    m.textContent = `${f.channel} · ${new Date(f.publishedAt).getFullYear()} · ${f.views} vistas al guardarlo`;
    text.append(t, m);

    const actions = document.createElement("div");
    actions.className = "actions";
    const play = document.createElement("button");
    play.className = "ghost small";
    play.textContent = "Ver";
    play.onclick = () => {
      $("dlg-favs").close();
      state.history.push({ ...f, duration: "" });
      state.pos = state.history.length - 1;
      show(state.history[state.pos]);
    };
    const del = document.createElement("button");
    del.className = "ghost small";
    del.textContent = "Quitar";
    del.onclick = () => {
      state.favs = state.favs.filter((x) => x.id !== f.id);
      save("favs", state.favs);
      renderStats();
      renderFavButton();
      openFavs();
    };
    actions.append(play, del);
    li.append(img, text, actions);
    list.append(li);
  }
  if (!$("dlg-favs").open) $("dlg-favs").showModal();
}

// ---------- API key ----------
function askKey() {
  $("key-input").value = "";
  $("dlg-key").showModal();
}

function initKeyDialog() {
  $("dlg-key").addEventListener("close", () => {
    if ($("dlg-key").returnValue !== "ok") return;
    const k = $("key-input").value.trim();
    if (!k) return;
    state.key = k;
    save("apiKey", k);
    setStatus("Listo. Pulsa «Siguiente».");
  });
}

function handleApiError(err) {
  console.error(err);
  if (err.reason === "quotaExceeded" || err.reason === "dailyLimitExceeded") {
    setStatus("Se acabó la cuota de hoy (se reinicia a medianoche, hora del Pacífico). Aún puedes ver tus guardados.");
  } else if (err.reason === "keyInvalid" || (err.status === 400 && /key/i.test(err.message))) {
    setStatus("La API key no es válida. Revísala en «Cambiar API key».");
  } else if (err.status === 403) {
    setStatus(`YouTube rechazó la petición: ${err.message}. ¿Activaste YouTube Data API v3 y revisaste las restricciones de la key?`);
  } else {
    setStatus(`Error: ${err.message}`);
  }
}

// ---------- Arranque ----------
async function init() {
  initFilters();
  initKeyDialog();
  restorePool();
  renderStats();

  $("btn-next").onclick = next;
  $("btn-prev").onclick = prev;
  $("btn-fav").onclick = toggleFav;
  $("btn-hide").onclick = hideCurrent;
  $("btn-favs").onclick = openFavs;
  $("btn-close-favs").onclick = () => $("dlg-favs").close();
  $("btn-key").onclick = askKey;

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select, textarea") || document.querySelector("dialog[open]")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // no robar Ctrl+F, Alt+←, etc.
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key.toLowerCase() === "f") toggleFav();
    else if (e.key.toLowerCase() === "t") {
      $("f-tv").checked = !$("f-tv").checked;
      $("f-tv").dispatchEvent(new Event("change"));
      setStatus(`Modo TV ${$("f-tv").checked ? "activado" : "desactivado"}`);
    }
  });

  if (location.protocol === "file:") {
    setStatus("Ábrelo con un servidor local (Live Server en VS Code); YouTube no reproduce desde file://.");
  }
  await loadCache();
  if (!state.key && !state.cache.length) askKey();
}

init();
