# ADR-007: Estrategia de Testing — unit + mock de Supabase

> **Estado:** Implementado 2026-05-25
> **Fase:** 6 — Mejoras (Fase 1 y 2 de QA)
> **Archivos clave:** `tests/helpers/supabase-mock.ts`, `tests/helpers/request.ts`, `tests/lib/*`, `tests/api/*`, `package.json`

---

## Contexto

Tras el refactor de ADR-006 (lógica pura extraída a `src/lib/*`), el proyecto quedó listo para introducir tests. Las decisiones a tomar:

1. **Test runner** — el proyecto ya usa Bun, que trae un runner integrado compatible con la API de Jest (`bun:test`). Cero dependencias nuevas.
2. **Cómo probar el backend** — los route handlers dependen del cliente de Supabase. Opciones: mockear Supabase (unit), levantar una BD real (integration), o ambos.
3. **Ubicación de los tests** — co-locados (`__tests__` junto al código) vs. carpeta raíz `tests/` que espeja `src/`.

---

## Decisión

### 1. Runner: Bun test

```jsonc
// package.json
"test":          "bun test tests/",
"test:watch":    "bun test --watch tests/",
"test:coverage": "bun test --coverage tests/"
```

### 2. Backend: unit con mock de Supabase (sin BD real)

Se mockea el cliente de Supabase y se ejercita el handler real. No se levanta Postgres. Esto verifica auth, validación, reglas de negocio, rollback y deducción de stock — todo lo que vive en el código de la app, que es donde están los bugs. Las constraints/RLS reales quedan fuera de alcance (cubiertas por las migraciones y el Claude PR Reviewer).

### 3. Ubicación: carpeta raíz `tests/` que espeja `src/`

```
tests/
├── helpers/
│   ├── supabase-mock.ts   # fake del query builder de Supabase
│   └── request.ts         # makeRequest, makeParams, makeExcelRequest, readJson
├── lib/                   # tests de funciones puras (ADR-006)
│   ├── format.test.ts
│   ├── business-rules.test.ts
│   ├── auto-learn.test.ts
│   └── inventory.test.ts
└── api/                   # tests de route handlers
    ├── smoke.test.ts
    ├── auth-guards.test.ts
    ├── quotations.test.ts
    ├── orders.test.ts
    └── imports.test.ts
```

Separar `tests/` de `src/` mantiene el código de producción limpio y escala cuando se agreguen tests de componentes/hooks.

---

## El mock de Supabase

`tests/helpers/supabase-mock.ts` reproduce el query builder chainable de `@supabase/supabase-js` lo justo para los handlers de DYMMSA:

- **Chainable + thenable:** cada filtro (`.eq`, `.in`, `.order`, …) retorna `this`; el builder implementa `.then()`, así `await` resuelve tanto si se llamó `.single()` como si se await-ea el builder directo.
- **Respuestas por `tabla` o `tabla.op`** (`insert | select | update | delete | upsert`), estáticas o **función** que recibe el `CallRecord` y ramifica por filtro (ej. `confirm-reception` hace dos `select` distintos sobre `order_items`: por `id` y por `order_id`).
- **Registro de llamadas** (`_calls`, `callsTo`, `didCall`) para hacer assertions sobre side effects: que el rollback borró el padre, que se descontó/restauró el inventario, que el payload insertado tiene los campos correctos.
- **`auth.getUser()`** configurable (`user` / `null`) para probar los guards.

Se inyecta con `mock.module('@/lib/supabase/server', …)` de `bun:test`. **Patrón clave:** registrar el `mock.module` al tope del archivo y luego hacer `await import()` dinámico del handler; una variable `activeClient` se intercambia por test.

La ruta pública `/approve/[token]` usa `createAdminClient` de `@/lib/supabase/admin`, por lo que se mockea ese módulo aparte.

---

## Cobertura

| Suite | Archivo | Tests | Qué verifica |
|-------|---------|------:|--------------|
| Puras | `tests/lib/*` | 104 | format, business-rules, auto-learn, inventory (ADR-006) |
| Smoke | `api/smoke.test.ts` | 3 | que el approach funciona (mock + alias + NextResponse) |
| Auth | `api/auth-guards.test.ts` | 22 | 18 rutas → 401 sin auth; `/approve` público funciona |
| Cotizaciones | `api/quotations.test.ts` | 16 | validación, `sort_order`, `is_approved`, separadores, rollback |
| Órdenes | `api/orders.test.ts` | 17 | deduce stock al crear, `allocateInventory`, cancel/delete/reception |
| Imports | `api/imports.test.ts` | 15 | Excel real, upsert/replace, auto-learn (brand URREA) |
| | **Total** | **177** | 0 fallos |

### Reglas de negocio del CLAUDE.md ahora cubiertas por tests
- Separadores excluidos de totales/auto-learn/conteos.
- Stock se deduce al **crear** la orden; cancelar/borrar lo restaura.
- Rollback al fallar inserción de ítems (save, update, create-order, create).
- Preservación de `is_approved` al re-guardar una cotización aprobada.
- Auto-learn: `brand='URREA'` solo con `model_code`; no sobreescribe campos vacíos.
- `requireAuth()` exigido en las 18 rutas protegidas.
- Invariante `quantity_in_stock + quantity_to_order = quantity_approved`.

---

## Consecuencias

- **Cero dependencias nuevas** — Bun test ya estaba disponible.
- **Tests rápidos** (~250 ms la suite completa) — sin red ni Docker.
- **`NextRequest.formData()` con `.xlsx` real funciona bajo `bun test`** — el helper `makeExcelRequest` genera el archivo con SheetJS.
- **No cubre** constraints de Postgres, RLS ni triggers reales — es un trade-off consciente del enfoque unit. Integration/E2E quedan como trabajo futuro.

---

## NO incluido (intencionalmente)

- Integration tests contra Supabase local/branch.
- Component tests (Testing Library) y E2E (Playwright).
- Tests de los parsers de Excel en `src/lib/excel/*` (candidato siguiente).

---

**Ver también:** [[04-Decisiones-Tecnicas/ADR-006-Refactor-Utils-Phase-0]] · [[02-Arquitectura/Estructura-de-Carpetas]] · [[02-Arquitectura/API-Routes]] · [[05-Fases/Fase-6-Mejoras]]
