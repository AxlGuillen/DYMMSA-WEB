# MCP — Plan de diseño: dos conectores, composición de tools y código

> Issue #155 · 2026-10-22 · Aceptado (ADR-041)
> Insumos:
> - [[02-Arquitectura/MCP-Escrituras/00-Matriz]]: mapa de las 67 escrituras.
> - [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]]: las 36 tools de la app.
> - [[02-Arquitectura/MCP-Escrituras/Auditoria-Odoo]]: las 19 de Odoo.
> - [[02-Arquitectura/MCP-Escrituras/Auditoria-codigo]]: la arquitectura del código.

## 1. Lo que ya está decidido (2026-10-22)

- **Dos conectores en la misma app,** con el mismo deploy, el mismo login de Supabase y **una sola allowlist** (`MCP_OAUTH_CLIENT_IDS`):
  - **«DYMMSA-WEB»** en `/api/mcp`: el actual, conserva su URL.
  - **«Odoo DYMMSA»** en `/api/odoo/mcp`: nuevo.
- **Solo el admin se conecta al MCP por ahora.** Las restricciones de «solo admin» no condicionan el diseño; el mecanismo de roles se queda, sin trabajo extra.
- **Todos los módulos de DYMMSA-WEB tendrán escritura por MCP.** El núcleo deja de ser solo lectura, lo que revierte la decisión del 2026-08-20 de ADR-015.

Una consecuencia para no olvidar: el token **no** queda ligado a un conector. Separar es separación de **contexto** (qué tools ve el modelo en cada chat), no de permisos.

## 2. Reglas de diseño de tools

### Fuentes

- Anthropic, *Writing effective tools for agents*: <https://www.anthropic.com/engineering/writing-tools-for-agents>
- Especificación MCP 2025-11-25:
  - *Tools*: <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
  - *Schema* (`ToolAnnotations`): <https://modelcontextprotocol.io/specification/2025-11-25/schema>
- Guía de diseño de conectores de Claude (tercero, sunpeak): <https://sunpeak.ai/blogs/claude-connector-tool-design>

### Reglas

| # | Regla | De dónde sale |
|---|---|---|
| R1 | **Una intención por tool:** un verbo, un objeto, un set de anotaciones y una forma de salida. Lectura y escritura separadas | sunpeak; Anthropic («avoid overlapping tools») |
| R2 | **Consolidar flujos, no envolver endpoints:** una tool resuelve una tarea real en una llamada (`schedule_event` y no `list_users` + `list_events` + `create_event`) | Anthropic |
| R3 | **Sin solapes:** dos tools que contestan lo mismo confunden al modelo | Anthropic |
| R4 | **Nombres `verbo_objeto`** estables, con verbos de significado fijo y namespacing por servicio (`odoo_`) | Anthropic; spec (≤128 caracteres; Claude revisa ≤64) |
| R5 | **Parámetros sin ambigüedad,** con restricciones reales (enum, rango, formato); requerido solo lo indispensable; rechazar campos desconocidos | Anthropic; sunpeak |
| R6 | **Respuestas con señal alta:** nombres en vez de UUID, concisas, paginadas, con aviso de truncado y cómo pedir más; `structuredContent` (+ `outputSchema` opcional) | Anthropic; spec |
| R7 | **Errores accionables:** `isError: true` con qué corregir y un ejemplo válido; nunca códigos opacos | Anthropic; spec («Tool Execution Errors… self-correct») |
| R8 | **Anotaciones explícitas y fieles:** `readOnlyHint` (default false), `destructiveHint` (default **true**), `idempotentHint` (default false), `openWorldHint` (default **true**) | spec; sunpeak |
| R9 | **Descripciones** que dicen qué, sobre qué, con qué y **cuándo frente a sus vecinas**. Los flujos entre tools van en las instrucciones del servidor | Anthropic; sunpeak |
| R10 | **Escrituras con una persona en el ciclo.** En claude.ai la barrera real es el permiso por tool del conector («Needs approval» / «Always allow»). La *elicitation* MCP no está soportada ahí (según terceros, sin verificar), así que la confirmación se diseña dentro de la tool | spec («human in the loop»); terceros |
| R11 | **Presupuesto de contexto:** cada tool paga su descripción y su esquema en cada chat donde el conector está prendido. Hay que medir | Anthropic («token efficiency») |
| R12 | **Evaluar con tareas reales,** multi-paso, y leer las transcripciones | Anthropic («evaluation-driven development») |

