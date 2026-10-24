# Contexto del proyecto: Rarezas

Este archivo es para que un asistente de IA (Claude en VS Code u otro) entienda el proyecto sin tener la conversación original. Mantenlo al día cuando cambien decisiones importantes.

## Qué es

Una página web para explorar videos de YouTube que el algoritmo nunca recomienda: grabaciones caseras subidas tal cual desde el teléfono o la cámara, con títulos de nombre de archivo por defecto (`IMG_4821`, `MVI_0815`, `VID_20120315`) y casi sin vistas, muchas veces cero.

Inspiración: **PetitTube** (ya desaparecido, mostraba videos aleatorios con 0 vistas) y **Astronaut.io** (mismo truco de nombres de archivo, en modo "televisión").

El dueño del proyecto habla español (México). Responde y escribe la interfaz, comentarios y commits en español.

## Stack y decisiones

- **HTML + CSS + JavaScript puro con módulos ES.** Sin frameworks, sin build, sin npm. Se decidió así para que sea fácil de entender y modificar. Si en algún momento se agrega un build, que sea una decisión explícita.
- **YouTube Data API v3** directamente desde el navegador, con la API key del usuario.
  - La key se lee de `window.RAREZAS_CONFIG.apiKey` (archivo `config.js`, ignorado por git) o de `localStorage`. Nunca debe subirse al repo.
- **YouTube IFrame Player API** para reproducir. Solo se usa el reproductor oficial; no se descargan ni se rehospedan videos (términos de YouTube y respeto a los autores).
- Se sirve con **Live Server** de VS Code. Desde `file://` YouTube no reproduce videos incrustados.
- Estado persistente en `localStorage` con prefijo `rarezas:` (key, filtros, vistos, ocultos, guardados, cuota).

## Cómo funciona la búsqueda

1. `randomWindow(year)` elige una ventana de ~1 mes al azar (desde 2006, o dentro del año filtrado). Ventanas pequeñas sacan videos más oscuros.
2. `pickPattern(year)` elige un patrón ponderado de `PATTERNS` y genera la consulta. Los patrones con fecha (`VID_`, `WIN_`, `PXL_`) usan un día dentro de la ventana.
3. `search.list` con `maxResults=50`, `videoEmbeddable=true`, `safeSearch=strict`, `publishedAfter/Before` y duración. **Cuesta 100 unidades.**
4. `videos.list` con los ids para obtener vistas, duración, si es incrustable y si es "para niños". **Cuesta 1 unidad.**
5. `passes()` filtra: incrustable, no marcado para niños, no visto, no oculto, vistas ≤ máximo, y opcionalmente título tipo nombre de archivo.
6. Lo que pasa se baraja y va a `state.pool`. Si la cola queda vacía se repite hasta `MAX_SEARCHES_PER_CLICK` (3) por clic.

**Cuota:** 10,000 unidades/día gratis ≈ 100 búsquedas. Se reinicia a medianoche hora del Pacífico. El panel muestra el uso (contado en el cliente, es aproximado).

## Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura: pantalla, info, controles, panel de filtros, diálogos de guardados y API key |
| `css/styles.css` | Estilo oscuro tipo "TV vieja". Colores en variables de `:root`. Responsive bajo 860px |
| `js/app.js` | Estado, filtros, cola, historial (anterior/siguiente), reproductor, guardados, ocultos, atajos de teclado, manejo de errores de la API |
| `js/patterns.js` | Lista `PATTERNS`, `pickPattern`, `randomWindow`, regex `looksLikeFilename` |
| `js/youtube.js` | `searchVideos`, `getDetails`, `formatDuration`, carga del IFrame API. Suma cuota en cada llamada |
| `js/storage.js` | `load`/`save` seguros sobre localStorage, contador de cuota diario |
| `config.example.js` | Plantilla; copiar a `config.js` |

## Funcionalidades actuales

- Siguiente / anterior con historial de sesión
- Filtros: año, vistas máximas (0, 10, 50, 100, 1000), duración, solo títulos tipo nombre de archivo
- Modo TV (avanza solo al terminar el video)
- Guardar favoritos (lista en un diálogo) y ocultar videos para siempre
- No repite videos ya vistos (hasta 5,000 ids recordados)
- Si un video no se puede reproducir (error 100/101/150), salta solo
- Atajos: → siguiente, ← anterior, F guardar, T modo TV

## Estado

- La sintaxis y los generadores de patrones se probaron con Node.
- **Probado contra la API real (2026-10-24):**
  - Patrones con fecha (`VID_20140315` + ventana de ese mes): 50 resultados, 21 con ≤10 vistas, 4 con 0. Funcionan muy bien.
  - Patrones numerados (`IMG_4821`, `MVI_0815`) con ventana de un mes o de un año: **0 resultados**. Sin ventana: 50 resultados de muchos años, 11 con ≤10 vistas.
  - Por eso los patrones sin fecha buscan sin `publishedAfter/Before` (o en todo el año si el usuario filtró uno). Ver `refill()` y `yearRange()`.
  - Falta probar a fondo en el navegador (reproductor, modo TV, errores de cuota).

## Siguientes pasos ideados

1. **Caché nocturno (prioridad):** un script (Node o Python, quizá con GitHub Actions) que junte cientos de videos al día y los guarde en un JSON. La página leería de ahí: no gasta cuota en vivo y se puede publicar sin exponer la key.
2. Filtro de región / idioma (`regionCode`, `relevanceLanguage`).
3. Mostrar de qué patrón y fecha salió cada video ("teletransporte").
4. Lista pública de rarezas favoritas de la comunidad.
5. Publicar (GitHub Pages funcionaría para la versión estática).

## Principios a respetar

- Muchos videos son momentos privados de familias. No burlarse ni destacar a las personas que aparecen, no descargar contenido, mantener el botón de ocultar y, si se publica, ofrecer una forma de pedir que se excluya un video.
- Filtrar contenido marcado como "para niños" (`madeForKids`).
- No meter la API key en el repo.
