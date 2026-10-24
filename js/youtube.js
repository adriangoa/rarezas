// Llamadas a la YouTube Data API v3.
// Costos: search.list = 100 unidades, videos.list = 1 unidad.

import { addQuota } from "./storage.js";

const API = "https://www.googleapis.com/youtube/v3";

async function call(endpoint, params, key, cost) {
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  url.searchParams.set("key", key);

  const res = await fetch(url);
  addQuota(cost);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason || "";
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.reason = reason;
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function searchVideos({ q, start, end, duration }, key) {
  const data = await call(
    "search",
    {
      part: "snippet",
      type: "video",
      maxResults: 50,
      q,
      publishedAfter: start?.toISOString(),
      publishedBefore: end?.toISOString(),
      videoDuration: duration === "any" ? undefined : duration,
      videoEmbeddable: "true",
      safeSearch: "strict",
    },
    key,
    100
  );
  return (data.items || []).map((it) => it.id.videoId).filter(Boolean);
}

// Hasta 50 ids por llamada.
export async function getDetails(ids, key) {
  if (!ids.length) return [];
  const data = await call(
    "videos",
    // part=player con maxHeight trae embedWidth/embedHeight: así sabemos si es vertical.
    { part: "snippet,statistics,contentDetails,status,player", id: ids.join(","), maxResults: 50, maxHeight: 360 },
    key,
    1
  );
  return (data.items || []).map((v) => ({
    id: v.id,
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
    views: Number(v.statistics?.viewCount ?? 0),
    duration: v.contentDetails?.duration,
    embeddable: v.status?.embeddable !== false,
    madeForKids: !!v.status?.madeForKids,
    vertical: Number(v.player?.embedHeight) > Number(v.player?.embedWidth),
    shortsTag: /#shorts?\b/i.test(`${v.snippet.title} ${v.snippet.description}`),
  }));
}

// La API no dice si algo es Short. Lo inferimos: etiqueta #shorts, o vertical de ≤3 min
// subido desde que existen los Shorts. Los verticales de antes eran videos normales.
const SHORTS_START = new Date("2020-09-14");
export function isShort(v) {
  if (v.shortsTag) return true;
  return v.vertical && durationSeconds(v.duration) <= 180 && new Date(v.publishedAt) >= SHORTS_START;
}

function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  return m ? [m[1], m[2], m[3]].map((x) => Number(x || 0)) : null;
}

export function durationSeconds(iso) {
  const p = parseDuration(iso);
  return p ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
}

// "PT1M23S" → "1:23"
export function formatDuration(iso) {
  const p = parseDuration(iso);
  if (!p) return "";
  const [h, mi, s] = p;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(mi).padStart(2, "0")}:${ss}` : `${mi}:${ss}`;
}

// Carga la IFrame Player API una sola vez.
let ytReady;
export function loadPlayerApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytReady;
}
