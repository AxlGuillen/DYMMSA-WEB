# ADR-029 — Jornada por persona en las gráficas de horas y lectura del módulo por MCP

**Fecha:** 2026-09-24
**Estado:** Aceptado
**Issue:** #101 · **Relacionado:** [[ADR-026-Perfiles-y-Permisos-por-Rol]] (RLS por persona), [[ADR-023-MCP-OAuth-Supabase]] (el MCP lee con el token del usuario), [[ADR-024-Vistas-Guiadas]] (no aplica: Horas sigue sin tour)

## Contexto

`/dashboard/hours` mostraba la rejilla semanal de checadas (#93): buena para revisar un día, mala para la pregunta real — **¿esta persona está cumpliendo su jornada?** La issue #101 pide una gráfica con líneas de referencia de medio tiempo y tiempo completo, y que el asistente (MCP) pueda informar sobre el módulo, que hasta ahora no tenía ninguna tool.

Decisiones tomadas con el usuario (2026-09-24): jornada **por persona** (todos de 8 h salvo Tania, de 4 h); **8 h / 4 h al día, semana de 5 días → 40 h / 20 h**; dos gráficas (la semana y la tendencia de 8 semanas); lo gráfico con lo que ya hay.

## Decisión

### 1. La jornada vive en `profiles.shift`, no en settings

`full_time | part_time | NULL` (sin asignar). La referencia útil es **la de quien estás viendo**: una constante de la empresa marcaría a Tania como incumplida todas las semanas. Con la columna, la gráfica resalta la línea de esa persona y calcula su cumplimiento; sin jornada dibuja las dos líneas iguales y no juzga. Los valores (8/4 y 40/20) sí son constantes en código (`SHIFT_HOURS` en `src/lib/timesheet.ts`): son la definición de "tiempo completo" de este negocio, no un parámetro por persona.

RLS **sin cambios**: cada quien lee su fila y el admin todas — exactamente lo que la gráfica necesita. Paso de datos solo en la nube (como los roles en #93).

### 2. 40 h y no 48

La jornada legal mexicana es de 48 h con sábado, pero la referencia que el negocio quiere ver es la de 5 días. Si eso cambia, es un número en `SHIFT_HOURS`.

### 3. Gráficas con recharts vía el Chart de shadcn, en dos capas

`recharts` ya estaba instalado (donut del dashboard). Se agregó el componente **Chart de shadcn** (`src/components/ui/chart.tsx`, `bunx shadcn add chart`), que envuelve recharts con el tema (`--chart-1..5` ya en `globals.css`) y el tooltip con el estilo del sistema. Dos reglas:

- **La matemática nunca vive en el componente**: `weekChartData`, `shiftProgress` y `buildWeeklyTrend` (lib pura, reloj inyectado, sin `new Date()`) preparan cada número; la gráfica solo pinta.
- **Dos capas por gráfica**: `WeekChart`/`TrendChart` (card, encabezado, badge, estados) y `WeekBars`/`TrendBars` (el SVG de recharts), cargadas con `next/dynamic` + `ssr: false` como el donut. Así recharts se parte del bundle y los tests de componentes afirman sobre el encabezado — jsdom no mide contenedores y un `ResponsiveContainer` pinta vacío.

`shadcn add chart` también intentó reescribir `card.tsx` para importar de un paquete `cn` nuevo; se revirtió: el helper del proyecto es `@/lib/utils`.

### 4. Las checadas sin salida se pintan aparte

Una entrada sin salida no suma minutos, así que la barra saldría corta y acusaría a alguien por un olvido del checador. Se pinta en el color de aviso, el tooltip lo dice y el encabezado cuenta cuántas hay.

### 5. MCP: la RLS es el único gate; `run` pasa la identidad

Tres tools de solo lectura (`get_week_hours`, `get_hours_trend`, `list_time_imports`) **sin lógica de permisos propia**. El `db` viene del token del llamador (ADR-023), así que:

- "yo" se resuelve con `ctx.userId` — `run()` en `server.ts` ahora pasa el contexto además del `db`; las tools existentes ignoran el segundo argumento.
- `persona` busca por nombre parcial en `profiles`: a un member la policy solo le devuelve su propia fila, así que preguntar por otro da 0 coincidencias y un mensaje que lo explica. Un admin ve a todos.
- `list_time_imports` devuelve 0 filas a un member y lo dice en `nota`, en vez de fingir que nunca se cargó nada.

Es la regla del PR #99 aplicada al revés: como la policy ya dice lo mismo que la ruta, la tool no necesita repetirla. Nada de escrituras: corregir checadas es de admin, con rastro, y no se abre por MCP.

## Consecuencias

- Migración `20260924055249 add_profile_shift`; `PATCH /api/profiles/[id]` acepta `shift`; Equipo lo edita.
- `GET /api/time-entries` no cambió: la tendencia pide 56 días y agrupa en el cliente con `buildWeeklyTrend` (`week` viene `null` fuera de una semana exacta, como siempre).
- `SERVER_INSTRUCTIONS` gana la línea de Horas y la aclaración de que no tiene relación con `odoo_employee_directory`.
- Fuera de alcance: horas extra, descansos, festivos (la referencia es lineal por día); el tour de Horas.