## 3. Cómo quedan los dos conectores

### Números

Las cifras de `tools/list` van **en el cable**, la unidad que mide el test desde #158. Entre paréntesis, la cifra con el método viejo del stub, que no contaba anotaciones ni estructura JSON. Hoy, en el cable, el bloque app mide 32,891 y el de Odoo 20,272: factores ×1.147 y ×1.125 sobre el stub.

| | Tools | `tools/list` (caracteres, en el cable) | Instrucciones |
|---|---|---|---|
| **Hoy, todo junto** | 55 | 53,163 de 54,000 (stub: 46,692 de 47,000) | 7,931 de 8,000 |
| **DYMMSA-WEB, objetivo** | **44** (24 lecturas, 20 escrituras) | ~50,200 ±15 % (stub: ~43,800) | ~5,500 |
| **Odoo DYMMSA, objetivo** | **15** (11 lecturas, 4 escrituras; el modelo ve 14) | ~18,300 (stub: ~16,300) | ~2,800 |

**Topes propuestos por conector:**

| Conector | Tools | `tools/list` (en el cable) | Descripciones | Instrucciones |
|---|---|---|---|---|
| DYMMSA-WEB | 45 | 53,000 (stub: 46,000) | 19,000 | 6,000 |
| Odoo DYMMSA | 16 | 21,500 (stub: 19,000) | 6,500 | 3,000 |

Con los dos prendidos, el chat paga unos 68,500 caracteres de `tools/list` en el cable, contra 53,163 de hoy, pero con 20 escrituras nuevas. Con uno solo, cada chat paga menos que hoy. B1 mide cada conector de verdad y fija sus topes con esa medición.

### DYMMSA-WEB: decisiones de composición

Detalle completo en [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]] §3.

1. **`save_<entidad>` crea, edita y mueve el estado de UNA entidad; nunca borra.**
   - Las nuevas son:
     - `save_quotation`;
     - `save_order` (incluye sus líneas) y `save_order_reception` (aparte, porque su confirmación y sus entradas difieren);
     - `save_purchase_decisions` y `save_cut_plan`;
     - `save_inventory_item`, `save_product` y `save_urrea_catalog_item`;
     - `save_app_settings`;
     - `save_profile`;
     - `save_payroll_period`.
   - Se fusionan:
     - `save_payable` ← `create_payable` + `update_payable` + `mark_payable_paid`;
     - `save_task` ← `create_task` + `update_task`.
   - Se renombran:
     - `set_inventory_location` → `save_inventory_item`;
     - `record_payroll_hours` → `save_payroll_hours`;
     - `get_profiles` → `list_profiles`.
2. **Borrar es otra tool: `delete_record`,** con `tipo` ∈ proveedor, marca, medida, factura no pagada, checada, día justificado. El motivo es R1 y R4, y sobre todo R10: en claude.ai el permiso es por tool, así que puedes dejar «Always allow» en los `save_*` y pedir aprobación solo al borrar.
   - Fuera de la tool: borrar cotizaciones, órdenes, productos, inventario y catálogo.
3. **No se fusionan lecturas** (`list_*` dentro de `get_*`, planes dentro de `get_order`): cambiarían la forma de salida según los parámetros (R1). En su lugar, **los `get_*` aceptan nombre o `ref`**, para no encadenar list → get por UUID (R2).
4. **Marcas:** sin `save_brand`. Se crean con `save_supplier.crear_marcas`, que es el caso real; renombrar se queda en la app.
5. **Nómina:** `save_payroll_hours` escribe días (borradores, «traer de Horas», corregir un día) y `save_payroll_period` lleva el ciclo del corte (confirmar borradores, cerrar, reabrir).

### Odoo DYMMSA: decisiones de composición

Detalle completo en [[02-Arquitectura/MCP-Escrituras/Auditoria-Odoo]] §3.

1. **Se renombra todo una sola vez, al separar, y se conserva el prefijo `odoo_`.** Los dos conectores pueden estar prendidos a la vez, y sin prefijo `save_quotation` chocaría.
2. **Una sola cifra de cartera,** bruta por factura como la pantalla Clientes:
   - `odoo_list_receivables`, que junta `odoo_overdue_invoices` (modo global) y `odoo_receivables_ranking`;
   - `odoo_get_customer`, que junta el expediente y el estado de cuenta y es donde vive la cifra neta de Odoo, con su nota.
