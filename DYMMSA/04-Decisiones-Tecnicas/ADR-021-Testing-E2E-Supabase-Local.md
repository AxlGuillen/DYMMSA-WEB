# ADR-021 — Testing E2E contra un Supabase local (integración + Playwright)

**Fecha:** 2026-07-17
**Estado:** Implementado
**Rama:** `chore/local-e2e-supabase`

## Contexto

La batería existente (ADR-007) es **unit con Supabase mockeado**: rápida y sin BD,
pero el mock **finge** el comportamiento real de Postgres. Quedaban sin cubrir
fielmente:

- **Constraints reales**: `UNIQUE(code,brand)`, `CHECK`, `FK` sin cascade.
- **RLS** (rol `authenticated`) y los `GRANT` de tabla.
- **Transaccionalidad / rollback** de verdad.
- **Flujos multi-paso** encadenados (cotización → aprobación → orden → recepción).
- **UI + auth + upload de archivo** (login, subir Excel, estado del cliente).

## Decisión

Levantar un **Supabase local con el CLI (Docker)** y correr dos tipos de prueba
contra él, **ambos separados del CI** (que no tiene el stack local):

### Fuente de verdad del schema
La nube (proyecto `wjlklwtvjewhtghlskbt`) **sigue siendo la fuente de verdad** vía
MCP. Para el local hay **un único migration baseline**
(`supabase/migrations/00000000000000_baseline.sql`) reconstruido desde
`supabase/schema.sql` + lo que el snapshot no captura:
- `CREATE EXTENSION moddatetime` (triggers `set_updated_at`).
- El bucket de Storage `task-images`.
- **`GRANT`s de `public` a `anon`/`authenticated`/`service_role`** — la nube los
  da por default; sin ellos `authenticated` recibe *permission denied* pese a RLS
  (RLS gatea FILAS, el GRANT gatea la TABLA).

> ⚠️ El baseline es **solo para local**. Al cambiar el schema en la nube, refrescar
> `schema.sql` y re-derivar el baseline.

### Fixtures deterministas (`supabase/seed.sql`)
Un **usuario de prueba** (`test@dymmsa.local` / `testpassword123`, sembrado en
`auth`) + fixtures mínimos (5 ETM, 3 catálogo con STD, 1 inventario con gaveta).
**Nunca datos reales**: los tests afirman contra estos valores. `db.ts` los
re-aplica por test (`resetDb`) para aislar.

### Capa 1 — Integración (route handlers vs BD real)
`tests/integration/` + `vitest.integration.config.ts` → `bun run test:integration`.
Reusa el seam `injectSupabaseServer`/`injectSupabaseAdmin`, pero devuelve un
cliente **real autenticado** (no un mock) → ejerce auth + RLS + SQL de verdad.
Cubre CRUDs (constraints), cotizaciones (token/approved_at), aprobación,
órdenes (split de inventario, excedente ADR-019, cancelar) y la cadena completa.

### Capa 2 — Playwright (navegador)
`tests/e2e/` + `playwright.config.ts` → `bun run test:e2e`. Un happy-path del
flujo visual: **login real → subir Excel → cotizador poblado → guardar → detalle**.
Arranca su **propio dev server en el puerto 3100** con env apuntando al Supabase
local (no interfiere con `bun run dev` ni reusa un server que apunte a producción).

## Cómo correr

```bash
bunx supabase start          # levanta el stack local (Docker) — una vez
bun run test:integration     # capa 1 (rápida, ~3s)
bun run test:e2e             # capa 2 (Playwright, ~13s)
bunx supabase stop           # apaga el stack (libera RAM)
bunx supabase db reset       # reconstruye schema + seed desde cero
```

Las llaves del stack local son las **demo deterministas** (públicas); van en
`.env.test.example`. El CI (`bun run check`) **no** corre estas suites (verificado:
`vitest list` no las incluye).

## Alternativas descartadas

- **Adoptar migraciones del CLI como fuente única**: más limpio a largo plazo pero
  cambia el flujo actual (MCP → nube). Se optó por baseline-solo-para-local.
- **Solo un Postgres pelón (sin el stack)**: pierde Auth/GoTrue, Storage y
  PostgREST → el login y la aprobación no serían fieles.
- **Meter los E2E al CI**: aplazado — requiere levantar Supabase en el runner
  (Docker sí está, pero suma minutos/complejidad). Se decide aparte.

## Consecuencias

- **Peso en la máquina**: el stack corre en Docker. Se **aligeró** (ADR sin efecto
  en prod) desactivando `analytics`/`realtime`/`edge_runtime` en `config.toml`
  (~1.7 GB → ~0.8 GB). Apagar con `supabase stop` cuando no se usa.
- **Mantenimiento**: el baseline puede quedar viejo si el schema de la nube cambia
  sin refrescarlo. Es el costo de baseline-solo-para-local.
- La batería mockeada (ADR-007) **sigue siendo la del CI**; esto la complementa,
  no la reemplaza.

## Bug de infraestructura encontrado

Al correr la primera integración: `permission denied for table quotations`. Causa:
el baseline no tenía los `GRANT` de tabla que Supabase da por default en la nube.
Agregados al baseline → el local se comporta como producción.
