// Pequeño envoltorio de localStorage que no truena en modo privado.

const PREFIX = "rarezas:";

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* sin almacenamiento: seguimos en memoria */
  }
}

// La cuota de YouTube se reinicia a medianoche hora del Pacífico.
function quotaDay() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function getQuota() {
  const q = load("quota", { day: "", used: 0 });
  return q.day === quotaDay() ? q.used : 0;
}

export function addQuota(units) {
  const used = getQuota() + units;
  save("quota", { day: quotaDay(), used });
  return used;
}
