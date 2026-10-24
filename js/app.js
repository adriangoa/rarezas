import { pickPattern, randomWindow, looksLikeFilename } from "./patterns.js";
import { searchVideos, getDetails, formatDuration, loadPlayerApi } from "./youtube.js";
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
  filters: load("filters", { year: "any", views: "10", duration: "any", strict: false, tv: false }),
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
  $("f-tv").checked = state.filters.tv;

  const onChange = () => {
    const prev = JSON.stringify({ ...state.filters, tv: null });
    state.filters = {
      year: yearSel.value,
      views: $("f-views").value,
      duration: $("f-duration").value,
      strict: $("f-strict").checked,
      tv: $("f-tv").checked,
    };
    save("filters", state.filters);
    // Si cambió algo que afecta la búsqueda, la cola ya no sirve.
    if (prev !== JSON.stringify({ ...state.filters, tv: null })) state.pool = [];
    renderStats();
  };
  ["f-year", "f-views", "f-duration", "f-strict", "f-tv"].forEach((id) => $(id).addEventListener("change", onChange));
}

function renderStats() {
  $("s-quota").textContent = `${getQuota().toLocaleString("es-MX")} / 10,000`;
  $("s-pool").textContent = state.pool.length;
  $("s-seen").textContent = state.seen.size.toLocaleString("es-MX");
  $("fav-count").textContent = state.favs.length;
}

const setStatus = (msg) => ($("status").textContent = msg || "");

// ---------- Búsqueda ----------
function passes(v) {
  if (!v.embeddable || v.madeForKids) return false;
  if (state.seen.has(v.id) || state.hidden.has(v.id)) return false;
  if (v.views > Number(state.filters.views)) return false;
  if (state.filters.strict && !looksLikeFilename(v.title)) return false;
  return true;
}

async function refill() {
  for (let i = 0; i < MAX_SEARCHES_PER_CLICK && state.pool.length === 0; i++) {
    const win = randomWindow(state.filters.year);
    const pattern = pickPattern(win.year);
    const q = pattern.make(win.day);
    setStatus(`Sintonizando «${q}» · ${win.start.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}…`);

    const ids = await searchVideos({ q, start: win.start, end: win.end, duration: state.filters.duration }, state.key);
    const fresh = ids.filter((id) => !state.seen.has(id) && !state.hidden.has(id));
    const details = await getDetails(fresh, state.key);
    const good = details.filter(passes).map((v) => ({ ...v, query: q }));

    // Barajar para no ver siempre el primero que dio YouTube.
    good.sort(() => Math.random() - 0.5);
    state.pool.push(...good);
    renderStats();
  }
}

// ---------- Reproducción ----------
async function next() {
  if (state.busy) return;
  if (!state.key) return askKey();

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
    if (!v) {
      setStatus("Nada pasó los filtros en esta vuelta. Prueba subir las vistas máximas o quitar «solo nombres de archivo».");
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
    state.favs.unshift({ id: v.id, title: v.title, channel: v.channel, thumb: v.thumb, views: v.views, publishedAt: v.publishedAt, savedAt: Date.now() });
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
  // Lo sacamos del historial para que «anterior» no lo regrese.
  state.history.splice(state.pos, 1);
  state.pos = state.history.length - 1;
  next();
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
      state.history.push({ ...f, duration: "", query: "" });
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
function init() {
  initFilters();
  initKeyDialog();
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
  if (!state.key) askKey();
}

init();
