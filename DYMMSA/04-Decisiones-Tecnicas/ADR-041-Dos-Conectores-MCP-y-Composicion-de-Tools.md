# ADR-041: dos conectores MCP (DYMMSA-WEB y Odoo DYMMSA) y reglas de composición de tools

**Fecha:** 2026-10-22
**Estado:** Aceptado. Implementación por fases, ver [[02-Arquitectura/MCP-Escrituras/01-Plan]] §7. **B3 hecho (2026-10-24):** los dos conectores ya están separados; medidas finales en § «Presupuestos por conector». **C1 hecho (2026-10-24):** entrada estricta, errores en español y `DomainError`; ver § «C1: contrato de entrada y errores». **C2 hecho (2026-10-24):** las cuatro anotaciones en cada tool de los dos conectores, derivadas del tipo; ver § «C2: anotaciones». **C3 hecho (2026-10-24):** envolturas estándar, `structuredContent` en cada resultado y `outputSchema` en las dos vistas; ver § «C3: envolturas y `structuredContent`». **C4–C6 hechos (2026-10-24, un solo PR):** confirmación en dos fases con clave firmada, red de cobertura de escritura y convenciones con renombres y `delete_record`; ver § «C4», «C5» y «C6».
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
- **Primitivas en `core/schema.ts`:** `isoDate` (`isRealDate`, anuncia `format: date`), `isoMonth`, `limit(max, default, qué?)`, `page(nota?)` y `withSample`. `limit` y `page` arman su texto completo (tope y default), así que no se les pone `.describe()` encima (review PR #170).
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
| DYMMSA-WEB | admin | 36 de 45 | 33,957 de 53,000 (+1,066) | 12,584 de 19,000 (−341) | 5,978 de 6,000 |
| DYMMSA-WEB | member | 29 | 24,764 | 8,117 | 5,371 |
| Odoo DYMMSA | admin | 15 de 16 | 20,059 de 21,500 (+392) | 6,333 de 6,500 | 2,891 de 3,000 |
| Odoo DYMMSA | member | 10 | 10,689 | 4,179 | 2,113 |

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
| DYMMSA-WEB | admin | 36 de 45 | 35,607 de 53,000 (+1,650) | 12,584 de 19,000 | 5,978 de 6,000 |
| DYMMSA-WEB | member | 29 | 26,096 | 8,100 | 5,371 |
| Odoo DYMMSA | admin | 15 de 16 | 20,565 de 21,500 (+506) | 6,333 de 6,500 | 2,891 de 3,000 |
| Odoo DYMMSA | member | 10 | 11,149 | 4,179 | 2,113 |

Cada tool paga unos 46 caracteres por las dos llaves nuevas. La auditoría estimaba unos 2,600 en el cable para DYMMSA-WEB contando las 44 tools del catálogo objetivo.

**Pendiente (pregunta del plan §9):** probar en claude.ai si `destructiveHint` u `openWorldHint` cambian qué tools piden aprobación por default.

## C3: envolturas y `structuredContent` (2026-10-24)

Cumple la decisión 9 (respuestas) en lo que no cambia la forma de las tools que ya existen: esas se migran cuando C6 las fusiona o renombra, para romper las rutinas una sola vez ([[02-Arquitectura/MCP-Escrituras/Auditoria-codigo]] §3.5).

**Las llaves elegidas.** La tabla de la §3.5 y el plan §4 difieren. Gana el plan, completado con la §4.3 de [[02-Arquitectura/MCP-Escrituras/Auditoria-DYMMSA-WEB]], que es su versión detallada:

| Envoltura | Llaves | Helper (`core/envelope.ts`) |
|---|---|---|
| Colección | `total`, `pagina`, `por_pagina`, `hay_mas`, `nota?` y al final `<plural>` | `listResult(plural, filas, { total, pagina, por_pagina }, nota?)` |
| Registro | `ref?`, la entidad, `avisos?`, `nota?` | `recordResult(entidad, { ref, avisos, nota })` y `refOf(uuid)` |
| Escritura | `accion`, `escrito`, `<entidad>`, `cambios?`, `avisos?`, `bloqueos?`, `clave?`, `vence?`, `nota?` | `writeResult(accion, entidad, datos, detalles)` y `diff(antes, ahora, ignorar)` |
| Vista previa | `puede_guardar`, `bloqueos`, `avisos`, `clave`, `vence`, `siguiente_paso` | `previewEnvelope` (shape zod; el helper que firma la clave es C4) |
| Error | `isError` con el texto de `toToolResult` (C1), nunca `structuredContent` | sin cambio |

Cómo se decidió cada diferencia:
1. **Colección: `hay_mas` y `por_pagina`** (plan) en vez de `truncado`, `mostrados` y `paginas` (§3.5).
   - `mostrados` es el largo de la lista y `paginas` sale de `total` y `por_pagina`: no viajan.
   - `hay_mas` se calcula de los números (`(pagina − 1) × por_pagina + mostrados < total`), así que no puede contradecirlos.
   - Sin `nota` propia, la envoltura dice «Hay N más: pide pagina=X.» (§4.4 de la auditoría).
2. **Escritura: `escrito` es booleano** (§4.3) y **sale de `accion`**: solo `creado`, `actualizado` y `borrado` escriben. La entidad va con su nombre (`factura`, `proveedor`), no en una llave genérica.
3. **Tokens de `accion`:** la unión de las dos listas, con la ortografía del plan: `simulado | creado | actualizado | borrado | sin_cambios | ya_existia`.
   - `borrado`, el de `delete_record`, en vez de `quitado`.
   - `ya_existia` se queda para el alta idempotente que encuentra a su gemela.
   - `simulado` es la fase 1 de una escritura en dos fases (C4).
4. **`vence`, no `expira`:** es el nombre que ya usa la vista previa de Odoo y el que leerá la fase 1 de C4.
5. **`nota`** es el texto libre de las tres envolturas. `siguiente_paso` queda solo en la vista previa, donde ya está y lo leen las vistas.
6. **Lo opcional solo viaja si dice algo** (R11): una lista vacía, `null` o `undefined` no salen. Ausencia = nada que decir.
7. **Llaves reservadas:** el tipo no deja llamar a la lista o a la entidad como una llave de la envoltura (`Exclude<K, …>`), y el helper también lo rechaza en runtime.

**`structuredContent` en cada resultado.**
- **Cómo:** `run()` pasa por `toolResultOf()` (`core/result.ts`). El texto es `JSON.stringify(datos)` y `structuredContent` es **ese mismo texto parseado**: el mismo JSON byte por byte (sin `undefined`, las fechas como texto).
- **Límites:** la spec solo admite un objeto, así que una lista o un escalar se quedan en texto. Un error sigue siendo solo texto.
- **El texto sigue siendo la fuente del modelo.** La pregunta del plan §9 queda abierta.
- **Lo que cuesta:** nada en `tools/list`, donde no viaja. En cada respuesta el JSON va dos veces por el cable: con el reporte del checador de prueba, 2,217 → 4,124 caracteres. Si claude.ai le pasa al modelo los dos, cada respuesta paga el doble de tokens. **Revertir es una línea** en `toolResultOf()`: emitirlo solo cuando hay `output`.

**`outputSchema`, solo en las dos vistas** (`output` en `defineTool`; `definitions.test.ts` exige `output` ⇔ `view`):
- **`preview_time_report`: completo y estricto** (`previewTimeReportOutput` en `tools/hours.ts`).
  - La vista toma su tipo de `z.infer<typeof previewTimeReportOutput>`, no del retorno del handler.
  - `previewTimeReport()` declara ese tipo: una llave de más no compila.
- **`odoo_preview_quotation`: mínimo** (`previewQuotationOutput`, `z.looseObject`).
  - Lleva `modo`, la envoltura de vista previa y las cuatro listas que la vista recorre (`lineas`, `productos_nuevos`, `productos_para_alta`, `sin_clave_sat`), sin detallar sus filas.
  - El completo no cabe en `ODOO_BUDGET`.
  - La vista sigue tipada por `QuotationPreview` y **`defineTool` amarra los dos**: el handler no compila si `QuotationPreview` deja de cumplir el schema.
- **Cómo se ata el tipo:** `defineTool<S, O>` infiere `O` de `output` y exige que el handler devuelva `OutputOf<O>`, solo o envuelto en `withResultMeta`. `OutputOf` es el `z.input` del schema, aceptando arreglos `readonly` y sin pedir la firma de índice de un objeto abierto. Se probó con `@ts-expect-error` contra `tsc` (falta una llave, tipo distinto, dato envuelto distinto, `QuotationPreview` sin una llave exigida, llaves reservadas de las envolturas). Como en C2, esa prueba no se quedó en el repo.
- **Nunca un `z.object` normal.** Pasa en el servidor con llaves de más, porque zod las quita al validar. Pero su JSON Schema dice `additionalProperties: false` y el cliente, que valida con Ajv, rechaza el resultado. Un output es `z.strictObject` o `z.looseObject`; `definitions.test.ts` lo vigila comparando su JSON Schema de entrada y de salida.
- **Las vistas leen `structuredContent`** (`dataOf()`) y, si el host no lo pasa, el mismo JSON del texto. También lo leen del resultado de `save_time_entries` y de `odoo_save_product`, que no declaran `output`.
- **Si un output no se cumple,** el SDK responde `isError` con su mensaje en inglés y el volcado de zod. Es un error de programación: lo atrapan los tests de contrato antes de llegar al modelo.

**Lo que ya adoptó una envoltura** (sin cambiar la forma para quien la lee):
- `save_supplier` y `save_payroll_employee` ya eran `{ accion, <entidad>, nota? }` con tokens del plan: pasan por `writeResult` y solo ganan `escrito: true`.
- `update_payable` calcula `cambios` con `diff()`, la generalización de su propio cálculo. La respuesta sale idéntica, y un test la compara con el cálculo viejo. Su `writeResult` llega cuando C6 la fusione en `save_payable`.
- Ninguna lista de hoy tiene `pagina` ni `hay_mas`, y ningún registro trae `ref`: `listResult` y `recordResult` quedan listos para C6 y la Fase D.

**Tests:**
- `envelope.test.ts`: los helpers y `toolResultOf`.
- `structured-output.test.ts`, con el SDK real: el output de las vistas previas reales de los dos conectores pasa en el servidor y en el cliente; un error no trae `structuredContent`; por qué no un `z.object` normal.
- `definitions.test.ts`, por definición: `output` ⇔ `view`, una muestra por tool con `output`, el `outputSchema` en `tools/list`, `structuredContent` igual al texto y una respuesta rota es error.
- `views.test.ts`: la vista de Odoo lee `structuredContent`, y ninguna vista empaqueta código de `src/lib` ni zod.

**Snapshots:** solo cambian `tools-list.admin.json` y `tools-list.odoo.admin.json` (el `outputSchema` de las dos vistas) y sus `tools-size`. Los de member y las instrucciones no cambian.

**Medidas** (en el cable; los topes no cambian):

| Conector | Rol | Tools | `tools/list` | Descripciones | Instrucciones |
|---|---|---|---|---|---|
| DYMMSA-WEB | admin | 36 de 45 | 37,324 de 53,000 (+1,717) | 12,584 de 19,000 | 5,978 de 6,000 |
| DYMMSA-WEB | member | 29 | 26,096 | 8,117 | 5,371 |
| Odoo DYMMSA | admin | 15 de 16 | 21,369 de 21,500 (+804) | 6,333 de 6,500 | 2,891 de 3,000 |
| Odoo DYMMSA | member | 10 | 11,149 | 4,179 | 2,113 |

- `preview_time_report` pasa de 1,088 a 2,805 caracteres (su `outputSchema` mide 1,701) y `odoo_preview_quotation` de 2,939 a 3,743 (788). El member no cambia: las dos tools son `adminOnly`.
- **A Odoo le quedan 131 caracteres de `tools/list`.** No se recortó ninguna descripción. El próximo cambio que agregue texto a una tool de Odoo tendrá que quitar otro o subir el tope en su PR.
- **Para quien adopte las envolturas (review del PR #173):**
  - **`ref` todavía no se resuelve.** Los buscadores por id de `payables.ts` y `orders.ts` exigen el UUID completo (`isUuid`), así que un `ref` de 8 caracteres cae en la búsqueda por texto. Las tools que devuelvan `ref` antes de C6 corren ese riesgo: C6 hace que los `get_*` lo acepten (`id::text like '<8hex>%'` y `requireSingleMatch` si hay varias).
  - **Listas vacías.** En una vista previa `bloqueos` y `avisos` siempre viajan, aunque vengan vacías; en una escritura (`writeResult`) y en un registro (`recordResult`) una lista vacía no viaja. C4 lee `bloqueos`, `clave` y `vence` de la vista previa, no de la escritura.
  - **`hay_mas` necesita un `total` exacto.** `listResult()` lo calcula contra `total`; con `total: items.length` en una página llena respondería `hay_mas: false` en silencio. Quien lo adopte debe pasar el conteo real (el `count` de PostgREST) o extender el helper para aceptar `total: null`.

**Pendiente (plan §9):** medir en claude.ai si el modelo recibe el texto, el `structuredContent` o los dos. Si son los dos, emitirlo solo donde hay `output`.

## C4: confirmación en dos fases (2026-10-24)

Cumple la decisión 5. El mecanismo vive en `src/lib/mcp/core/confirm/`, fuera de `src/lib/odoo/`.

**La clave** (`preview-key.ts`, `token.ts`):
- Es un token HMAC `base64url(claims).mac` con la llave derivada del **propósito**: una clave de una familia nunca abre otra, diga lo que diga su contenido. Los propósitos son `tool` (las claves de esta sección), `odoo-quotation` y `odoo-products`.
- Una clave de herramienta lleva **usuario, herramienta, hash de los argumentos canónicos** (sin `clave`, sin `undefined`, llaves ordenadas), **huella de lo que la escritura toca** y **caducidad de 30 minutos**. El orden de las comprobaciones es firma → usuario → herramienta → argumentos → caducidad, y cada fallo tiene su mensaje (la de otra herramienta la nombra).
- El secreto es `MCP_PREVIEW_SECRET`, leído en cada llamada y de **al menos 32 caracteres**; uno más corto cuenta como ausente. Sin él, la confirmación falla cerrada.

**El núcleo decide la fase** (`defineTool` con `confirm: 'two_phase'`, `core/confirm/two-phase.ts`):
- La tool aporta `plan()`, que lee, valida y devuelve el resumen (`entity`, `cambios`, `avisos`, `bloqueos`), la **huella** y un `subject`; **nunca escribe**. Aporta también `commit()`. No tiene `handler`: el núcleo lo arma. El `clave` se agrega solo al esquema de entrada.
- **Sin `clave`:** fase 1 → `writeResult('simulado', …)` con `escrito: false`, el resumen, `clave` y `vence`. Con `bloqueos` no se emite clave y la nota dice que se corrijan. `sinCambios` responde `sin_cambios`, también sin clave.
- **Con `clave`:** verifica la firma **antes** de leer nada, vuelve a correr `plan()` y compara huellas; si algo cambió responde «<subject> cambió desde el resumen: vuelve a pedirlo. No escribí nada.». Después, si el plan trae `bloqueos`, no escribe. `plan.carry` pasa lo ya leído a `commit()`: una petición no lee dos veces (el plan de Odoo cuesta ~7 s de cola).
- **Fail closed:** sin secreto, una tool de dos fases responde «La confirmación en dos pasos no está disponible en este servidor (falta MCP_PREVIEW_SECRET): no escribí nada.» antes de leer. Las escrituras directas siguen funcionando.

**Decisión nueva: `direct`.** `save_payable` y `save_task` son directas casi siempre y piden el sí solo para lo sensible (cifras de una pagada; título o descripción de una tarea). El plan decía «directo» y «dos fases solo si…» sin un mecanismo para eso. Una tool que declara `direct: true` deja que su `plan()` marque la llamada `directo: true`: la fase 1 escribe de inmediato, sin clave **y sin secreto**. Lo demás exige el secreto como cualquier tool de dos fases. Un `bloqueo` se muestra siempre primero, aun en una llamada directa.

**Odoo se monta sobre el mismo token**, con dos precisiones:
- **Conserva su secreto** (derivado de `ODOO_WRITE_API_KEY`), no pasa a `MCP_PREVIEW_SECRET`. Así el flujo de cotizar y confirmar sigue igual hasta que el usuario ponga el secreto nuevo en Vercel, y sin la llave de escritura sigue bloqueado como antes. Conserva también sus claims (`ks`, `a`, `write_date`) y sus mensajes; `canonicalJson` se reexporta de `preview-token.ts`. Las claves en vuelo al desplegar (≤ 30 min) dejan de servir.
- **`odoo_create_draft_invoice` pasa de `confirmar: true` a `clave`** (decisión 5) y usa el núcleo: necesita `MCP_PREVIEW_SECRET`. Su resumen es la fase 1; una venta que ya tiene borrador responde `sin_cambios` (con el aviso de la nota interna si le falta el rastro). El mensaje de resultado incierto dice «pide otra vez el resumen con el mismo folio», porque repetir la clave ya no aplica.
- **`AdminProof` pasa a `src/lib/auth/admin-proof.ts`** y lanza `DomainError('forbidden')`, no `OdooError`: ya no es solo de Odoo.

**`save_time_entries` con `filas` exige la clave que firma `preview_time_report`** (gemela de lectura): argumentos `{ filas, nombre_archivo }`, huella = a quién corresponde cada id del checador. La vista manda la clave y apaga el botón sin ella. `checada` sigue directa. **Mientras el secreto no exista, la carga semanal queda cerrada a propósito** (la vista lo dice). El resto de las escrituras directas no se afecta.

**Instrucciones:** una línea fija en los dos conectores (`CONFIRMATION_RULE`): la primera llamada no escribe y trae el resumen; se muestra, se espera el sí y solo entonces se repite con la misma entrada y la clave; nunca se encadenan las dos fases sin la respuesta del usuario. Las de DYMMSA-WEB se recortaron en otras líneas para caber (5,993 de 6,000 en este commit).

**Tests** (`two-phase.test.ts`, `preview-key.test.ts`, SDK real): firma, caducidad, otro usuario, otra herramienta, otros argumentos y clave alterada o de otro propósito; huella cambiada; sin secreto o con uno corto; bloqueos; `sin_cambios`; `direct` con y sin secreto; un member no ve la tool. Los de Odoo (`odoo-preview-token`, `odoo-invoices-write`) pasan sobre la base nueva.

## C5: red de cobertura de escritura (2026-10-24)

`tests/mcp/write-coverage.test.ts` clasifica **cada handler `POST`/`PATCH`/`PUT`/`DELETE`** de `src/app/api/` (71 hoy) como una tool que lo cubre (existe y escribe), una lectura por POST (`quotes/lookup`, `urrea-catalog/lookup`, con la tool de lectura que responde lo mismo), un refresco de caché (`finance/income/refresh`, `clients/refresh`), la ruta pública (`approve/[token]`) o `fuera: <motivo>`. Falla si un handler no tiene decisión, si una entrada no tiene handler, si la tool citada no existe o no es del tipo que debe, o si un motivo está vacío.
- **26 handlers quedan como `Fase D: …`**: ajustes, cotizaciones (5), órdenes (8), compra y corte (2), inventario (2), productos (2), catálogo URREA (2), perfiles (2) y nómina (2). El PR de D los pasa a su tool; al terminar no debe quedar ninguno con ese prefijo.
- **Una duda que ni C ni D resuelven:** `POST brands`. El ADR (§13) aprueba `save_supplier.crear_marcas`, pero ninguno de los dos PRs lo trae. Queda con un motivo que lo dice; hay que decidirlo antes de cerrar D.
- Fuera a propósito: borrar cotizaciones, órdenes, productos, inventario y catálogo (decisión 4), las cargas por Excel, la foto de perfil, las imágenes de una tarea y el aprendizaje interno de las órdenes.

## C6: convenciones, renombres y borrado (2026-10-24)

**Tokens en español**, iguales en la entrada y la salida, con su mapa a la BD junto a cada constante de dominio (`tokenMap()` en `src/lib/tokens.ts`):
- cotización `borrador | en_revision | aprobada | rechazada | convertida`; orden `pedida | recibida | entregada | completada | cancelada`; `estado_urrea` `pendiente | surtido | no_surtido`;
- entrega `inmediata | 2_3_dias | 3_5_dias | 1_semana | 2_semanas | indefinida`; existencias `todas | con_existencia | suficiente | poca | sin_existencia`;
- factura `pendiente | pagada | cancelada` (y `vencida` solo como filtro); tarea `abierta | cerrada`, prioridad `baja | media | alta | urgente`, motivo `completada | descartada`;
- rol `administrador | miembro`, área `oficina | taller`, jornada `completa | media`, día justificado `feriado | salida_autorizada`; aprobación `pendiente | aprobada | rechazada` y `se_vende` `sin_definir | si | no`.
El valor de la BD en inglés **ya no se acepta**. `BUSINESS_RULES_MD` se reescribió con los tokens nuevos (las instrucciones del admin bajaron de 5,978 a 5,497).

**Un solo buscador** (`resolveByName()`, `core/lookup.ts`): acepta UUID, `ref` (los 8 primeros hex) o nombre y termina en `requireSingleMatch` con hasta 5 candidatos y su `ref`. **El `ref` se busca como rango del uuid** (`id >= '<8hex>-0000-…' and id <= '<8hex>-ffff-…'`), no con `id::text like`: PostgREST no castea en un filtro y los uuid ordenan por bytes. Si un nombre parece ref y no pega con ningún id, se busca como nombre. Lo usan cotizaciones, órdenes, facturas, proveedores, personas, marcas y los `get_*`.

**`linea` y `version`:** `get_quotation` y `get_order` numeran **todas** las filas (secciones incluidas, 1-based) y devuelven una `version` (hash de los ids de las líneas en orden y de `updated_at`). La Fase D las usa para editar por línea y como concurrencia.

**Renombres y fusiones** (36 → 33 tools, +1 con `delete_record` = 34):

| Antes | Ahora | Notas |
|---|---|---|
| `create_payable`, `update_payable`, `mark_payable_paid` | `save_payable` | E(1,0). Directa; dos fases solo al cambiar monto, moneda, proveedor o fechas de una **pagada** |
| `create_task`, `update_task` | `save_task` | E(1,0). Directa; título o descripción en dos fases (ADR-015 reabierto) |
| `set_inventory_location` | `save_inventory_item` | `productos: [{ codigo, ubicacion }]`, hasta 30; solo gaveta. E(1,1) hoy; D la pasa a E(1,0) |
| `record_payroll_hours` | `save_payroll_hours` | Mismo contrato; responde con la envoltura de escritura |
| `get_profiles` | `list_profiles` | Más `area`; es una colección |

Parámetros en español en toda DYMMSA-WEB (`buscar`, `estado`, `pagina`, `por_pagina`, `existencias`, `cotizacion`, `orden`, `tarea`, `prioridad`, `limite`, …). Las listas dejan de mostrar UUIDs (`ref`). Las respuestas pasan a `listResult` / `recordResult` / `writeResult`; `get_cut_plan` numera sus piezas (`pieza` es un número, no un UUID). Las tareas no traen total (GitHub no lo da): su colección dice solo `hay_mas`.

**Stores nuevos o ampliados**, compartidos con sus rutas: `tasks-store` (crear, comentar, editar; las tres rutas de tareas), `inventory-store` (la gaveta), `payables-store.createPayable`, `excused-days-store`, `materials-store`, y `deleteSupplier` / `deleteBrand` / `deleteTimeEntry`.

**`delete_record`** (`tipo` = proveedor, marca, medida, factura, checada, dia_justificado): **siempre dos fases**, E(1,1), solo administrador.
- La fase 1 dice qué se pierde (una checada importada vuelve con el re-import; una corregida a mano pierde su corrección) o qué la **bloquea** con el conteo: un proveedor con facturas, una marca en uso, una factura pagada. Con bloqueos no hay clave.
- **Es de administrador** aunque la app deja borrar a cualquiera con sesión: el borrado es el movimiento más caro de deshacer y el conector solo lo usa un administrador (decisión 2); la RLS sigue respaldando.
- `save_excused_day` pierde `quitar`. Los DELETE de la app pasan por los mismos stores, y borrar una medida con un id mal formado es 404, no 500.

**Evaluación (R12):** `docs.evals` (1–3 frases) es obligatorio en las 49 definiciones, y `tests/mcp/evals.test.ts` exige que el guion de la bóveda ([[02-Arquitectura/MCP-Escrituras/Guion-Evaluacion]]) nombre cada tool y no cite nombres que ya no existen. Documentación en la app: la etiqueta «pide tu si» sale del catálogo (`confirm`), y el consentimiento se regenera solo.

**Limpieza de B3:** `ToolBlock` y `ConnectorId` son el mismo tipo (las entradas del manifiesto llevan `connector`; el resumen de consentimiento se indexa por conector), y `serverInfo.title` es `CONNECTOR_NAMES`, amarrado por una prueba. Versión de DYMMSA-WEB: 4.0.0.

### Decisiones que la especificación no cubría
1. **Odoo conserva su secreto** (derivado de la llave de escritura) para no romper su flujo antes de que exista `MCP_PREVIEW_SECRET`; solo `odoo_create_draft_invoice` y `save_time_entries` con `filas` esperan el secreto nuevo.
2. **`direct`** (arriba) para las dos fases condicionales de `save_payable` y `save_task`.
3. **`delete_record` es de administrador.**
4. **Quedan 34 tools, no 31:** el plan contaba −5 por fusión; las fusiones reales son −3 (payables 3→1, tareas 2→1).
5. **`save_inventory_item` ya recibe `productos[]`**, la forma que D necesita, para no romper dos veces.
6. **El reportero de las tareas sigue siendo «Asistente (MCP)»** (la auditoría proponía el correo del usuario): es un cambio visible para el equipo que no se pidió.
7. **`crear_marcas` queda sin dueño** (ver C5).

### Rutinas a actualizar
Reconectar «DYMMSA-WEB» en claude.ai (web, escritorio, móvil) y Claude Code, y actualizar lo que cite nombres viejos, sobre todo **la rutina de los viernes**: `record_payroll_hours` → `save_payroll_hours`; `get_profiles` → `list_profiles`; `set_inventory_location` → `save_inventory_item`; `create_payable` / `update_payable` / `mark_payable_paid` → `save_payable` (con `estado: pagada`, `pendiente` o `cancelada`); `create_task` / `update_task` → `save_task`; `save_excused_day(quitar: true)` → `delete_record(tipo: dia_justificado)`. `save_time_entries` con `filas` pide ahora la `clave` de `preview_time_report`. Los parámetros en inglés (`status`, `search`, `page`, `pageSize`, `stockFilter`, `query`, `limit`, `task_number`…) se escriben en español.

### Medidas al cerrar C (en el cable; los topes no cambian)

| Conector | Rol | Tools | `tools/list` | Descripciones | Instrucciones |
|---|---|---|---|---|---|
| DYMMSA-WEB | admin | 34 de 45 | 37,318 de 53,000 | 12,086 de 19,000 | 5,652 de 6,000 |
| DYMMSA-WEB | member | 26 | 24,080 | 7,260 | 4,807 |
| Odoo DYMMSA | admin | 15 de 16 | 21,371 de 21,500 | 6,332 de 6,500 | 2,974 de 3,000 |
| Odoo DYMMSA | member | 10 | 11,149 | 4,179 | 2,088 |

- **Por commit del PR (admin, `tools/list`):** 1 (confirmación) 37,599 (+275); 3 (convenciones) 37,999; 4 (fusiones) 35,455 (−2,544); 5 (`delete_record`) 37,318 (+1,863).
- **A Odoo le quedan 129 caracteres de `tools/list` y 26 de instrucciones.** No se tocó ningún tope.
- **A DYMMSA-WEB le quedan 348 caracteres de instrucciones**: el mapa por módulo crece con cada tool de D; el riesgo real sigue siendo ese tope.

## Consecuencias

- **Reconexión.** El admin agrega «Odoo DYMMSA» en claude.ai y en Claude Code, y vuelve a dar los permisos por tool de las renombradas. Las rutinas que citan nombres viejos se actualizan.
- **Requisitos antes de abrir Órdenes e Inventario:**
  - los bugs de stock (Track 0);
  - mover el stock de forma atómica en la BD.
- **Cotizaciones** requiere antes el arreglo de `/approve` con ids viejos.
- **Variable nueva** `MCP_PREVIEW_SECRET` en Vercel (Production y Preview).
- **El trabajo se ordena por fases:** A (base sin cambio de comportamiento), B (separar), C (calidad transversal) y D (escrituras por entidad, en pares store → tool).
