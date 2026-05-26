# DYMMSA — Bóveda de Documentación

> Sistema de cotizaciones y gestión de inventario para DYMMSA, distribuidor URREA en Morelia, México.  
> Stack: Next.js 16 · TypeScript · Supabase · shadcn/ui · TanStack Query · Zustand

---

## Índice de la bóveda

### [[00-Inicio/Glosario|Glosario]]
Términos clave: ETM, model_code, URREA, separadores, DYMMSA-codes, approval_token.

---

### 01 · Negocio
| Nota | Contenido |
|------|-----------|
| [[01-Negocio/Contexto-DYMMSA\|Contexto DYMMSA]] | Quiénes son, qué hacen, problema original |
| [[01-Negocio/Flujo-Operacional\|Flujo Operacional]] | Manual vs. automatizado, paso a paso |
| [[01-Negocio/Decisiones-de-Negocio\|Decisiones de Negocio]] | Por qué aprobación parcial, por qué token público, etc. |

---

### 02 · Arquitectura
| Nota | Contenido |
|------|-----------|
| [[02-Arquitectura/Stack\|Stack]] | Tecnologías, versiones, justificación |
| [[02-Arquitectura/Estructura-de-Carpetas\|Estructura de Carpetas]] | Mapa de `src/` con propósito de cada directorio |
| [[02-Arquitectura/Base-de-Datos\|Base de Datos]] | Esquema real (Supabase), relaciones, RLS, constraints, filas actuales |
| [[02-Arquitectura/API-Routes\|API Routes]] | Todas las rutas, método, auth, payload, descripción |

---

### 03 · Módulos
| Nota | Contenido |
|------|-----------|
| [[03-Modulos/Autenticacion\|Autenticación]] | Supabase Auth, middleware, protección de rutas |
| [[03-Modulos/Catalogo-ETM\|Catálogo ETM]] | CRUD etm_products, importación masiva, auto-learn |
| [[03-Modulos/Inventario\|Inventario]] | store_inventory, CRUD, importación Excel |
| [[03-Modulos/Cotizador\|Cotizador]] | Flujo completo: upload → tabla editable → Zustand → guardar |
| [[03-Modulos/Aprobacion-por-Token\|Aprobación por Token]] | Token UUID, página pública, aprobación parcial |
| [[03-Modulos/Ordenes\|Órdenes]] | Creación desde cotización, stock check, Excel URREA, estados |
| [[03-Modulos/Dashboard\|Dashboard]] | Métricas, stats cards, filtros |

---

### 04 · Decisiones Técnicas (ADRs)
| ADR | Decisión |
|-----|----------|
| [[04-Decisiones-Tecnicas/ADR-001-Separadores\|ADR-001]] | item_type separator en quotation_items y order_items |
| [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes\|ADR-002]] | Productos sin ETM → código DYMMSA-{n} |
| [[04-Decisiones-Tecnicas/ADR-003-sort_order\|ADR-003]] | Campo sort_order para preservar orden de ítems |
| [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible\|ADR-004]] | Cotizaciones aprobadas editables por DYMMSA |
| [[04-Decisiones-Tecnicas/ADR-005-Modo-Discreto\|ADR-005]] | Modo discreto: enmascarar valores monetarios |
| [[04-Decisiones-Tecnicas/ADR-006-Refactor-Utils-Phase-0\|ADR-006]] | Extracción de lógica duplicada a `src/lib/*` |
| [[04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing\|ADR-007]] | Estrategia de testing: unit + mock de Supabase |

---

### 05 · Fases de Desarrollo
| Fase | Estado |
|------|--------|
| [[05-Fases/Fase-0-Setup\|Fase 0 — Setup]] | ✅ Completada |
| [[05-Fases/Fase-1-Auth\|Fase 1 — Auth]] | ✅ Completada |
| [[05-Fases/Fase-2-Catalogo\|Fase 2 — Catálogo]] | ✅ Completada |
| [[05-Fases/Fase-3-Cotizador\|Fase 3 — Cotizador básico]] | ✅ Completada |
| [[05-Fases/Fase-4-Inventario\|Fase 4 — Inventario]] | ✅ Completada |
| [[05-Fases/Fase-5-Flujo-Completo\|Fase 5 — Flujo completo]] | ✅ Completada |
| [[05-Fases/Fase-5.5-Flexibilidad\|Fase 5.5 — Flexibilidad]] | ✅ Completada |
| [[05-Fases/Fase-6-Mejoras\|Fase 6 — Mejoras y UX]] | 🔄 En curso |

---

### 06 · Changelog
| Mes | Entradas |
|-----|----------|
| [[06-Changelog/2026-04\|Abril 2026]] | Separadores, delivery_time, sort_order, rename statuses |
| [[06-Changelog/2026-05\|Mayo 2026]] | Modo discreto, refactor utils, Claude PR Reviewer, fix separadores, testing |

---

## Estado actual del proyecto

- **Fase:** 6 — Mejoras y Optimización
- **Última actualización:** 2026-05-25
- **BD (Supabase):** ACTIVE_HEALTHY · us-west-2 · PostgreSQL 17.6
- **Filas actuales:** etm_products 564 · store_inventory 195 · quotations 9 · quotation_items 365 · orders 8 · order_items 182
