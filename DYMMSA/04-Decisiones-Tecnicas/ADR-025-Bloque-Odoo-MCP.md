# ADR-025 — Bloque Odoo en el MCP (lectura de facturación)

**Fecha:** 2026-08-11
**Estado:** Aceptado (Fase 1 implementada)
**Issue:** #65 · **Relacionado:** [[ADR-023-MCP-OAuth]] (el MCP anfitrión), [[ADR-014-Tareas-GitHub]] (precedente de tercero aislado)

## Contexto

DYMMSA lleva su facturación oficial en **Odoo Online** (plan Custom, hoy 19.0 Enterprise). El objetivo es darle a Claude acceso de LECTURA a esos datos vía el MCP existente para revisiones automáticas (cartera vencida, cuadres por periodo, montos atípicos) — **sin** relacionar Odoo con DYMMSA-WEB ni escribir jamás en Odoo.

Verificado antes de construir (comentarios de la issue #65): plan Custom con API incluida y gratuita (sin costo por llamada); rate limit de Odoo Online ~1 req/s **sin llamadas paralelas** (429 al excederse); y `/jsonrpc`/`/xmlrpc` **deprecados** — mueren en Odoo Online 21.1 (invierno 2027), así que el cliente usa la **External JSON-2 API** (`POST /json/2/<model>/<method>`, `Authorization: bearer <api-key>`) desde el día uno.

## Decisión

1. **Tercero aislado** en `src/lib/odoo/` (patrón `github.ts`): `client.ts` (transporte + `OdooError`), `env.ts`, `catalog.ts`, `normalize.ts`. Las tools MCP viven en `src/lib/mcp/tools/odoo/` y llevan **prefijo `odoo_`** + descripciones que dicen explícitamente que consultan el sistema EXTERNO de facturación.
2. **Cola serializada obligatoria**: el singleton `callOdoo` garantiza UNA request en vuelo con espaciado mínimo (1.1 s) — si el LLM dispara varias tools a la vez, se forman. Backoff ante 429 (Retry-After o 2 s, UN reintento). Producción jamás crea callers propios: la cola solo protege si es compartida.
3. **El catálogo es la frontera de seguridad** (`catalog.ts`): las primitivas genéricas solo aceptan modelos allowlisted y campos whitelisted — también en filtros y agrupaciones (filtrar por un campo oculto filtraría información vedada). **Nómina/salarios nunca entran al catálogo** aunque la API key (de admin) pueda leerlos.
4. **Estrategia híbrida**: 2 primitivas (`odoo_query`, `odoo_aggregate`) para la cola larga de preguntas + tools curadas por módulo para las frecuentes. Agregar un módulo de Odoo = entradas al catálogo + (opcional) tools curadas.
5. **El server digiere, el modelo interpreta**: respuestas JSON compactas — agregados calculados POR Odoo (`read_group`), many2one → nombre, `false` → null, `__domain` fuera. Nunca registros crudos masivos al contexto.
6. **Identidad**: las tools Odoo corren con la API key del server (env), no con el token OAuth del usuario — cualquier usuario del conector ve lo mismo. Correcto para una empresa de un solo equipo (misma lógica del ADR-023); documentado como límite consciente.
7. **Env opcional**: sin `ODOO_URL`/`ODOO_API_KEY` el resto del MCP opera y las tools `odoo_*` responden error accionable; el health reporta `skip`. Con env, el check `odoo` (search_count barato) → `degraded` si la key murió.

## Fases (dictamen en la issue #65)

| Fase | Módulos | Estado |
|---|---|---|
| 1 | Contabilidad (`account.move`, `account.payment`) + toda la infraestructura | ✅ 2026-08-11 |
| 2 | Contactos + Ventas (`res.partner`, `sale.order`) | Pendiente |
| 3 | Inventario (`product.product`, `stock.quant`) — desambiguar de `search_inventory` (tienda) | Pendiente |
| 4 | Empleados (`hr.employee`, whitelist mínima SIN nómina) + Flotilla (`fleet.vehicle`) | Pendiente |

## Tools Fase 1

- `odoo_query` — search_read genérico sobre el catálogo (máx 50, normalizado, avisa truncado)
- `odoo_aggregate` — read_group genérico (métricas `campo:sum|avg|min|max|count`)
- `odoo_overdue_invoices` — cartera vencida: total, por cliente (desc), más vencidas con días de atraso (2 llamadas exactas)
- `odoo_invoices_summary` — facturación por periodo agrupada por estado_pago | cliente | mes

## Operación

- Env (server): `ODOO_URL`, `ODOO_API_KEY`, `ODOO_DB` (opcional). En Vercel para producción.
- **Rotación de la API key**: se genera con expiración (6–12 meses) desde Odoo → Usuario → Seguridad; renovarla es reemplazar la env. La key de exploración (1 mes) se revoca al desplegar.
- Tests sin red: caller inyectado por parámetro con las formas REALES capturadas de la instancia (2026-08-11); la cola/backoff se prueba con fetch/sleep inyectados.

## Verificación en vivo (2026-08-11)

Smoke test contra la instancia real vía las tools: cartera vencida $268,602.49 (13 facturas, la más vieja 102 días), julio $662,934.68 facturado / $625,930.59 pendiente, 59 pagos inbound por $4.7M. Consistente con la UI de Odoo.