3. **`odoo_get_document` por folio** reemplaza los tres detalles (factura, venta, pago). **Se retiran `odoo_employee_directory` y `odoo_fleet_status`:** las dos son una sola llamada a la primitiva (`odoo_search_records`).
4. **Escrituras:**
   - `odoo_confirm_quotation` sale de `odoo_save_quotation`: es un ciclo de vida con otro efecto (crea la entrega).
   - `odoo_create_draft_invoice` pasa a dos fases: hoy Claude pide el sí sin saber el cliente ni el monto.
   - Las tres declaran que son idempotentes (lo son por diseño).
5. **`openWorldHint: true` en todo el conector:** Odoo es un sistema de terceros.
6. **#154 (clave SAT) entra sin tool nueva:**
   - la vista previa sugiere hasta 3 claves por producto nuevo;
   - la línea acepta `categoria_sat` en texto;
   - el botón firma qué claves se pueden elegir.

## 4. Convenciones comunes a los dos conectores

**Verbos.**
- Lectura: `get_` (uno), `list_` y `search_` (colecciones), `preview_` (gemela de lectura de una escritura con vista).
- Escritura: `save_` (crea o edita una entidad) y `delete_record`.
- Verbos de ciclo de vida, solo con nombre explícito: `odoo_confirm_quotation`, `odoo_create_draft_invoice`.
- Quedan fuera `set_`, `mark_`, `create_`, `update_` y `record_` en DYMMSA-WEB.

**Parámetros.**
- En español y snake_case.
- **Los enums también en español y con los mismos tokens en la entrada y en la salida.** Ejemplo, cotización: `borrador | en_revision | aprobada | rechazada | convertida`.
- Un valor inválido es error, nunca un filtro ignorado.
- Fechas validadas con `isRealDate`.
- **Entrada estricta:** un campo desconocido es error con la lista de campos válidos. Hoy el SDK lo descarta en silencio, y `odoo_invoices_summary({ cliente })` devuelve el total de todos.

**Referencias.**
- `ref`: los 8 primeros caracteres del UUID.
- `linea`: 1-based sobre todas las filas, la misma regla en cotización y orden.
- `version`: huella para la concurrencia.
- `detalle: resumen | completo` solo en los `get_` de documentos grandes.
- **Ningún UUID a la vista.**

**Respuestas.** Tres envolturas:
- **colección:** `total`, `pagina`, `por_pagina`, `hay_mas`, `nota`;
- **registro:** `ref`, …, `avisos`, `nota`;
- **escritura:** `accion`, `escrito`, `cambios` antes/ahora, `avisos`, `bloqueos`, `clave`.

`structuredContent` va con el mismo JSON en texto. `outputSchema` **solo** donde una vista lo consume: cuesta presupuesto y no está claro si claude.ai le pasa al modelo los dos.

**Confirmación.** Un solo mecanismo en el core para todo lo de riesgo medio y alto: **dos fases con `clave` firmada.**
- **Fase 1:** no escribe y devuelve el resumen y una clave HMAC con secreto propio (`MCP_PREVIEW_SECRET`). La clave se ata al usuario, la tool, los argumentos y la versión de lo afectado, y vence en 30 min.
- **Fase 2:** los mismos argumentos más la clave. Si algo cambió, no escribe.

Reemplaza el `confirmar: true`, que el modelo puede mandar a la primera y que no ata lo confirmado a lo que se mostró. Las vistas MCP Apps son la cara visual de la fase 1. El riesgo bajo escribe directo.

**Errores.**
- En español, en tres partes: qué pasó, qué corregir y un ejemplo válido.
- Nunca el texto crudo de PostgREST.
- Las ambigüedades listan hasta 5 candidatos con su `ref`.
- **Se valida todo antes de la primera escritura:** hoy `set_inventory_location` responde error después de haber escrito.

**Anotaciones.** Siempre las cuatro, explícitas. `readOnlyHint` se deriva del tipo de tool, así que no puede contradecirse.

**Descripciones.** Plantilla: qué hace · sobre qué · entradas clave · qué devuelve · cuándo usarla frente a sus vecinas. Los flujos (cotizar → facturar, la rutina del viernes) van en las instrucciones del conector.

## 5. Arquitectura del código

Detalle en [[02-Arquitectura/MCP-Escrituras/Auditoria-codigo]] §3–§5.

