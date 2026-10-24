# ADR-041: dos conectores MCP (DYMMSA-WEB y Odoo DYMMSA) y reglas de composición de tools

**Fecha:** 2026-10-22
**Estado:** Aceptado. Implementación por fases, ver [[02-Arquitectura/MCP-Escrituras/01-Plan]] §7. **B3 hecho (2026-10-24):** los dos conectores ya están separados; medidas finales en § «Presupuestos por conector». **C1 hecho (2026-10-24):** entrada estricta, errores en español y `DomainError`; ver § «C1: contrato de entrada y errores». **C2 hecho (2026-10-24):** las cuatro anotaciones en cada tool de los dos conectores, derivadas del tipo; ver § «C2: anotaciones».
**Relacionado:** [[ADR-015-MCP-Interno]] · [[ADR-023-MCP-OAuth]] · [[ADR-025-Bloque-Odoo-MCP]] · [[ADR-033-Nomina-Horas-por-Corte]] · [[ADR-034-MCP-Reglas-de-Crecimiento]] · [[ADR-037-MCP-Escrituras-Proveedores-Facturas-Nomina-Materiales]] · [[ADR-040-Escrituras-Acotadas-en-Odoo]] · issue #155

## Contexto

Diego pidió al asistente cambiar precios y tiempos de entrega de una cotización, y el conector solo podía leer: el núcleo transaccional (cotizaciones, órdenes, cantidades de inventario) está en solo lectura por la decisión del 2026-08-20.

