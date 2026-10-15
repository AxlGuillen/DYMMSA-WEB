# ADR-038 — Tutoriales en video: un catálogo, el botón junto a la vista guiada y una pestaña en Documentación

**Fecha:** 2026-10-14
**Estado:** Aceptado
**Relacionado:** [[ADR-024-Vistas-Guiadas-Driver]] · [[ADR-031-Manifiesto-del-MCP-en-la-Documentacion]]

## Contexto

Grabamos los primeros videos de la app en YouTube: tres de Órdenes, horizontales 16:9 y con inserción permitida:

- de la cotización a la entrega;
- planificar compra;
- planificar corte.

Se pidió:

- una pestaña de tutoriales ligada a la documentación;
- en cada pantalla, un botón que abra su video en un iframe.

En Minuto Dulce (v0.4.0) ya resolvimos lo mismo para celular con Shorts 9:16. Se toma como referencia: un catálogo tipado, una fachada (portada primero, iframe al tocar), `youtube-nocookie` y un botón por sección.

## Decisión

1. **Un catálogo tipado** en `src/lib/tutorials.ts`:
   - Campos: `slug`, `order`, `youtubeId`, título, descripción y `duration` opcional.
   - `tours` es una lista de `TourId`, es decir, de las pantallas de su vista guiada. Una pantalla inexistente no compila.
   - `docs` es la sección de Documentación (`ordenes` / `compra` / `corte`).
   - `adminOnly` es opcional.
   - Un video con `PENDING_ID` o con un id inválido **nunca se muestra**.
2. **El botón sale del `TourButton`.** Si el catálogo tiene videos para su `TourId`, pinta **"Ver tutorial"** junto a "Vista guiada". Las pantallas no se tocan: agregar un video a una pantalla es una línea en el catálogo. Decisión del 2026-10-14: un botón aparte, no un menú "Ayuda", para que se descubra solo.
3. **Reproductor de fachada** (`VideoFacade` en un `Dialog` de shadcn, no un drawer: es una app de escritorio):
   - Antes del clic se ve la miniatura de YouTube (`i.ytimg.com/vi/<id>/hqdefault.jpg`, decisión 2026-10-14: sin portadas que mantener en el repo).
   - El iframe de `youtube-nocookie.com` se monta solo al dar play, y al cerrar se desmonta y el video se detiene.
   - Con dos o más videos, unos botones eligen cuál ver.
   - `next/image` va con `unoptimized`, así que la miniatura no pasa por el optimizador.
4. **Pestaña Tutoriales** en Documentación:
   - `/dashboard/docs` y `/dashboard/docs/tutoriales` son dos rutas con `DocsTabs`, el mismo patrón que Novedades/Actividad.
   - Cada tarjeta abre el reproductor y liga a su sección de docs. A la inversa, cada sección (`DocSection` con `action`) muestra su "Ver tutorial".
   - El filtro de `adminOnly` se aplica en el servidor de la pestaña. En una pantalla manda el acceso de la propia pantalla.
5. **Asignación inicial:**

   | Video | Dónde aparece | Sección de docs |
   |---|---|---|
   | 1 | Lista de órdenes y detalle de orden | `#ordenes` |
   | 2 | Planificador de compra | `#compra` |
   | 3 | Planificador de corte (orden y corte rápido) | `#corte` |

   No se muestra la duración, porque YouTube no la expone sin la API.

## Alternativas descartadas

- **La IFrame API de YouTube:** sería una dependencia y un script de terceros desde que carga la pantalla.
- **Portadas locales** (como Minuto Dulce): son archivos que hay que mantener y no aportan aquí, porque DYMMSA no tiene CSP que limite `img-src`.
- **Un menú "Ayuda" que reemplace "Vista guiada":** esconde el video detrás de un clic más.
- **Editar cada pantalla:** el `TourButton` ya está en 19 pantallas; colgarse de él evita olvidos.

## Pruebas

- `tests/lib/tutorials.test.ts`:
  - ids válidos, `slug` y `order` únicos;
  - **la sección de docs de cada video existe y muestra su botón**;
  - la asignación decidida;
  - lo pendiente, lo de admin y las URLs.
- `tests/components/tutorials.test.tsx`:
  - "Ver tutorial" solo donde hay video;
  - el iframe solo tras el play;
  - el selector con dos videos;
  - la pestaña y su liga a docs.
