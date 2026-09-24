# ADR-030 — MCP: cobertura de lectura por módulo y primeras escrituras fuera del núcleo (facturas por pagar)

**Fecha:** 2026-09-24
**Estado:** Aceptado · issue #109
**Relacionado:** [[ADR-015-MCP-Interno]] (escrituras acotadas) · [[ADR-023-MCP-OAuth]] (RLS con el token) · [[ADR-028-Bitacora-Generica]] (quién marcó pagada) · [[ADR-029-Jornada-y-Horas-por-MCP]] (tools sin permisos propios)

## Contexto

El MCP nació con el núcleo y creció por módulo (Odoo, horas), pero cinco módulos nuevos
nunca recibieron tool: proveedores, facturas por pagar, ingresos/cierre, corte y planificador
de compra (más la configuración). El asistente no podía responder "¿qué debo esta semana?"
ni "¿cuánto tubo necesito para la orden 12?". Y las escrituras seguían siendo las tres de
ADR-015; el flujo real "ya pagué la de Perfiles, márcala" desde el celular no existía.

## Decisión 1 — Toda ruta GET tiene una decisión explícita

Se agregaron **8 tools de lectura** reusando los helpers de `src/lib/` (nunca duplicando
matemática):

| Tool | Módulo | Reusa |
|---|---|---|
| `list_suppliers` | Proveedores (#21) | `paymentTermsLabel` |
| `list_payables`, `get_payable`, `get_payables_overview` | Facturas por pagar (#84/#100) | `summarizeMonth`, `daysUntilDue`, `describeAuditEvent` |
| `get_month_closing` | Ingresos y cierre (#94/#102) | `buildIncomeOverview`, `monthClosing` + Data Cache de Odoo |
| `get_cut_plan` | Corte (#59) | `tubeNetNeeds`, `plateNetNeeds`, `packBars`, `packSheets` |
| `get_purchase_plan` | Planificador (ADR-018) | `buildPurchasePlan`, `fetchCatalogEntryMap` |
| `get_app_settings` | Configuración | `resolveThresholds`, `resolveCutMargin` |

Y un **test anti-drift** (`tests/mcp/coverage.test.ts`): recorre `src/app/api/**/route.ts`,
detecta las que exportan `GET` y exige que cada una esté en un mapa explícito
"cubierta por tool X" o "fuera: por qué". Una ruta nueva sin decisión rompe el CI; una
entrada del mapa cuya ruta desapareció, también.

Reglas que se mantienen:

- **Las tools no llevan permisos propios** (ADR-029): el `db` viene del token y la RLS decide.
  La única excepción es de **forma, no de acceso**: `get_payable` lee `profiles.role` con el
  mismo token (como `requireRole`) y a un member le devuelve el detalle **sin la llave**
  `historial` — ni siquiera consulta `audit_events`. ADR-028 exige que un member no sepa que
  la bitácora existe, así que tampoco la mencionan `SERVER_INSTRUCTIONS`, `BUSINESS_RULES_MD`
  ni las descripciones de las tools (review del PR #111).
- **Búsqueda por nombre con guarda de coincidencias** (`requireSingleMatch` en `shared.ts`):
  una coincidencia se usa; ninguna o varias → error que lista las candidatas. Aplica a
  proveedores, órdenes (`resolveOrder`: UUID o nombre/cliente) y facturas (`resolvePayable`:
  UUID, concepto o proveedor). El modelo pregunta en vez de adivinar.
- `get_month_closing` **degrada como la ruta** (ADR-027): sin Odoo responde con
  `ingresos: null` y el motivo; nunca falla por eso. Las dependencias de Odoo se inyectan
  (`IncomeDeps`) para que los tests no toquen el Data Cache.

## Decisión 2 — Facturas por pagar es el primer módulo con escritura fuera del núcleo

Dos tools, elegidas de menor a mayor riesgo con el usuario (2026-09-24):

- **`mark_payable_paid`** — marcar pagada con la fecha REAL (`paid_at`, default hoy en
  Morelia) o regresar a pendiente (`pagada=false`). Es el `PATCH` que ya existe.
- **`create_payable`** — registrar una factura de gasto: proveedor por nombre parcial
  (debe existir), concepto, monto, fecha; vencimiento opcional, si falta se calcula con
  los días de crédito del proveedor como en la UI. Siempre nace `pending`.

**Fuera, por decisión:** editar monto/vencimiento y borrar se quedan en la app — cambian
cifras fiscales o destruyen, y no hay flujo real desde un chat para eso.

Por qué este módulo sí y el núcleo no: es un **registro simbólico de gastos** (la
facturación oficial vive en Odoo), no mueve inventario ni dinero, y la bitácora (#100)
registra cada movimiento con el nombre de quien lo hizo — **también por MCP**, porque el
trigger toma `auth.uid()` del token; la tool no escribe nada en `audit_events`.

Mecanismos:

1. **Una sola regla de pago** para ruta y tool: `resolvePaymentUpdate(status, paidAt, today)`
   en `src/lib/payables.ts` (paid → fecha real o hoy; otro estado → `paid_at = null`;
   estado/fecha inválidos → error). El `PATCH` la usa ahora en lugar de su copia.
2. **Guardas de la tool** que la ruta no necesita porque la UI las tiene:
   - una factura ya pagada + `mark_payable_paid` sin `fecha_pago` → error ("ya estaba pagada
     el X; indica fecha_pago para corregirla") — un `paid` suelto re-sellaría hoy (#100);
   - cancelada → se reactiva desde la app; ya pendiente → aviso;
   - al marcar pagada la búsqueda **prefiere las pendientes** ("la de Perfiles" con dos
     pagadas y una pendiente = la pendiente); sin pendientes cae a cualquier estado.
3. `annotations` sin `readOnlyHint`, como las otras escrituras.
4. **Confirmar antes de escribir es criterio de `SERVER_INSTRUCTIONS`**, no de la tool:
   "di exactamente qué vas a hacer y espera la confirmación; con varias coincidencias,
   pregunta cuál".

## Consecuencias

- 43 tools (33 → 41 de lectura + 2 de escritura); escrituras del MCP: **5**
  (`set_inventory_location`, `create_task`, `update_task`, `mark_payable_paid`,
  `create_payable`). El núcleo transaccional sigue solo-lectura (decisión 2026-08-20).
- `SERVER_INSTRUCTIONS` gana Proveedores, Finanzas, Corte/Planificador y Configuración en
  el bloque A; `BUSINESS_RULES_MD` corrige la regla del Excel URREA (criterio = pertenencia
  al catálogo, no `brand='URREA'`) y suma las de finanzas.
- Al liberar: **reconectar el conector** en los clientes de Claude para que aparezcan las
  tools nuevas y las instrucciones actualizadas.
- Deuda visible que dejó el anti-drift: `orders/[id]` no tiene `GET` (el hook lee Supabase
  directo, pendiente en CLAUDE.md) — el mapa no la lista porque no existe, no porque esté
  cubierta.