**Problemas de hoy:**
- **Registro monolítico.** `server.ts`: 885 líneas con 55 registros inline y 8 guardas de rol.
- **Dos fuentes de verdad por tool.** El manifiesto se escribe a mano y un regex lo amarra al registro.
- **La validación de una entidad vive en hasta cuatro lugares.** Por ejemplo, facturas: zod de la tool, interfaz, validación de la tool y validación de la ruta.
- **Enums y fechas como `z.string()`.**
- **Transporte atado a `/api/mcp`.**

**Capas (con reglas de dependencia verificables por eslint):**

```
transporte   src/app/api/[transport]/route.ts · src/app/api/odoo/[transport]/route.ts   (= connectorRoute(conector))
core         src/lib/mcp/core/        define · register · run · errors · result · schema · confirm · auth · http · catalog
conector     src/lib/mcp/connectors/{dymmsa,odoo}/   connector · instructions · budget · modules/<modulo>/<tool>.ts
dominio      src/lib/<modulo>-store.ts (schema zod + reglas, lo comparte la ruta) · src/lib/odoo/* · src/lib/github.ts
```

**Cómo se arma cada tool:**
- **Una tool = un archivo con `defineTool({...})`.** De esa definición salen el registro, el manifiesto, la documentación in-app, el consentimiento, el presupuesto por conector y los tests de contrato. Se acaba el regex y desaparecen `TOOL_MANIFEST` y las guardas.
- **El store valida; la ruta y la tool solo mapean y traducen errores.** La tool reutiliza el mismo esquema zod del dominio con las llaves en español (`aliasShape`). Un `DomainError` común se traduce a HTTP en la ruta y a `isError` en el MCP.
- **Dependencias por `ctx`:** `db`, `user`, `clock`, `deadline` y `deps` (`github`, `income` / `reader`, `writer`). Ningún handler importa singletons.

**Checklist de código para cada tool nueva** (para la fila del MCP en CLAUDE.md):
- un archivo por tool;
- la regla en el store;
- entrada estricta con primitivas del core;
- anotaciones completas;
- confirmación según la ficha;
- validar antes de escribir;
- envolturas estándar;
- deps por `ctx`;
- tests: store + harness + `docs.evals`;
- presupuesto;
- docs en el mismo PR.

## 6. Evaluación (R12)

- **Tareas definidas:**
  - DYMMSA-WEB: 25 tareas reales multi-paso más 2 controles negativos (Auditoría DYMMSA-WEB §5);
  - Odoo: 10–15 (Auditoría Odoo §6).
- **Cada definición de tool lleva `docs.evals`** con 1–2 frases, y un test exige que ninguna tool quede sin tarea.
- **Al cerrar cada fase:**
  - correr la lista en claude.ai (y en Claude Code para las de confirmación) con los dos conectores prendidos;
  - registrar en la bóveda tools elegidas, llamadas, errores y tokens;
  - leer las transcripciones donde falló.
- **Opcional:** automatizarlo con la API de Claude. Tiene costo y pide llave: se decide después de la primera pasada manual.

## 7. Secuencia de trabajo

Cada PR va a `stg`, pasa `bun run check` y el **snapshot de `tools/list`** (PR A1), salvo que diga por qué cambia.

**Track 0, independiente y ya: bugs que existen hoy sin el MCP.** Un issue aparte con los de stock (model_code repetido en create-order; cancelar/borrar que restauran y luego ignoran errores; cancelar una entregada; recepción sin acotar a la orden), el de aprobación con ids viejos y el import de catálogo que puede dejarlo vacío. Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] «Bugs».

**Fase A: base, sin cambio de comportamiento**

| PR | Qué |
|---|---|
| A1 | Red de seguridad: harness con el SDK real en memoria + snapshot de `tools/list` e instrucciones por rol |
| A2 | Extraer `core/` (run, errores, resultado, auth, schema); `fold`/`sanitizeSearch`/`isUuid` a `src/lib/text.ts` |
| A3 | `defineTool` + registro derivado + catálogo, mecánico. Mismo texto y mismo orden, así que el snapshot sale idéntico. Se parte en A3a (Odoo) y A3b (DYMMSA-WEB) |

**Fase B: separar**

| PR | Qué |
|---|---|
| B1 | Ruta `/api/odoo/mcp` en paralelo: metadatos RFC 9728 por path, proxy, health, consentimiento de los dos, instrucciones y presupuesto por conector, `serverInfo` («DYMMSA-WEB» / «Odoo DYMMSA»). DYMMSA-WEB **sigue** sirviendo las `odoo_*`. Prueba en Claude Code |
| B2 | **Catálogo Odoo v2** en el conector nuevo: renombres, fusiones, anotaciones, factura en dos fases y #154. Como el conector todavía no lo usa nadie, se renombra una sola vez |
| — | **Tú:** agregas «Odoo DYMMSA» en claude.ai y en Claude Code; se actualizan las rutinas que citan nombres viejos |
| B3 | Quitar el bloque Odoo de DYMMSA-WEB. Escribir ADR-041 y actualizar CLAUDE.md, la documentación in-app y el consentimiento |