El 2026-10-22 se decidió que **todos los módulos de DYMMSA-WEB se podrán editar desde el MCP**. Un solo conector no da para eso:
- **Tools:** el bloque app está en 36 de 36.
- **`tools/list`:** completo mide 46,692 de 47,000 caracteres con el método de `manifest.test.ts`; en el cable son 53,163 (snapshot de #155 A1).
- **Lo que pide el mapa:** 13 escrituras nuevas.

El insumo de esta decisión:
- el mapa de las 67 escrituras (`00-Matriz`) y sus fichas;
- tres auditorías contra las guías de Anthropic y la spec MCP 2025-11-25: tools de la app, tools de Odoo y arquitectura del código;
- el plan (`01-Plan`).

## Decisiones

1. **Dos conectores en la misma app.**
   - **«DYMMSA-WEB»** en `/api/mcp`: conserva su URL.
   - **«Odoo DYMMSA»** en `/api/odoo/mcp`.
   - Comparten deploy, login de Supabase y **una sola allowlist** (`MCP_OAUTH_CLIENT_IDS`).
   - El token no se liga a un conector: la separación es de contexto (qué tools ve el modelo), no de permisos.
   - `get_month_closing` y las pantallas de Finanzas y Clientes siguen leyendo Odoo por `src/lib/odoo/`, sin pasar por el conector.
2. **Acceso.** Hoy el conector solo lo usan administradores, y por eso las restricciones de «solo admin» no condicionan el diseño de las tools nuevas. **Eso es una convención, no un control.**
   - **Lo que hace el código:** `oauth.ts` valida la sesión de Supabase y el `client_id` de la allowlist, y luego resuelve el rol. Un member que complete el OAuth entra y recibe la lista de member, sin las tools `adminOnly`.
   - **La barrera real:** el member no recibe las tools, y la RLS sigue siendo la barrera. En las tablas de negocio esa RLS hoy es `USING (true)` (hallazgo 2 de la matriz).
   - **Lo que sigue igual:** el mecanismo de roles (#133). Si algún día se conecta un member, las escrituras nuevas tienen que marcar `audience` antes.
3. **Composición (reglas R1–R12 del plan):**
   - **Una intención por tool:** un verbo, un objeto, un set de anotaciones y una forma de salida.
   - **`save_<entidad>`** crea, edita y mueve el estado de una entidad; nunca borra.
   - **No se fusionan lecturas:** los `get_*` aceptan nombre o `ref` para evitar cadenas list → get por UUID.
4. **Borrados en una tool propia, `delete_record`,** con `tipo` ∈ proveedor, marca, medida, factura no pagada, checada, día justificado.
   - **Por qué:** claude.ai pide permiso por tool; así los `save_*` pueden quedar en «Always allow» y borrar siempre pide aprobación.
   - **Fuera:** borrar cotizaciones, órdenes, productos, inventario y catálogo.
5. **Confirmación: un solo mecanismo de dos fases con `clave` firmada** para todo lo de riesgo medio y alto.
   - **Fase 1:** no escribe. Devuelve el resumen y una clave HMAC con secreto propio (`MCP_PREVIEW_SECRET`), atada al usuario, la tool, los argumentos y la versión de lo afectado. Caduca a los 30 min.
   - **Fase 2:** los mismos argumentos más la clave. Si algo cambió, no escribe.
   - **Reemplaza a `confirmar: true`.**
   - **Odoo:** su `preview-token` se monta sobre el mecanismo común.
   - **Riesgo bajo:** escribe directo.
6. **Renombres, una sola vez por conector.**
   - **Revierte** la regla «no renombrar» de ADR-034.
   - **Cuándo:** Odoo al estrenar su conector; DYMMSA-WEB en un solo PR de convenciones.
   - **Prefijos:** Odoo conserva `odoo_` (los dos conectores pueden estar prendidos a la vez); DYMMSA-WEB va sin prefijo.
   - **Verbos de DYMMSA-WEB:**
     - `get_`, `list_`, `search_`, `preview_`, `save_` y `delete_record`;
     - quedan fuera `set_`, `mark_`, `create_`, `update_` y `record_`.
7. **Español en parámetros y en los tokens de los enums,** iguales en la entrada y la salida. Ejemplo: `borrador | en_revision | aprobada | rechazada | convertida`. Las instrucciones (`BUSINESS_RULES_MD`) se reescriben con esos tokens.
8. **Entrada estricta desde el primer día.**
   - Un campo desconocido o un valor fuera del enum es error con qué corregir y un ejemplo.
   - Los errores de validación van en español.
   - Se valida todo antes de la primera escritura.
9. **Respuestas.**
   - Tres envolturas estándar: colección, registro y escritura.
   - Sin UUIDs a la vista: `ref`, `linea`, `version`.
   - `structuredContent` con el mismo JSON en texto.
   - `outputSchema` solo donde una vista lo consume.
10. **Anotaciones siempre explícitas:** `readOnlyHint` se deriva del tipo; `destructiveHint`, `idempotentHint` y `openWorldHint` son obligatorias en escrituras. El conector Odoo usa `openWorldHint: true`.
11. **Código: una tool = un archivo con `defineTool`.** De esa definición se derivan:
    - el registro;
    - el manifiesto;
    - la documentación in-app;
    - el consentimiento;
    - el presupuesto por conector;
    - los tests de contrato.

    Otras reglas:
    - la regla de negocio vive en `src/lib/<modulo>-store.ts`, compartido con la ruta;
    - la tool solo mapea, resuelve nombres, llama al store y presenta;
    - las dependencias llegan por `ctx`;
    - `DomainError` es común a rutas y tools.
12. **Odoo DYMMSA (catálogo objetivo de 15 tools):**
    - una cifra de cartera bruta por factura (`odoo_list_receivables`, `odoo_get_customer`);
    - `odoo_get_document` por folio;
    - se retiran `odoo_employee_directory` y `odoo_fleet_status`, porque los cubre la primitiva `odoo_search_records`;
    - `odoo_confirm_quotation` separada de `odoo_save_quotation`;
    - `odoo_create_draft_invoice` en dos fases;
    - #154 (clave SAT) entra en la vista previa sin tool nueva.
13. **Decisiones previas que se reabren:**
    - **ADR-015:** se revierte el «núcleo solo lectura» del 2026-08-20, y `save_task` puede editar título y descripción en dos fases.
    - **ADR-033 §9:** el MCP **sí** podrá confirmar borradores y cerrar o reabrir cortes de nómina (`save_payroll_period`, dos fases; al confirmar, la clave se ata al conjunto de borradores).
    - **ADR-037:** `save_supplier` puede crear marcas con `crear_marcas: true`.
    - **ADR-040:** se aprueba una séptima operación para asignar la clave SAT a un producto existente. Va dentro de `odoo_save_product`, con el botón de la vista, y `product.unspsc.code` entra al catálogo de lectura.
    - **Sin cambio:** la tarifa por hora sigue sin viajar por el MCP.

## Presupuestos por conector

| Conector | Tools | `tools/list` (en el cable) | Descripciones | Instrucciones |
|---|---|---|---|---|
| DYMMSA-WEB | 45 | 53,000 | 19,000 | 6,000 |
| Odoo DYMMSA | 16 | 21,500 | 6,500 | 3,000 |

**Unidad de `tools/list`.**
- **Desde #158** se mide el `tools/list` real en el cable, con anotaciones y estructura JSON.
- **Conversión:** los topes salieron de 46,000 y 19,000 con el método viejo del stub, convertidos con los factores medidos ese día: ×1.147 para el bloque app (32,891 contra 28,674) y ×1.125 para Odoo (20,272 contra 18,019). Los dos sumandos del stub dan 46,693 y el total medido 46,692: es un carácter de redondeo, no dos mediciones distintas.
- **En B1** se mide cada conector de verdad y se fijan los topes con esa medición.
- **Valores de transición de B1** (`ODOO_BUDGET`, review PR #162): mientras «Odoo DYMMSA» sirve las 19 tools de hoy, su tope es **20 tools y 7,000 de descripciones** (medidas: 19 y 6,932). B2a los baja a los 16 / 6,500 de la tabla. Hasta B3 el tope de tools no se repetía porque `ODOO_BUDGET.tools` salía de `TOOL_BUDGET.tools.odoo`.
- **Después:** se re-miden al cerrar cada fase, y subir un tope es un cambio explícito en su PR.

### B3: medidas finales (2026-10-24)

`/api/mcp` dejó de servir las `odoo_*`. Cada tope vive **una sola vez**, junto a la definición de su conector: `DYMMSA_BUDGET` (`connectors/dymmsa/connector.ts`) y `ODOO_BUDGET` (`connectors/odoo/connector.ts`), los dos como `budget` de su `ConnectorDefinition`. `TOOL_BUDGET` (`manifest.ts`) se quedó solo con los topes por tool, comunes a los dos (1,000 caracteres por descripción; `record_payroll_hours` 2,600). `tests/mcp/connectors.test.ts` mide cada conector contra los suyos y `manifest.test.ts` los de cada tool.

| Conector | Rol | Tools | `tools/list` (en el cable) | Descripciones | Instrucciones |
|---|---|---|---|---|---|
| DYMMSA-WEB | admin | 36 de 45 | 32,891 de 53,000 | 12,925 de 19,000 | 5,978 de 6,000 |
| DYMMSA-WEB | member | 29 | 23,926 | 8,458 | 5,371 |
| Odoo DYMMSA | admin | 15 de 16 | 19,667 de 21,500 | 6,333 de 6,500 | 2,891 de 3,000 |
| Odoo DYMMSA | member | 10 | 10,448 | 4,179 | 2,113 |

- **Ningún tope cambia:** todo cabe en los de la tabla de arriba. Los de `tools/list` y descripciones se miden con la lista del admin, la más grande.
- **Instrucciones de DYMMSA-WEB:** bajan de 7,945 a 5,978 caracteres para el admin y de 6,793 a 5,371 para el member. Salen el bloque B, el mapa de Odoo, la regla de notas de crédito y la del vínculo factura↔venta, que ya viven en el conector Odoo. La regla de oro pasa a «dos conectores, sin vínculo», con qué hacer si piden llevar algo de un lado al otro. **Quedan 22 caracteres de margen:** la próxima línea que se agregue tendrá que quitar otra (C6 las reescribe con los enums en español, decisión 7).
- **Con los dos conectores prendidos,** el admin paga 52,558 de `tools/list` en el cable, igual que antes de B3 con uno solo, pero ahora cada chat puede prender solo el que necesita.

## C1: contrato de entrada y errores (2026-10-24)

Cumple la decisión 8 (entrada estricta de golpe, sin semana de registro) y la parte de errores de la decisión 11.

**Lo que se encontró en el SDK** (responde la pregunta de [[02-Arquitectura/MCP-Escrituras/01-Plan]] §9):
- **El SDK 1.26 sí acepta entrada estricta sin parche.** `registerTool` y `registerAppTool` (ext-apps 1.3.2) tipan `inputSchema` como `ZodRawShapeCompat | AnySchema`. En runtime, `normalizeObjectSchema` devuelve tal cual un `z.object` de zod 4, así que el SDK parsea con el modo del schema y su `toJSONSchema` (zod mini, `io: 'input'`) emite `additionalProperties: false` para un `z.strictObject`. El raw shape de antes lo envolvía en `z.object` en modo *strip*: por eso se descartaban los campos desconocidos.
- **El mensaje del SDK no sirve tal cual.** Ante un parse fallido responde `Input validation error: Invalid arguments for tool X: ` seguido de `ZodError.message`, que en zod 4 es el JSON de los issues: prefijo en inglés y un volcado con `code`/`path`.
- **Cómo se resolvió, todo en el core:** `core/register.ts` registra `strictInput(nombre, shape)` (`core/schema.ts`). Es el `z.strictObject` con un último check que corre aunque haya otros issues (`when: () => true`), arma el mensaje en español y **lanza** un `ToolError`. El SDK convierte cualquier error que no sea `McpError` dentro de `validateToolInput` en `isError` con solo su texto, así que **el prefijo en inglés no llega al modelo**. Los tests del harness con el SDK real (`tests/mcp/strict-input.test.ts`) fallan si una versión nueva del SDK cambia eso.

**El mensaje** (`core/input-error.ts`), en tres partes:
- **Qué falló.** Primero los campos desconocidos, con sugerencia si es un error de dedo («¿quisiste decir «status»?»); después los obligatorios que faltan, en una sola frase; después el resto. El motivo sale del mensaje propio del schema; si no hay, de la versión en español de los límites, y si no, del locale `es` de zod.
- **Qué corregir.** Los campos válidos del nivel donde estaba el campo desconocido, marcando los obligatorios.
- **Ejemplo válido.** Es la propia llamada corregida: los campos desconocidos renombrados a su sugerencia o quitados, y los valores inválidos reemplazados por una muestra válida. Si mide más de 300 caracteres, se usa uno mínimo con los obligatorios. El ejemplo siempre se valida contra la tool, y un regex sin muestra registrada (la clave SAT) nunca se inventa: el campo sale del ejemplo. `definitions.test.ts` exige que todas las tools den un ejemplo aceptable.

**El locale `es` se aplica por mensaje, nunca con `z.config()`.** Uno global cambiaría también los mensajes zod de las rutas de la app según el orden en que cargue el proceso.

**Primitivas y enums.**
- **Primitivas en `core/schema.ts`:** `isoDate` (`isRealDate`, anuncia `format: date`), `isoMonth`, `limit(max, default)`, `page` y `withSample`.
- **Enums de constantes del dominio:** `QUOTATION_STATUSES`, `ORDER_STATUSES`, `PAYABLE_FILTERS`, `PAYABLE_CURRENCIES`, `TASK_PRIORITIES`/`TASK_STATES`/`TASK_CLOSE_REASONS` y `STOCK_FILTERS`. Sus listas salen de las descripciones.
- **Lo que cambió:** las 10 listas cerradas que eran `z.string()` y las 24 fechas y meses de los dos conectores. Los handlers ya no ignoran un estado desconocido: es error.
- **Se conservan los tokens de hoy.** Pasar los de DYMMSA-WEB a español es C6.

**Parámetros de Odoo en español** (los difirió B2a). Esto **reemplaza la excepción declarada** de [[02-Arquitectura/MCP-Escrituras/Auditoria-Odoo]] §5.2 para las primitivas: sus parámetros también van en español. Lo que sigue en el vocabulario de Odoo son los **valores**: modelos, campos dentro de los filtros, `orden` y `agrupar_por`.

| Tool | Antes | Ahora |
|---|---|---|
| `odoo_summarize_invoices`, `odoo_summarize_sales` | `date_from`, `date_to`, `group_by` | `desde`, `hasta`, `agrupar_por` |
| `odoo_audit_invoice_links`, `odoo_audit_payment_complements` | `date_from`, `date_to` | `desde`, `hasta` |
| `odoo_search_records` | `model`, `domain`, `fields`, `limit`, `order`, `offset` | `modelo`, `filtros`, `campos`, `limite`, `orden`, `saltar` |
| `odoo_aggregate_records` | `model`, `domain`, `group_by`, `metrics` | `modelo`, `filtros`, `agrupar_por`, `metricas` |

Un nombre viejo es error con los campos nuevos: no se aceptan alias. La vista `odoo-quotation` no manda ninguno de esos nombres, así que no se reconstruyó.

**Errores de dominio.**
- **La base:** `src/lib/domain-error.ts` (`invalid` 400, `not_found` 404, `forbidden` 403, `conflict` 409, `failed` 500). Es idéntica byte a byte a la de #157, para que las dos ramas se unan sin conflicto.
- **Los stores:** `SupplierError`, `PayrollError` y `TimeEntryError` la extienden sin cambiar su uso.
- **Las rutas:** las de esos stores responden `apiError(e, fallback, log)`.
- **El MCP:** los mapea una sola vez en `toToolResult` (`core/errors.ts`). Se borraron los `asTool` de horas y nómina y el `try/catch` de proveedores.
- **Cualquier otra excepción** es «Error interno en `<tool>`», con un log que dice qué tool falló y cuánto tardó.
- **`DomainError('failed')`** conserva su mensaje («Error al crear el proveedor»), como antes (pregunta 9 de la auditoría del código).

**Medidas** (en el cable; los topes no cambian):

| Conector | Rol | Tools | `tools/list` | Descripciones | Instrucciones |
|---|---|---|---|---|---|
| DYMMSA-WEB | admin | 36 de 45 | 33,904 de 53,000 (+1,013) | 12,567 de 19,000 (−358) | 5,978 de 6,000 |
| DYMMSA-WEB | member | 29 | 24,703 | 8,100 | 5,371 |
| Odoo DYMMSA | admin | 15 de 16 | 20,042 de 21,500 (+375) | 6,333 de 6,500 | 2,891 de 3,000 |
| Odoo DYMMSA | member | 10 | 10,672 | 4,179 | 2,113 |

`additionalProperties: false` en cada objeto y los enums cuestan bytes. Quitar las listas de valores de las descripciones y el «YYYY-MM-DD» de las fechas, que ya anuncian `format: date`, compensa una parte.

## C2: anotaciones (2026-10-24)

Cumple la decisión 10 y R8 del plan: **siempre las cuatro, explícitas**, en las 51 tools de los dos conectores.

**Cómo se hizo imposible equivocarse** ([[02-Arquitectura/MCP-Escrituras/Auditoria-codigo]] §3.3):
- **La definición ya no lleva `annotations`, sino `hints` tipados por `kind`.** `ToolDefinition` es una unión:
  - `{ kind: 'read'; hints: ReadHints }`, con `ReadHints = { openWorldHint }`;
  - `{ kind: 'write'; hints: WriteHints }`, con `WriteHints = { destructiveHint, idempotentHint, openWorldHint }`, los tres obligatorios.
- **No compila** una definición que escribe `annotations` o `readOnlyHint`, una lectura con `destructiveHint` o una escritura a la que le falta un hint. Se comprobó con `@ts-expect-error` contra `tsc`. Los tests no pasan por `tsc` (`tsconfig.json` excluye `tests/`), así que la prueba del tipo no se quedó en el repo: la garantía es que `tsc` revisa cada definición real de `src/`.
- **`toolAnnotations(tool)`** (`core/define.ts`) arma las cuatro en el orden de la spec y `core/register.ts` las registra. `readOnlyHint` sale de `kind`.
- **Red de tests:** `definitions.test.ts` revisa cada tool (las cuatro booleanas, una lectura nunca destructiva y siempre idempotente, `openWorldHint` según el conector, sin `annotations` en la definición) y fija en `WRITE_HINTS` el `E(d,i)` de cada escritura: cambiar uno es una decisión del PR. `connectors.test.ts` compara el cable con la definición.
- **Se eligió el tipo sobre «`annotations` + tests»:** con el tipo, el error aparece al escribir la definición y no al correr la suite. `ReadHints` no admite `idempotentHint` (la §3.3 lo dejaba opcional): ninguna lectura tiene efectos, así que no hay caso.

**Valores de las 12 escrituras de DYMMSA-WEB** (d = destructiva, i = idempotente). La fuente es [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]] H7, los veredictos de su §2 y la tabla de su §4.8:

| Tool | E(d,i) | Por qué |
|---|---|---|
| `save_material_presentation` | E(0,1) | Upsert por medida: solo agrega o refresca (H7) |
| `create_task` | E(0,0) | Solo agrega un issue; repetir abre otro (H7) |
| `create_payable` | E(0,0) | Solo inserta, sin llave natural. **Decidido aquí** |
| `update_task` | E(1,0) | Prioridad y estado pisan; cada comentario se suma. **Decidido aquí** |
| `set_inventory_location` | E(1,1) | Pisa o borra la gaveta; valor absoluto (H7) |
| `save_supplier` | E(1,1) | Una edición pisa y `quitar_marcas` desliga; nombre UNIQUE (H7) |
| `save_payroll_employee` | E(1,1) | Edición y baja pisan; nombre UNIQUE (H7) |
| `save_time_entries` | E(1,1) | Una corrección pisa; llave del import y checada UNIQUE (H7) |
| `save_excused_day` | E(1,1) | `quitar` borra; UNIQUE (fecha, persona) (H7) |
| `mark_payable_paid` | E(1,1) | Regresar a pendiente limpia `paid_at`; repetir no re-sella (H7) |
| `record_payroll_hours` | E(1,1) | Pisa sus propios borradores con horas absolutas (§2) |
| `update_payable` | E(1,1) | Pisa y puede cancelar; valores absolutos. **Decidido aquí** |

**Lo que la auditoría dejaba abierto, y cómo se decidió:**
1. **`create_payable` no destructiva.** La lista de H7 («las que solo agregan») no la nombra, pero cumple su criterio: solo inserta una factura `pending`. No es idempotente: repetirla registra otra.
2. **`update_payable` idempotente.** H7 no la nombra, pero cae en la fila «edita con valores absolutos» de la §4.8. Cancelar dos veces es error, no un segundo efecto.
3. **`update_task` E(1,0).** La auditoría solo da el valor del `save_task` objetivo, que es el mismo. Comentar no es idempotente.
4. **`set_inventory_location` destructiva.** Sin `location`, borra la gaveta (§2), y con una nueva pisa la anterior. H7 la deja fuera de «solo agregan».
5. **Lecturas con las cuatro.** La §4.8 deja `destructiveHint` e `idempotentHint` con «—» en las lecturas; el plan (§4) pide siempre las cuatro. Van `false` y `true`, que es lo que una lectura es. Las 11 lecturas de Odoo también las ganaron, para que la regla valga en los dos conectores.
6. **`openWorldHint: false` en tareas y en `get_month_closing`.** La leyenda de la §3 de la auditoría lo fija: GitHub es el repo propio y Odoo solo se lee dentro del cierre, como cifras de la app (decisión 1). Si un día una tool de DYMMSA-WEB habla con un tercero que otros editan, el test que ata `openWorldHint` al conector tendrá que cambiar en ese PR.

**Snapshots:** solo cambian las líneas de anotaciones. En los cuatro `tools-list.*.json` se agregan 172 líneas `destructiveHint`/`idempotentHint` (36 + 29 tools de DYMMSA-WEB y 11 + 10 de Odoo, dos líneas cada una) y no se borra ninguna. Las instrucciones no cambian.

**Medidas** (en el cable; los topes no cambian):

| Conector | Rol | Tools | `tools/list` | Descripciones | Instrucciones |
|---|---|---|---|---|---|
| DYMMSA-WEB | admin | 36 de 45 | 35,554 de 53,000 (+1,650) | 12,567 de 19,000 | 5,978 de 6,000 |
| DYMMSA-WEB | member | 29 | 26,035 | 8,100 | 5,371 |
| Odoo DYMMSA | admin | 15 de 16 | 20,548 de 21,500 (+506) | 6,333 de 6,500 | 2,891 de 3,000 |
| Odoo DYMMSA | member | 10 | 11,132 | 4,179 | 2,113 |

Cada tool paga unos 46 caracteres por las dos llaves nuevas. La auditoría estimaba unos 2,600 en el cable para DYMMSA-WEB contando las 44 tools del catálogo objetivo.

**Pendiente (pregunta del plan §9):** probar en claude.ai si `destructiveHint` u `openWorldHint` cambian qué tools piden aprobación por default.

## Consecuencias

- **Reconexión.** El admin agrega «Odoo DYMMSA» en claude.ai y en Claude Code, y vuelve a dar los permisos por tool de las renombradas. Las rutinas que citan nombres viejos se actualizan.
- **Requisitos antes de abrir Órdenes e Inventario:**
  - los bugs de stock (Track 0);
  - mover el stock de forma atómica en la BD.
- **Cotizaciones** requiere antes el arreglo de `/approve` con ids viejos.
- **Variable nueva** `MCP_PREVIEW_SECRET` en Vercel (Production y Preview).
- **El trabajo se ordena por fases:** A (base sin cambio de comportamiento), B (separar), C (calidad transversal) y D (escrituras por entidad, en pares store → tool).
