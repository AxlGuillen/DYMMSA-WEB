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
   - `docs` es la sección de Documentación (`cotizar` / `cotizaciones` / `ordenes` / `compra` / `corte`). Cada sección de la lista `DOCS_ANCHORS` ya trae su "Ver tutorial", que no pinta nada mientras no tenga video (2026-10-17: se sumaron las dos de Cotizaciones antes de grabar sus videos).
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

**Review del PR #142:** Documentación no filtra por rol, así que `tutorialsForDocs` excluye siempre los `adminOnly` (un video de admin solo sale en su pantalla y en la pestaña para admins). El mapa `TOURS`/`TourId` se mudó a `src/lib/tours/registry.ts` para que `lib/tutorials` no dependa de un componente; `TutorialDialog`/`TutorialList` filtran con `isPublished` (un error del catálogo esconde el video en vez de tumbar la pantalla).

**Actualización 2026-10-25, entregas semanales:** se suben a YouTube los videos resumen de cada semana (41, 42 y 43) y se quieren a la mano de quien administra.
- Entran al mismo catálogo con `kind: 'entrega'`: siempre `adminOnly`, sin pantalla (`tours: []`) y sin sección de Documentación (`docs` es opcional); su `order` es el número de semana, así que no choca con los de módulo (1 a 3).
- La pestaña los pinta aparte, bajo un encabezado «Entregas semanales» con la etiqueta «Solo administradores», de la más reciente a la más antigua. `publishedDeliveries` devuelve `[]` a quien no es admin, aunque a una entrada le falte `adminOnly`, y la página lo decide en el servidor, así que el HTML de un miembro no los trae.
- No salen en el `TourButton` ni en Documentación (`tours` vacío y sin `docs`), y sus tarjetas no ligan a la documentación.
- Una entrega nueva es una fila en el catálogo.

## Alternativas descartadas

- **La IFrame API de YouTube:** sería una dependencia y un script de terceros desde que carga la pantalla.
- **Portadas locales** (como Minuto Dulce): son archivos que hay que mantener y no aportan aquí, porque DYMMSA no tiene CSP que limite `img-src`.
- **Un menú "Ayuda" que reemplace "Vista guiada":** esconde el video detrás de un clic más.
- **Editar cada pantalla:** el `TourButton` ya está en 19 pantallas; colgarse de él evita olvidos.

## Pruebas

- `tests/lib/tutorials.test.ts`:
  - ids válidos, `slug` y `order` únicos;
  - **la sección de docs de cada video existe y muestra su botón**, y lo mismo para cada sección de `DOCS_ANCHORS` aunque aún no tenga video;
  - la asignación decidida;
  - lo pendiente, lo de admin y las URLs.
- `tests/lib/tutorials.test.ts` (entregas, 2026-10-25): las tres con su id; todas `adminOnly`, sin pantalla ni docs y con `slug` = `entrega-semana-<order>`; en orden descendente y solo para un administrador; nunca en una pantalla ni en Documentación.
- `tests/components/tutorials.test.tsx`:
  - la tarjeta y el reproductor de una entrega no ligan a la documentación; la página muestra el apartado a un administrador y ni rastro a un miembro;
  - "Ver tutorial" solo donde hay video;
  - el iframe solo tras el play;
  - el selector con dos videos;
  - la pestaña y su liga a docs.
