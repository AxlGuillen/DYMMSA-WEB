# ADR-024 — Vistas guiadas con driver.js (overviews, no tutoriales)

**Fecha:** 2026-08-04
**Estado:** Aceptada
**Issue:** #52

## Contexto

La issue #52 planteaba elegir entre [Driver.js](https://driverjs.com/) y [Onborda](https://www.onborda.dev/) para guiar al equipo dentro de los flujos importantes. El detonante real llegó con el módulo de corte (#59): su diseño de "dos momentos" (ADR-022) confundió incluso al dueño del proyecto — abrió la página, no vio diagramas y creyó que algo estaba roto. El problema no era un bug sino que la pantalla no explica qué es cada bloque ni qué va a pasar.

## Decisión

1. **driver.js** (v1.8, MIT, ~5 kB gzip, cero dependencias) sobre Onborda.
2. El propósito es **overview, no tutorial**: cada paso explica *qué es* un bloque de la pantalla y cómo se conecta con el resto ("aquí se dibuja el acomodo cuando captures la barra"), no un paso-a-paso de captura que se vuelva obsoleto con cada cambio de UI.

### Por qué driver.js y no Onborda

| Criterio | driver.js | Onborda |
|---|---|---|
| Acoplamiento | Vanilla, se invoca desde cualquier handler | Provider + wrappers en el árbol React, pensado para Next |
| Dependencias | 0 | framer-motion |
| Contenido condicional | Pasos = selectores; se filtran al vuelo | Steps declarados en el provider |
| Peso | ~5 kB | motion + runtime |

La página de corte tiene MUCHO contenido condicional (candidatos que se consumen, grupos que aparecen con piezas válidas, diagramas que aparecen al capturar barra). Con driver.js el arranque filtra por `document.querySelector` y muestra solo lo presente; con Onborda habría que orquestar ese estado en React.

## Infraestructura

- `src/lib/tours/index.ts` — `startOverview(steps)`: config compartida en español (Siguiente/Anterior/Listo, progreso "N de M", `popoverClass: 'dymmsa-tour'`) + filtro de pasos ausentes.
- `src/lib/tours/<modulo>.ts` — pasos por módulo (`OverviewStep[]`). Primer módulo: `cut-planner.ts` (8 bloques).
- **Anclas por `data-tour="..."`**, nunca clases CSS: el estilo cambia, el ancla no. Cada página con tour lleva un botón "Vista guiada" (icono `CircleHelp`).
- Tema: overrides en `globals.css` sobre `.driver-popover.dymmsa-tour` usando los tokens (`--popover`, `--border`, `--secondary`) → respeta light/dark.
- **Test anti-drift obligatorio** por módulo: renderizar la página con fixture completo y asegurar que TODOS los selectores del tour existen (si alguien renombra un `data-tour`, el test truena antes de que el paso desaparezca en silencio).

## Consecuencias

- Agregar un tour nuevo = un archivo de pasos + atributos `data-tour` + botón + test anti-drift. Sin tocar el árbol de providers.
- Los textos viven en el código (español, con `<b>` permitido — driver.js renderiza HTML en la descripción). Solo contenido propio, nunca input del usuario.
- Queda para después (si se necesita): auto-arranque en primera visita por módulo (localStorage) y tours para planificador de compra, cotizador e inventario.
