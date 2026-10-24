# Rarezas

Explorador de videos de YouTube que el algoritmo nunca te mostraría: grabaciones subidas directo del teléfono o la cámara, con títulos como `IMG_4821` o `VID_20120315`, y casi sin vistas. Inspirado en PetitTube y Astronaut.io.

Es HTML, CSS y JavaScript puro. No necesita instalar nada.

## Cómo arrancarlo

1. Abre la carpeta `rarezas` en VS Code.
2. Instala la extensión **Live Server** (VS Code te la sugerirá al abrir la carpeta).
3. Clic derecho en `index.html` → **Open with Live Server**.
4. La primera vez te pedirá tu API key de YouTube.

> Importante: no abras `index.html` con doble clic. YouTube no reproduce videos incrustados desde `file://`, necesita un servidor (aunque sea local).

## Sacar la API key (gratis)

1. Entra a <https://console.cloud.google.com/> y crea un proyecto.
2. Ve a **APIs y servicios → Biblioteca**, busca **YouTube Data API v3** y actívala.
3. Ve a **APIs y servicios → Credenciales → Crear credenciales → Clave de API**.
4. Recomendado: en la key, **Restricciones de aplicación → Sitios web** y agrega `http://127.0.0.1:5500/*` (y luego el dominio donde la publiques). En **Restricciones de API**, deja solo YouTube Data API v3.

Puedes pegarla en el diálogo de la página (se guarda en tu navegador) o copiar `config.example.js` como `config.js` y ponerla ahí.

## Cómo funciona

1. Elige una ventana de tiempo aleatoria de ~1 mes (dentro del año que filtres).
2. Genera una búsqueda con un nombre de archivo por defecto (`js/patterns.js`).
3. Busca con `search.list` (cuesta **100** unidades de cuota).
4. Pide vistas y detalles de los 50 resultados con `videos.list` (cuesta **1** unidad).
5. Se queda solo con los que pasan tus filtros y los pone en cola.

La cuota gratuita es de 10,000 unidades al día, o sea unas **100 búsquedas diarias**. Cada búsqueda puede dar varios videos, así que normalmente alcanza para un buen rato. El contador del panel te dice cuánto llevas (se reinicia a medianoche hora del Pacífico).

## Estructura

```
rarezas/
├── index.html          # estructura de la página
├── css/styles.css      # estilos (colores en :root)
├── js/
│   ├── app.js          # lógica principal, UI, reproductor
│   ├── patterns.js     # patrones de búsqueda y ventanas de tiempo
│   ├── youtube.js      # llamadas a la API
│   └── storage.js      # localStorage y contador de cuota
├── config.example.js   # plantilla para tu API key
├── CLAUDE.md           # contexto completo del proyecto para seguir con IA
└── .vscode/            # recomienda Live Server
```

## Ideas para seguir

- **Agregar patrones:** edita la lista `PATTERNS` en `js/patterns.js`. El `weight` controla qué tan seguido sale cada uno.
- **Filtro de región / idioma:** `search.list` acepta `regionCode` y `relevanceLanguage`.
- **Backend con caché:** un script (Node o Python) que corra cada noche, junte cientos de videos y los guarde en un JSON. Así la página no gasta cuota y puedes compartirla sin exponer tu key.
- **Rarezas compartidas:** una lista pública de las mejores que vaya guardando la comunidad.
- **Botón "teletransporte":** que muestre de qué fecha y patrón salió el video.

## Respeto

Muchos videos son momentos privados de familias que nunca esperaron audiencia. Por eso la página solo usa el reproductor oficial de YouTube (no descarga nada), tiene el botón **Ocultar** y filtra contenido marcado para niños. Si lo publicas, considera agregar una forma de que la gente pida que se excluya un video.
