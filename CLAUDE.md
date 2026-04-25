# DYMMSA — Sistema de Cotizaciones y Gestión de Inventario

Aplicación web para automatizar cotizaciones de DYMMSA (distribuidor URREA en Morelia, México).
Flujo: subir Excel del cliente → cotizador editable → aprobación por link → orden → inventario.

> 📚 Documentación completa en la bóveda Obsidian: `DYMMSA/00-Inicio/README.md`

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript estricto |
| Estilos | Tailwind CSS + shadcn/ui |
| Estado | Zustand (draft cotización) + TanStack Query (server state) |
| BD + Auth | Supabase (PostgreSQL 17.6) + @supabase/ssr |
| Excel | SheetJS (parse) + ExcelJS (generate) |
| Deploy | Vercel + Bun |

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Base de datos

Supabase project: `wjlklwtvjewhtghlskbt` · us-west-2 · RLS habilitado en todas las tablas.

### Tablas y estados críticos

**`quotations`** — status CHECK:
```
draft | sent_for_approval | approved | rejected | converted_to_order
```
- `canEdit = isDraft || isApproved` (Fase 5.5: cotizaciones aprobadas son editables)
- Ítems nuevos agregados en estado `approved` → `is_approved = true` (aprobación interna DYMMSA)
- `approval_token UUID UNIQUE` — se usa en `/approve/[token]` sin auth

**`quotation_items`** — campos clave:
```
item_type: 'product' | 'separator'
is_approved: null (pendiente) | true | false
delivery_time: 'immediate' | '2_3_days' | '3_5_days' | '1_week' | '2_weeks' | 'indefinite'
sort_order: INTEGER  -- preserva orden del array al guardar
```

**`orders`** — status CHECK (migración `20260409055423`):
```
ordered | received | delivered | completed | cancelled
```

**`order_items`** — campos clave:
```
item_type: 'product' | 'separator'
urrea_status: 'pending' | 'supplied' | 'not_supplied'
delivery_time: (mismo enum que quotation_items)
sort_order: INTEGER  -- preserva orden desde cotización; manual = max+1
quantity_approved, quantity_in_stock, quantity_to_order, quantity_received
```
Constraint implícito: `quantity_in_stock + quantity_to_order = quantity_approved`

**`etm_products`** — `etm TEXT UNIQUE`, `model_code TEXT`, `brand TEXT DEFAULT 'URREA'`

**`store_inventory`** — `model_code TEXT UNIQUE`, `quantity INTEGER CHECK >= 0`

---

## Reglas de negocio críticas

Estas reglas generan bugs si se ignoran al escribir código:

| Regla | Detalle |
|-------|---------|
| **Separadores excluidos de todo** | `item_type='separator'` nunca se incluye en: totales, auto-learn, conteos, is_approved, Excel URREA |
| **Stock se deduce al CREAR la orden** | No al confirmar recepción. Cancelar restaura `quantity_in_stock`. |
| **Excel URREA** | Solo ítems: `item_type='product'` AND `brand='URREA'` AND `quantity_to_order > 0` |
| **Auto-learn** | Solo actualiza campos no vacíos. No asigna `brand='URREA'` si `model_code` está vacío. |
| **sort_order** | Al guardar cotización: `sort_order = index`. Al crear orden: re-asigna secuencialmente. Agregar ítem manual: `max(sort_order) + 1`. Siempre ordenar por `sort_order ASC`. |
| **Aprobación pública** | `/approve/[token]` sin auth. Si `status !== 'sent_for_approval'` → mostrar estado actual, no permitir re-aprobar. |
| **Rollback** | Si falla inserción de ítems en `save` o `create-order` → eliminar el registro padre (quotation/order). |

---

## Convenciones de código

- **Todo en inglés:** código, variables, nombres de BD, API routes.
- **TypeScript estricto.** Types centralizados en `src/types/database.ts`.
- **Hooks = TanStack Query + fetch a API Routes propias.** No llamar Supabase directo desde el cliente.
- **API Routes:** usar `createClient()` de `@supabase/ssr` + verificar `auth.getUser()` al inicio.
- **Páginas:** Server Components por defecto; `"use client"` solo donde hay interactividad.
- **Zustand store:** `dymmsa-quotation-draft` en localStorage. Llamar `reset()` al guardar exitosamente.
- **Sin comentarios obvios.** Solo comentar WHY cuando no es evidente.

---

## Estado del proyecto

**Fase actual:** 6 — Mejoras y Optimización (en curso)

| Fase | Estado | Módulo principal |
|------|--------|-----------------|
| 0 — Setup | ✅ | — |
| 1 — Auth | ✅ | `src/hooks/useAuth.ts` |
| 2 — Catálogo ETM | ✅ | `src/app/api/products/` |
| 3 — Cotizador básico | ✅ | `src/components/quoter/` |
| 4 — Inventario | ✅ | `src/app/api/inventory/` |
| 5 — Flujo completo | ✅ | `src/app/api/quotations/` + `src/app/api/orders/` |
| 5.5 — Flexibilidad post-aprobación | ✅ | `src/app/api/orders/[id]/items/` |
| 6 — Mejoras UX | 🔄 | — |

---

## 🤖 Auto-mejora: instrucciones para Claude

> Obligatorio. Ejecutar automáticamente al final de cada cambio significativo.

### Qué actualizar en la bóveda (`DYMMSA/`)

| Evento | Archivo a actualizar |
|--------|---------------------|
| Nueva o modificada **ruta API** | `DYMMSA/02-Arquitectura/API-Routes.md` |
| Nueva **tabla o columna** en Supabase | `DYMMSA/02-Arquitectura/Base-de-Datos.md` (verificar con MCP Supabase) + este CLAUDE.md |
| **Decisión técnica no obvia** | Crear `DYMMSA/04-Decisiones-Tecnicas/ADR-XXX-nombre.md` |
| **Fase completada** | Marcar ✅ en este CLAUDE.md + actualizar `DYMMSA/05-Fases/Fase-N.md` |
| **Nueva fase** | Crear `DYMMSA/05-Fases/Fase-N-Nombre.md` + agregar fila en tabla de arriba |
| Nuevo **enum o estado** | `DYMMSA/00-Inicio/Glosario.md` + tabla de BD en este CLAUDE.md |
| **Migración de BD** | `DYMMSA/06-Changelog/YYYY-MM.md` (fecha + migración + descripción + motivo) |
| Cambio en **flujo de negocio** | `DYMMSA/01-Negocio/Flujo-Operacional.md` |
| Cambio en **estructura de carpetas** | `DYMMSA/02-Arquitectura/Estructura-de-Carpetas.md` |

### Reglas

1. **No inventar schema.** Si hay duda, usar MCP Supabase (`list_tables`, `execute_sql`) antes de documentar.
2. **Fechas absolutas** en changelog (`YYYY-MM-DD`), nunca relativas.
3. **Links Obsidian** entre notas relacionadas: `[[Carpeta/Nota]]`.
4. **Este CLAUDE.md es la fuente de verdad operacional.** La bóveda es el detalle. Si hay conflicto, CLAUDE.md tiene prioridad — y debe corregirse también.

### Formato changelog

```markdown
## YYYY-MM-DD

**[Categoría]:** Qué cambió.
- Detalle
**Motivo:** Por qué.
```

---

**Última actualización:** 2026-04-25  
**BD:** Supabase `wjlklwtvjewhtghlskbt` · PostgreSQL 17.6 · us-west-2  
**Filas (2026-04-25):** etm_products 564 · store_inventory 195 · quotations 9 · quotation_items 365 · orders 8 · order_items 182
