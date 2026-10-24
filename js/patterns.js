// Generadores de búsquedas basadas en nombres de archivo por defecto.
// Cada patrón devuelve un texto de búsqueda. Los que usan fecha reciben
// un Date dentro de la ventana de tiempo elegida.

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pad = (n, len) => String(n).padStart(len, "0");
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;

export const PATTERNS = [
  // Numerados (cámaras y teléfonos)
  { id: "IMG",   weight: 5, make: () => `IMG_${pad(rand(0, 9999), 4)}` },
  { id: "MOV",   weight: 3, make: () => `MOV_${pad(rand(0, 9999), 4)}` },
  { id: "MVI",   weight: 3, make: () => `MVI_${pad(rand(0, 9999), 4)}` },
  { id: "DSC",   weight: 3, make: () => `DSC_${pad(rand(0, 9999), 4)}` },
  { id: "DSCN",  weight: 2, make: () => `DSCN${pad(rand(0, 9999), 4)}` },
  { id: "CIMG",  weight: 1, make: () => `CIMG${pad(rand(0, 9999), 4)}` },
  { id: "MAH",   weight: 1, make: () => `MAH${pad(rand(0, 99999), 5)}` },
  { id: "GOPR",  weight: 1, make: () => `GOPR${pad(rand(0, 9999), 4)}` },
  { id: "SAM",   weight: 1, make: () => `SAM_${pad(rand(0, 9999), 4)}` },
  { id: "M2U",   weight: 1, make: () => `M2U${pad(rand(0, 99999), 5)}` },

  // Con fecha en el nombre (Android, webcams de Windows, Pixel)
  { id: "VID",   weight: 4, dated: true, make: (d) => `VID_${ymd(d)}` },
  { id: "WIN",   weight: 1, dated: true, make: (d) => `WIN_${ymd(d)}` },
  { id: "PXL",   weight: 1, dated: true, minYear: 2020, make: (d) => `PXL_${ymd(d)}` },

  // Títulos genéricos
  { id: "MyMovie",  weight: 1, make: () => `"My Movie ${rand(1, 30)}"` },
  { id: "Video",    weight: 1, make: () => `"Video ${rand(1, 200)}"` },
  { id: "untitled", weight: 1, make: () => `untitled ${rand(1, 50)}` },
];

// Elige un patrón ponderado compatible con el año.
export function pickPattern(year) {
  const usable = PATTERNS.filter((p) => !p.minYear || year >= p.minYear);
  const total = usable.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of usable) {
    if ((r -= p.weight) < 0) return p;
  }
  return usable[0];
}

// Títulos que "parecen" nombre de archivo sin editar.
export const FILENAME_TITLE =
  /^\s*(IMG|MOV|MVI|DSC|DSCN|CIMG|MAH|GOPR|GH\d{2}|GX\d{2}|SAM|M2U|VID|WIN|PXL|DJI|P\d{3}|MOVI|CLIP|HDV)[_ -]?\d{3,}/i;
export const GENERIC_TITLE = /^\s*(my movie|video|untitled|new video|clip)\s*\d*\s*$/i;

export const looksLikeFilename = (title) => FILENAME_TITLE.test(title) || GENERIC_TITLE.test(title);

// Ventana de tiempo aleatoria de ~1 mes dentro del año (o de cualquier año).
// Ventanas pequeñas hacen que salgan videos menos populares.
export function randomWindow(yearSetting) {
  const now = new Date();
  const firstYear = 2006;
  const year = yearSetting === "any" ? rand(firstYear, now.getFullYear()) : Number(yearSetting);
  const lastMonth = year === now.getFullYear() ? now.getMonth() : 11;
  const month = rand(0, lastMonth);
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  if (end > now) end.setTime(now.getTime());
  const day = new Date(start.getTime() + Math.random() * (end - start));
  return { year, start, end, day };
}

// Año completo (hasta hoy si es el año actual).
export function yearRange(year) {
  const now = new Date();
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Math.min(Date.UTC(year + 1, 0, 1), now.getTime()));
  return { start, end };
}