**Fase C: calidad transversal**

| PR | Qué |
|---|---|
| C1 | Entrada estricta, errores de validación en español, primitivas zod (8 enums y 19 fechas), `DomainError` compartido con las rutas |
| C2 | Anotaciones completas en DYMMSA-WEB |
| C3 | Envolturas estándar y `structuredContent`; `outputSchema` en las vistas |
| C4 | Confirmación genérica en dos fases (`MCP_PREVIEW_SECRET`); `preview-token` de Odoo montado encima |
| C5 | Red de cobertura de escritura (`write-coverage.test.ts`) |
| C6 | **Convenciones de DYMMSA-WEB de una vez:** renombres y fusiones de las tools que ya existen (`save_payable`, `save_task`, `save_inventory_item` solo gaveta, `save_payroll_hours`, `list_profiles`), enums en español, `ref`/`linea`, `get_*` por nombre y `delete_record` con los borrados de bajo riesgo |

**Fase D: escrituras nuevas, por entidad, en pares store → tool**

1. Ajustes.
2. Productos ETM.
3. Catálogo URREA.
4. Equipo y perfil.
5. Nómina (periodo).
6. **Cotizaciones**, el caso de Diego. Necesita el arreglo de `/approve` del Track 0.
7. Al final, **Inventario (cantidades) y Órdenes**, después del RPC atómico de stock.

## 8. Decisiones

> **Aceptadas el 2026-10-22: sí a las ocho, como se recomiendan abajo.** Quedan registradas en [[04-Decisiones-Tecnicas/ADR-041-Dos-Conectores-MCP-y-Composicion-de-Tools]].

1. **Confirmación:** ¿un solo mecanismo de dos fases con `clave` para todo lo de riesgo medio y alto? → **Sí.** Agrega la variable `MCP_PREVIEW_SECRET` en Vercel.
2. **Borrados:** ¿una tool `delete_record`, o `quitar` dentro de cada `save_x`? → **`delete_record`**, por el permiso por tool de claude.ai.
3. **Renombres:** ¿se renombra ahora (revierte la regla «no renombrar» de ADR-034)? → **Sí:** Odoo en B2 y DYMMSA-WEB en C6, una sola vez cada uno. DYMMSA-WEB sin prefijo; Odoo con `odoo_`.
4. **Enums en español** en la entrada y en la salida (`borrador`, `pedida`, `pendiente`…)? → **Sí**, en C6. Obliga a reescribir `BUSINESS_RULES_MD` de las instrucciones.
5. **Entrada estricta de golpe** o una semana registrando campos desconocidos? → **De golpe:** solo la usas tú.
6. **Odoo:**
   - retirar `odoo_employee_directory` y `odoo_fleet_status` → **sí**;
   - cartera bruta como cifra única, con la neta solo en el expediente → **sí**;
   - `odoo_confirm_quotation` aparte → **sí**.
7. **Reabrir ADRs:**
   - **ADR-033:** que el MCP confirme y cierre cortes de nómina, con clave atada a los borradores.
   - **ADR-037:** crear marcas desde `save_supplier` con opt-in.
   - **ADR-015:** editar el título y la descripción de tareas.
   - **ADR-040:** una séptima operación (asignar la clave SAT a un producto existente) y el catálogo SAT en lectura.

   → Mi recomendación: sí a los cuatro, cada uno anotado en su ADR.
8. **Track 0:** ¿abro el issue de bugs y se arreglan antes o en paralelo a la Fase A? → **En paralelo:** son de producción hoy, haya MCP o no.

## 9. Preguntas que se verifican en el camino, no las decides tú

- ¿claude.ai le pasa al modelo el texto, el `structuredContent` o los dos? Define si `outputSchema` se extiende.
- ¿`openWorldHint: true` cambia el permiso por default de las lecturas en claude.ai?
- ¿La pantalla de consentimiento puede saber qué conector se autoriza? Si no, describe los dos.
- ¿La versión del SDK (fijada por `mcp-handler` en 1.26) permite entrada estricta sin parchear el registro?
