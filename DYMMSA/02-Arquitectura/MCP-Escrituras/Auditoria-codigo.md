# MCP escrituras — Auditoría del código del MCP

> Issue #155 · Arquitectura del MCP · 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[04-Decisiones-Tecnicas/ADR-023-MCP-OAuth]] · [[04-Decisiones-Tecnicas/ADR-034-MCP-Reglas-de-Crecimiento]] · [[04-Decisiones-Tecnicas/ADR-040-Escrituras-Acotadas-en-Odoo]]

Esta nota no juzga el diseño de cada tool (eso lo hacen las fichas y la rúbrica R1–R12). Revisa **cómo está construido el código del MCP** con principios de código limpio y propone la estructura para dos cambios ya decididos:

- dos conectores en la misma app: **«DYMMSA-WEB»** en `/api/mcp` y **«Odoo DYMMSA»** en `/api/odoo/mcp`, con una sola allowlist de OAuth;
- unas 20 tools de escritura nuevas (ver la Matriz).

## Resumen

- El MCP funciona y tiene piezas buenas: `db` por token sin service_role, `ToolError`, `requireSingleMatch`, la fachada de escritura de Odoo con `AdminProof`, el presupuesto vigilado por test y el consentimiento generado. El problema es **cómo crece**, no si funciona.
- Cada tool se describe en **tres o cuatro lugares**:
  - el registro inline de `server.ts`;
  - el manifiesto escrito a mano;
  - la interfaz TS de su archivo;
  - y, si escribe, la validación de la ruta.

  Un test con regex los amarra. Con 20 escrituras más y dos conectores, ese costo se multiplica.
- `registerDymmsaTools` es **una función de 885 líneas** con los dos bloques mezclados. Separar los conectores hoy sería cirugía en ese archivo.
- La entrada **no es estricta**: el SDK descarta en silencio los campos que no conoce, y sus errores de esquema llegan en inglés. Además, los enums y las fechas son `z.string()` con la lista escrita en la descripción.
- La propuesta:
  - **una definición por tool** (`defineTool`) de la que se derivan registro, manifiesto, documentación, consentimiento, presupuesto y tests;
  - un `core/` sin conocimiento de módulos;
  - un conector por carpeta;
  - **los stores como única casa de las reglas**: la ruta y la tool solo mapean y traducen.
- Orden: primero una red de seguridad (snapshot de `tools/list`), después el core y las definiciones sin cambio de comportamiento, después el segundo conector y al final las escrituras, módulo por módulo con su store.

## 1. Cómo está hoy

### Flujo de una llamada

```
Claude (web / escritorio / móvil / Code)
  │  POST /api/mcp   Authorization: Bearer <token OAuth de Supabase>
  ▼
src/proxy.ts ─ el matcher excluye api/mcp y .well-known (no redirige a /login)
  ▼
src/app/api/[transport]/route.ts (68 líneas)
  withMcpAuth(handler, verifyToken, { required, resourceMetadataPath, resourceUrl: appUrl() })
    └─ src/lib/mcp/oauth.ts  verifyToken: getUser → client_id ∈ allowlist (env.ts)
                             → rol leído de profiles con el token → caché 60 s por huella
  handler → handlers[roleFrom(req.auth)]   (2 createMcpHandler armados al arrancar: admin y member)
    └─ createMcpHandler(server => registerDymmsaTools(server, role),
                        { serverInfo, instructions: serverInstructions(role) })
  ▼
src/lib/mcp/server.ts (1,026 líneas)
  registerDymmsaTools(): 55 registerTool/registerAppTool inline + 2 registerAppResource
    cada registro: nombre, título, descripción, raw shape zod, anotaciones, _meta, callback
    callback: (input, extra) => run(extra, (db, ctx) => fn(db | callOdoo | deps, [ctx | userId], input))
  run(): contextFrom(authInfo) → db por token (supabase.ts) → fn → JSON.stringify → content[text] (+ _meta)
         ToolError | GitHubError | OdooError → isError con su mensaje; cualquier otro → genérico + log
  ▼
src/lib/mcp/tools/*.ts (16)  ·  src/lib/mcp/tools/odoo/*.ts (12)
  validación manual + resolución por nombre + lectura/escritura con db + presentación en español
  ▼
src/lib/*-store.ts (3) · payables.ts, payroll.ts, timesheet.ts, cut-plan.ts… · src/lib/odoo/* · src/lib/github.ts
  ▼
Supabase (RLS con el token del usuario) · Odoo JSON-2 (API key del servidor, cola serializada) · GitHub (PAT)
```

Fuera del flujo de la llamada:

- `manifest.ts`:
  - `TOOL_MANIFEST` escrito a mano, más `TOOL_BUDGET`;
  - de él leen la documentación (`AssistantSection`, dentro de una página `'use client'`) y `consent.ts` (`/oauth/consent`).
- `tests/mcp/manifest.test.ts`: un regex sobre el texto de `server.ts` amarra el registro con el manifiesto.
- `src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`: anuncia siempre `resource = …/api/mcp`.
- `src/mcp-views/*` → `scripts/build-mcp-views.ts` → `src/lib/mcp/views/generated.ts`, un solo módulo de 682 KB.
- `src/lib/health.ts`: importa `listQuotations`/`listOrders`/`searchInventory` de las tools.

### Dónde vive cada responsabilidad

| Responsabilidad | Dónde vive hoy | Comentario |
|---|---|---|
| Transporte HTTP, rol → handler | `src/app/api/[transport]/route.ts` | Un solo recurso; `SERVER_INFO` único |
| Descubrimiento RFC 9728 | `.well-known/…/[[...path]]/route.ts` + `routes.ts` | `resource` fijo a `/api/mcp` |
| Verificar token, allowlist, rol | `oauth.ts`, `env.ts`, `supabase.ts` | Bien aislado; no conoce conectores |
| Contexto por llamada | `context.ts` | Solo identidad + `db`; Odoo, GitHub y reloj llegan por import |
| Registro de cada tool (texto, esquema, anotaciones, guarda de rol) | `server.ts:142-1026` | Monolito, dos bloques mezclados |
| Ejecutar, serializar, mapear errores | `server.ts:48-61` (`run`) | Sin nombre de tool en el log; sin `structuredContent` |
| Instrucciones, reglas de negocio, guía de la hoja | `server.ts:78-136` | Contenido mezclado con el registro |
| Catálogo (docs, consentimiento, presupuesto) | `manifest.ts:30-118` | A mano, por bloque |
| Lógica de cada tool | `tools/*.ts`, `tools/odoo/*.ts` | Mezcla validación, resolución por nombre, BD y presentación |
| Reglas compartidas con rutas | `suppliers-store.ts`, `payroll-store.ts`, `time-entries-store.ts` + `parse*` sueltos | La mayoría de las escrituras siguen inline en rutas |
| Integraciones | `src/lib/odoo/*`, `src/lib/github.ts` | Singletons `callOdoo`, `odooWriter`, `fetchGitHub` |
| Vistas MCP Apps | `src/mcp-views/*` → `views/generated.ts`; URI y recurso en `server.ts:67-68, 531-533, 983-985` | La vista no está ligada a su tool ni a su conector |
| Anti-drift | `tests/mcp/manifest`, `coverage`, `views`, `consent` | Regex, listas fijas y valores de texto libre |

### Tamaños

| Archivo | Líneas | Nota |
|---|---|---|
| `src/lib/mcp/server.ts` | 1,026 | `registerDymmsaTools` ocupa 142–1026 (885 líneas): 55 registros y 8 guardas `if (forAdmin)` |
| `src/lib/odoo/quotation-plan.ts` | 1,049 | Dominio de la cotización Odoo (fuera del MCP, pero lo importa) |
| `src/lib/mcp/tools/odoo/quotations.ts` | 806 | Esquema, tipos de vista, presentadores, preview, save, relectura e idempotencia |
| `src/lib/mcp/tools/hours.ts` | 429 | 6 tools, parser del reporte y un upsert inline |
| `src/lib/mcp/tools/payables.ts` | 374 | 6 tools; `createPayable` repite la ruta |
| `src/lib/mcp/tools/odoo/accounting.ts` | 340 | |
| `src/lib/mcp/tools/odoo/draft-invoice.ts` | 299 | |
| `src/lib/mcp/manifest.ts` | 129 | Catálogo a mano + presupuesto |
| `src/lib/mcp/views/generated.ts` | 682 KB | Dos vistas de ~310 KB cada una en un solo módulo |
| `src/lib/mcp/**` (sin `generated.ts`) | 6,823 | |
| `tests/mcp/**` | 6,072 | 33 archivos |

### Lo que funciona y hay que conservar

- **`db` por parámetro y por token** (ADR-023): cero service_role. Las tools se prueban con el mock inyectado, sin `vi.mock`.
- **`ToolError` como frontera de mensajes** + `requireSingleMatch`: ninguna búsqueda por nombre adivina.
- **`withResultMeta`** (WeakMap por identidad): `_meta` nunca viaja en el texto y una fila de Odoo no puede promoverse a `_meta`.
- **Fachada de escritura de Odoo**:
  - `OdooWriter` + `AdminProof` con marca;
  - `assertWriteAllowed`;
  - presupuesto de tiempo (`deadline.ts`);
  - `OdooUncertainWriteError`.

  Es el mejor ejemplo de diseño en el MCP: tipos que hacen imposible el uso incorrecto.
- **Presupuesto medido por test** con el registro real, y **consentimiento generado** del catálogo.
- **Test de cobertura de rutas GET**: un módulo nuevo sin tool rompe el CI.

## 2. Problemas

Prioridad:
- **alto** = bloquea los dos conectores o multiplica el costo o el riesgo de las 20 escrituras;
- **medio** = deuda que conviene pagar dentro del plan;
- **bajo** = limpieza.

### Alto

**A1. El registro es un monolito con dos bloques mezclados.**
- *Dónde:*
  - `server.ts:142-1026`: una función de 885 líneas con 55 registros;
  - `server.ts:500, 514, 536, 562, 595, 609, 640, 969`: guardas de rol;
  - `server.ts:734-739`: el esquema `domainSchema` de Odoo definido a mitad de la función;
  - `server.ts:78-136`: contenido de negocio (reglas, guía de la hoja, instrucciones) en el mismo módulo.
- *Principio:* responsabilidad única y abierto/cerrado. Cada tool nueva edita el mismo archivo y la misma función.
- *Consecuencia:* partir en dos conectores obliga a cortar esta función a mano. Cada escritura nueva suma ~25 líneas a un archivo que ya nadie revisa completo.

**A2. Dos fuentes de verdad por tool, amarradas con un regex.**
- *Dónde:*
  - `manifest.ts:30-89` (escrito a mano) frente al registro en `server.ts`;
  - `tests/mcp/manifest.test.ts:24-25`: regex sobre el texto fuente;
  - `manifest.test.ts:62`: cuenta llamadas para detectar las que el regex no ve;
  - listas fijas en `manifest.test.ts:71` y `:90`;
  - `adminOnly` en el manifiesto frente a los 8 `if (forAdmin)`;
  - `kind` en el manifiesto frente a `readOnlyHint` en el registro, comparados en `manifest.test.ts:84-86`.
- *Principio:* DRY y una sola fuente de verdad.
- *Consecuencia:*
  - cada tool nueva toca 3 archivos y 2 listas de test;
  - el test protege la forma del código (comillas simples, nombre literal), no el contrato;
  - con dos conectores, el regex tendría que leer dos archivos.

**A3. La validación de cada entidad vive en cuatro lugares que no coinciden.**
- *Dónde* (ejemplo de facturas por pagar):
  - el raw shape de `create_payable` (`server.ts:420-428`);
  - la interfaz `CreatePayableInput` (`tools/payables.ts:323-333`), que repite ese shape a mano;
  - la validación manual de la tool (`tools/payables.ts:335-348`);
  - la validación manual de la ruta (`src/app/api/payables/route.ts:147-164`), con mensajes distintos para la misma regla («Fecha de factura inválida» frente a «… — usa YYYY-MM-DD»).
- Además:
  - **8 enums** son `z.string()` con la lista en la descripción (`server.ts:164, 192, 264, 362, 666, 667, 695, 712`); se validan a mano en el handler (`tools/tasks.ts:105-112`) o se **ignoran en silencio**: `tools/quotations.ts:32` y `tools/orders.ts:47` devuelven todo si el estado no existe;
  - **19 fechas** son `z.string()` sin formato.
- *Principio:* DRY y «parse, don't validate».
- *Consecuencia:*
  - cada escritura nueva repetiría el patrón cuatro veces;
  - el JSON Schema que ve el modelo no anuncia los valores válidos, así que el modelo adivina.

**A4. La entrada no es estricta y los errores de esquema llegan en inglés.**
- *Dónde:*
  - todas las tools registran un **raw shape**: el SDK 1.26 lo envuelve en `z.object` (modo *strip*, `@modelcontextprotocol/sdk/dist/esm/server/mcp.js:165-180`), así que un campo desconocido **se descarta antes del handler**;
  - el `z.strictObject` de `parseInput` (`tools/odoo/quotations.ts:213-221`) solo corre en llamadas directas, como dice su propio comentario;
  - la traducción al español (`issueReason`, `quotations.ts:205-211`) tampoco corre por el SDK, que responde «Input validation error: Invalid arguments for tool …» con los mensajes en inglés de zod.
- *Principio:* fallar rápido y mínima sorpresa (R5, R7).
- *Consecuencia:* en una escritura, un campo mal escrito (`fecha_pagos`) se ignora y la tool escribe con el default. Es el peor caso para las 20 escrituras nuevas.

**A5. Las reglas de escritura viven en la ruta o en la tool, no en un store.**
- *Dónde:*
  - solo 3 stores compartidos;
  - `createPayable` está duplicado (tool `tools/payables.ts:335-374` frente a ruta `api/payables/route.ts:139-199`);
  - `saveExcusedDay` hace upsert y delete inline (`tools/hours.ts:385-429`) mientras la ruta solo inserta (`api/excused-days/route.ts:36-60`);
  - `api/orders/[id]/cancel/route.ts:44-49` restaura stock y luego actualiza el estado **sin revisar el error**.
- *Principio:* separación de capas y una sola casa por regla.
- *Consecuencia:*
  - la Matriz cuenta ~20 extracciones pendientes antes de cablear tools;
  - una extracción que copia la ruta tal cual hace que la tool **herede el bug** (el reintento duplica stock);
  - la ruta y la tool divergen con cada cambio.

**A6. El transporte y el descubrimiento están atados a un solo recurso.**
- *Dónde:*
  - `routes.ts:3`: un único `MCP_PATH`;
  - la ruta de metadatos RFC 9728 (`.well-known/…/[[...path]]/route.ts:10-14`) devuelve `resource = …/api/mcp` para cualquier path, así que el conector Odoo recibiría un `resource` que no es su URL y un cliente que valida la coincidencia lo rechaza;
  - `withMcpAuth` usa un solo `resourceMetadataPath` (`[transport]/route.ts:62-66`);
  - `proxy.ts:80` solo excluye `api/mcp`;
  - el health prueba solo `MCP_PATH` (`health.ts:150`);
  - `tests/lib/odoo-writer.test.ts:754` lee `maxDuration` de `src/app/api/[transport]/route.ts`, y las escrituras de Odoo se van a otra ruta.
- *Principio:* abierto/cerrado.
- *Consecuencia:* el segundo conector no se puede «agregar»; hay que tocar seis lugares que asumen uno.

### Medio

**M1. Los errores de dominio se traducen tres veces.**
- *Dónde:*
  - `SupplierError`, `PayrollError` y `TimeEntryError` son clases hermanas sin base común;
  - `asTool` está copiado en `tools/hours.ts:364-371` y `tools/payroll.ts:28-35`, y hay un `try/catch` equivalente en `tools/suppliers.ts:156-159`;
  - `run()` solo conoce `ToolError | GitHubError | OdooError` (`server.ts:55`);
  - el log genérico no dice qué tool falló (`server.ts:58`).
- *Principio:* DRY y abierto/cerrado.
- *Consecuencia:* un store nuevo sin su traductor convierte cada regla rota en «Error interno al ejecutar la herramienta».

**M2. Los handlers tienen firmas distintas y la inyección de dependencias es implícita.**
- *Dónde:*
  - hay seis firmas: `(db)`, `(db, input)`, `(db, ctx.userId, input)`, `(callOdoo, input)`, `(deps, ctx, input)` y `() => listTasks(input)`;
  - los singletons se importan en el registro (`server.ts:8, 21, 71`) y GitHub por import directo (`tools/tasks.ts`, `tools/summary.ts`);
  - `getMonthClosing(db, input, deps = liveIncome)` (`tools/finance.ts:48`) esconde la dependencia en un default;
  - `todayInMexico()` se llama dentro de las tools, así que los tests calculan su propio «hoy».
- *Principio:* inversión de dependencias y testabilidad.
- *Consecuencia:* no se puede escribir un harness único que llame cualquier tool con dependencias falsas.

**M3. Hay dependencias invertidas y acoplamiento entre hermanos.**
- *Dónde:*
  - `src/lib/odoo/quotation-plan.ts:6` (dominio) importa `fold` de `src/lib/mcp/shared` (transporte);
  - `mcp/shared.ts:8, 61-68` (núcleo del MCP) importa `lib/odoo/write-guard` y aloja `requireLiveAdmin`, específico de Odoo;
  - `tools/odoo/draft-invoice.ts:21` y `products-write.ts:16` importan helpers genéricos (`parseInput`, `errorName`, `noteOf`, `OdooQuotationDeps`) de `tools/odoo/quotations.ts`;
  - `tools/payables.ts` importa `resolveSupplier` de `tools/suppliers.ts`;
  - `health.ts:9-11` importa tools del MCP.
- *Principio:* las dependencias apuntan hacia el dominio, nunca del dominio al transporte.
- *Consecuencia:*
  - mover las tools de Odoo a su conector arrastra `shared.ts`;
  - el health depende del formato de respuesta de una tool.

**M4. Hay archivos con varias responsabilidades.**
- *Dónde:*
  - `tools/odoo/quotations.ts` (806 líneas): esquema, tipos de la vista, presentadores (`saleView`, `quoteView`), gemelo reciente, preview de crear y editar, save de crear, editar y confirmar, y relectura;
  - `tools/hours.ts` (429): seis tools.
- *Principio:* responsabilidad única.
- *Consecuencia:* revisar un cambio en el guardado obliga a leer la vista previa.

**M5. Las anotaciones son incompletas y no las exige ningún tipo.**
- *Dónde:*
  - solo existen `readOnlyHint` y `openWorldHint` (`server.ts:64` y cada escritura);
  - nunca aparecen `destructiveHint` ni `idempotentHint`.
- *Principio:* contratos explícitos (R8).
- *Consecuencia:* por la spec (default `destructiveHint: true`), las 15 escrituras se anuncian destructivas, aunque varias solo agregan. El detalle por tool es de la rúbrica; aquí el problema es estructural: nada obliga a declararlas.

**M6. Las respuestas no tienen envoltura común ni `structuredContent`.**
- *Dónde:*
  - `run()` solo emite el texto JSON (`server.ts:53`);
  - las listas en inglés usan `{ quotations, count, page, pageSize, totalPages }` (`tools/quotations.ts:57`);
  - las listas en español usan `{ total, mostrados, nota, proveedores }` (`tools/suppliers.ts:60-65`) y `{ total_coincidencias, mostradas, … }` (`tools/payables.ts:120-127`);
  - los `cambios` antes/ahora solo existen en `update_payable` (`tools/payables.ts:205-211`);
  - no hay ningún `outputSchema`: las vistas importan tipos TS de las tools (`src/mcp-views/odoo-quotation/state.ts:4`, `time-report/main.ts:8`).
- *Principio:* consistencia y contrato explícito (R6).
- *Consecuencia:* cada escritura nueva inventa su forma de respuesta.

**M7. Una escritura reporta error después de haber escrito.**
- *Dónde:* `tools/inventory.ts:79-101`. `setInventoryLocation` actualiza **todas** las filas que empatan sin distinguir mayúsculas y, si son más de una, lanza `ToolError`.
- *Principio:* validar antes de mutar.
- *Consecuencia:* el modelo ve `isError` sobre un cambio que sí ocurrió y puede reintentar. Es el antipatrón a prohibir en las 20 escrituras.

**M8. Las instrucciones y el presupuesto son por bloque, no por conector.**
- *Dónde:*
  - `serverInstructions` mezcla los bloques A y B con las reglas de ambos (`server.ts:78-136`);
  - `TOOL_BUDGET` separa `tools: { app, odoo }` pero deja globales `descriptionsTotal`, `listTotal` e `instructions` (`manifest.ts:106-118`);
  - hay referencias cruzadas: la descripción de `odoo_stock_check` manda a `search_inventory` (`server.ts:935`) y las instrucciones citan `odoo_employee_directory` (`server.ts:118`).
- *Principio:* cohesión.
- *Consecuencia:* con dos conectores, esas referencias pueden apuntar a tools que el chat no tiene prendidas.

**M9. El consentimiento no conoce el conector, y el token no está ligado al recurso.**
- *Dónde:*
  - `consent.ts:17-24` arma el resumen por bloque;
  - `oauth.ts:122-124`: sin audiencia (RFC 8707), un token emitido al conectar cualquiera de los dos **abre ambos endpoints**.
- *Principio:* mínimo privilegio y promesa honesta en el consentimiento.
- *Consecuencia:* la pantalla de consentimiento debe describir lo que el token realmente abre. Es decisión de producto (ver preguntas abiertas).

### Bajo

**B1. Utilidades duplicadas.**
- `sanitizeSearch`: 7 copias (las rutas `inventory`, `payables`, `products`, `quotations`, `suppliers` y `urrea-catalog`, más `mcp/shared.ts:29`).
- `isUuid`: 3 copias (`api-helpers.ts:50-52`, `mcp/shared.ts:33-35`, `payroll.ts:189`).
- `ISO_MONTH`: 2 copias (`api/payables/route.ts:16`, `month.ts:6`).
- `isoDate` como zod solo existe en `tools/odoo/quotations.ts:101`.

**B2. Las vistas no están ligadas a su tool ni a su conector.**
- `views/generated.ts` (682 KB) trae las dos vistas en un módulo que importa `server.ts:30`: cada conector cargaría la vista del otro.
- La URI y el `registerAppResource` se declaran aparte de la tool.
- Nada verifica que el `callServerTool` de una vista (`time-report/main.ts:98` → `save_time_entries`; `odoo-quotation/main.ts:144` → `odoo_save_product`) apunte a una tool del **mismo** conector.

**B3. `COVERAGE` usa texto libre** (`tests/mcp/coverage.test.ts:26-63`). Solo valida las llaves (las rutas): renombrar o fusionar una tool deja la cobertura apuntando a un nombre muerto sin que el test falle.

**B4. La página de documentación es de cliente.**
- `src/app/dashboard/docs/page.tsx:1` es `'use client'` y, vía `AssistantSection`, importa `manifest.ts`.
- Si el catálogo se derivara de definiciones que llevan handlers, arrastraría código de servidor al bundle del navegador (`node:crypto` en `preview-token.ts`, entre otros).
- No es un bug hoy, pero condiciona el diseño.

**B5. Nombres que confunden.**
- `withMcpAuth({ resourceUrl: appUrl() })` (`[transport]/route.ts:65`) recibe en realidad el **origen**: mcp-handler le concatena `resourceMetadataPath`.
- `McpRole` vive en `manifest.ts` y lo importa la capa de auth (`oauth.ts:12`, `context.ts:6`).
- Se dice `block: 'app' | 'odoo'` donde ya se habla de conectores.
- Los parámetros de tareas (`task_number`, `comment`, `state`) están en inglés y el resto en español.

## 3. Estructura objetivo

### 3.1 Capas y regla de dependencias

```
transporte    src/app/api/[transport]/route.ts · src/app/api/odoo/[transport]/route.ts · .well-known
     │        (cada ruta = connectorRoute(conector); nada más)
     ▼
core          src/lib/mcp/core/   http · auth · context · register · run · errors · result · schema · confirm · catalog
     │        (no conoce módulos ni Odoo; recibe un ConnectorDefinition)
     ▼
conector      src/lib/mcp/connectors/<id>/   definición del conector + tools por módulo + instrucciones + presupuesto + vistas
     │        (una tool = definición + handler: mapea entrada → llama al store/lector → presenta)
     ▼
dominio       src/lib/<modulo>-store.ts (+ su schema zod) · src/lib/payables.ts, payroll.ts… · src/lib/odoo/* · src/lib/github.ts
     ▼
BD / Odoo / GitHub
```

Reglas de dependencias, verificables con `no-restricted-imports` de eslint:
- `src/lib/**` fuera de `mcp/` **nunca** importa `@/lib/mcp/**`; eso corrige `quotation-plan.ts:6` y `health.ts:9-11`.
- `core/` nunca importa `connectors/`.
- Un conector nunca importa del otro.
- Las tools nunca importan los singletons `callOdoo`, `odooWriter` ni `fetchGitHub`: los reciben en `ctx`.

### 3.2 Árbol propuesto

```
src/lib/mcp/
├── core/
│   ├── define.ts          defineTool · defineView · defineConnector · tipos (ToolDefinition, ToolContext…)
│   ├── register.ts        registerConnector(server, conector, { role, deps }): ÚNICO sitio que llama
│   │                      registerTool / registerAppTool / registerAppResource (y el único cast)
│   ├── run.ts             executeTool(def, input, extra): ctx → handler → envoltura; log con nombre y duración
│   ├── errors.ts          ToolError(message, { example }) · toToolResult(e, toolName): mapeo único de errores
│   ├── result.ts          withResultMeta / splitResultMeta (sin cambios) · listResult · writeResult · diff
│   ├── schema.ts          primitivas zod: isoDate, isoMonth, ref, limit, page, confirmar · aliasShape · locale es
│   ├── context.ts         contextFrom(authInfo, deps) → ToolContext (user, db, clock, deadline, deps del conector)
│   ├── confirm/
│   │   └── preview-key.ts firma/verifica HMAC genérica con secreto propio (MCP_PREVIEW_SECRET); base de 'preview'
│   ├── auth/
│   │   ├── oauth.ts       verifyToken(conector) — hoy oauth.ts; McpRole/McpIdentity viven aquí
│   │   ├── supabase.ts    clientForToken · verifierClient
│   │   └── live-admin.ts  requireLiveAdmin → AdminProof (sale de shared.ts; AdminProof sale de lib/odoo)
│   ├── http.ts            connectorRoute(conector) → handler con withMcpAuth · protectedResource(conector)
│   ├── env.ts             appUrl · allowedClientIds (hoy env.ts)
│   └── catalog.ts         derivados puros: catalogOf(conector, rol), consentSummary, budgetReport
├── connectors/
│   ├── index.ts           CONNECTORS = [dymmsa, odoo] · connectorForPath(path)
│   ├── dymmsa/
│   │   ├── connector.ts   defineConnector({ id: 'dymmsa', path: '/api/mcp', serverInfo, tools, instructions, budget, deps })
│   │   ├── define.ts      defineDymmsaTool = toolFactory<DymmsaDeps>('dymmsa')
│   │   ├── instructions.ts  mapa del bloque A + reglas de la app (hoy parte de server.ts:78-136)
│   │   ├── budget.ts
│   │   └── modules/
│   │       ├── payables/          list-payables.ts · get-payable.ts · save-payable.ts · present.ts · resolve.ts
│   │       ├── suppliers/  hours/  payroll/  quotations/  orders/  inventory/  products/  urrea/
│   │       └── materials/  settings/  finance/  profiles/  tasks/  summary/
│   └── odoo/
│       ├── connector.ts   defineConnector({ id: 'odoo', path: '/api/odoo/mcp', … })
│       ├── define.ts      defineOdooTool: nombre tipado `odoo_${string}`
│       ├── instructions.ts  bloque B + reglas de Odoo (notas de crédito, vínculo factura↔venta)
│       ├── budget.ts
│       └── modules/
│           ├── queries/  accounting/  sales/  documents/  payments/  operations/
│           └── quotations/        schema.ts · present.ts · preview.ts · save.ts · reread.ts · notes.ts
│                                  (parte los 806 de tools/odoo/quotations.ts)
└── views/
    └── generated/<vista>.ts       un módulo por vista: cada conector carga solo la suya

src/app/api/[transport]/route.ts                 export … = connectorRoute(dymmsa); maxDuration literal
src/app/api/odoo/[transport]/route.ts            export … = connectorRoute(odoo)
src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts   resuelve el conector por path

src/lib/errors.ts               DomainError(kind) — base de SupplierError, PayrollError, TimeEntryError
src/lib/text.ts                 fold · sanitizeSearch · isUuid (salen de mcp/shared y de 7 rutas)
src/lib/<modulo>-store.ts       se conserva el patrón plano actual; cada store exporta su schema zod de dominio
```

Notas:
- **Un archivo por tool** dentro de su módulo. `present.ts` (el `digest()` de hoy) y `resolve.ts` (la búsqueda por nombre) son del módulo. Si otro módulo los necesita, como `resolveSupplier` desde facturas, se importan del módulo, nunca de la tool de otro.
- El **bloque Odoo de lectura del cierre del mes** (`get_month_closing`) se queda en DYMMSA-WEB: es la pantalla de Finanzas de la app y lee Odoo con la llave del servidor, no con el conector.
- Se conserva `src/lib/<modulo>-store.ts` plano: renombrar todo a carpetas no aporta y agranda los diffs.

### 3.3 La definición de tool

Una sola declaración por tool; todo lo demás se deriva.

```ts
// src/lib/mcp/core/define.ts (forma propuesta)
type Kind = 'read' | 'write'
type Confirm = 'none' | 'summary' | 'preview'      // R10: bajo = directo, medio = resumen + confirmar, alto = clave

interface WriteHints { destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
interface ReadHints { idempotentHint?: boolean; openWorldHint: boolean }

type ToolDefinition<C extends ConnectorId, I extends z.ZodRawShape, O extends z.ZodRawShape | undefined> = {
  connector: C
  name: C extends 'odoo' ? `odoo_${string}` : string   // snake_case ≤ 64; el test lo valida
  module: string                                       // grupo en docs y consentimiento
  title: string
  description: string                                  // tope por tool del presupuesto del conector
  input: I                                             // el core registra z.strictObject(input)
  output?: O                                           // → outputSchema + structuredContent (ver 3.5)
  audience?: 'all' | 'admin'                           // hoy adminOnly; default 'all'
  visibility?: readonly ('model' | 'app')[]            // ['app'] = solo la vista (odoo_save_product)
  view?: ViewDefinition                                // defineView({ uri, name, html }) → recurso registrado solo
  docs: { example: string; evals?: readonly string[] } // evals = tareas reales de R12
  handler: (input: z.infer<z.ZodObject<I>>, ctx: ToolContext<C>) => Promise<HandlerResult<O>>
} & (
  | { kind: 'read'; hints: ReadHints; confirm?: never; limits?: never }
  | { kind: 'write'; hints: WriteHints; confirm: Confirm; limits: string }   // limits obligatorio
)
```

- **`readOnlyHint` no se escribe: se deriva de `kind`.** Desaparece la comparación manifiesto↔registro (`manifest.test.ts:84-86`) porque ya no pueden discrepar.
- **`audience` sustituye a `adminOnly` y a las 8 guardas.** `registerConnector` filtra por rol; las instrucciones por rol se arman con los nombres que sí se registraron.
- **`ToolContext<C>`** = `{ user: { id, email, role, clientId }, db, clock: { today(), now() }, deadline, requireLiveAdmin(), deps }`:
  - en DYMMSA-WEB, `deps` = `{ github, income }`;
  - en Odoo, `deps` = `{ reader, writer }`.

  Una sola firma de handler: `(input, ctx)`.
- **La objeción de ADR-034** a «un wrapper que filtre por nombre» era el cast de la firma sobrecargada de `registerTool`. Con `register.ts` el cast queda en **una** función genérica probada, no repartido en 55 registros.

Lo que se deriva de las definiciones:

| Derivado | Dónde | Reemplaza |
|---|---|---|
| `tools/list` y recursos de vista | `core/register.ts` | `registerDymmsaTools` y las 8 guardas |
| Catálogo de docs y consentimiento | `core/catalog.ts` → `catalogOf(conector, rol)` | `TOOL_MANIFEST`, `DOCS_MANIFEST`, `ADMIN_ONLY_TOOLS` |
| Presupuesto por conector | `connectors/<id>/budget.ts` + test genérico | `TOOL_BUDGET` global |
| Tests de contrato | un `describe.each` sobre todas las definiciones | regex y listas fijas |
| Unión de nombres `ToolName` | tipo derivado | valores libres de `COVERAGE` (B3) |

Los tests de contrato derivados, que corren por cada definición:
- nombre en snake_case ≤ 64 y prefijo `odoo_` en ese conector;
- descripción > 40 caracteres y dentro de su tope;
- una escritura trae `limits` y `confirm`;
- `confirm: 'preview'` tiene su gemela de lectura en el mismo conector;
- una vista apunta a un recurso registrado, y su `callServerTool` existe en el mismo conector;
- el JSON Schema de entrada lleva `additionalProperties: false`;
- todo nombre de tool citado en una descripción o en las instrucciones existe en el mismo conector, o va marcado como cruce explícito.

**La documentación** (B4): el catálogo es puro, pero las definiciones llevan handlers. Se propone que `src/app/dashboard/docs/page.tsx` pase a ser un Server Component delgado que renderiza la página de cliente actual con `catalog` como prop. Además, `import 'server-only'` en `core/register.ts` y en los handlers, para que una regresión rompa el build en vez de inflar el bundle. La alternativa es separar cada tool en `x.def.ts` (sin handler) y `x.handler.ts`, unidos en `connector.ts` con un `satisfies Record<ToolName, Handler>`; es más archivos por tool y solo vale si la documentación debe quedarse 100 % de cliente.

### 3.4 Validación compartida entre ruta y tool

La regla es una: **el store valida; la ruta y la tool solo mapean y traducen errores.**

```ts
// src/lib/payables-store.ts (dominio; campos = columnas, mensajes en español)
export const payableFields = {
  concept: z.string().trim().min(1, 'El concepto es obligatorio').max(200),
  amount: z.number().positive('El monto debe ser mayor a 0'),
  currency: z.enum(PAYABLE_CURRENCIES).default(DEFAULT_PAYABLE_CURRENCY),
  invoice_date: isoDate,
  due_date: isoDate,
  notes: z.string().trim().max(500).nullable().optional(),
}
export const payableCreateSchema = z.strictObject({ supplier_id: z.uuid(), ...payableFields })
export async function createPayable(db: Db, raw: unknown): Promise<PayableWithSupplier>
//   parsea con payableCreateSchema y lanza DomainError('invalid' | 'not_found' | 'failed')

// Ruta: POST /api/payables
//   try { return created(await createPayable(supabase, await request.json())) } catch (e) { return apiError(e) }

// Tool: save_payable (conector dymmsa)
const { shape, toDomain } = aliasShape(payableFields, {
  concept: 'concepto', amount: 'monto', currency: 'moneda',
  invoice_date: 'fecha_factura', due_date: 'vencimiento', notes: 'notas',
})
//   input: { factura: ref.optional(), proveedor: ref.optional(), ...shape }
//   handler: resuelve nombres → createPayable / updatePayable(ctx.db, toDomain(input)) → writeResult(…)
```

- **`aliasShape`** reutiliza el *mismo* schema de cada campo con la llave en español. Las restricciones (enum, rango, formato) llegan al JSON Schema que ve el modelo sin copiarse. La tool solo agrega `.describe()` y los campos propios del chat (`proveedor` por nombre, `factura` como referencia).
- **Los enums salen de constantes del dominio** (`PAYABLE_CURRENCIES`, `QUOTATION_STATUSES`…), nunca de un string en la descripción. Eso cierra A3 y el filtro ignorado en silencio de `quotations.ts:32`.
- **Las primitivas comunes** viven en `core/schema.ts` (`isoDate` con `isRealDate`, `isoMonth`, `limit(max, default)`, `page`, `ref`), y las de dominio que también usan las rutas en `src/lib/` (`isoDate` para fechas de BD).
- **`DomainError`** (`src/lib/errors.ts`) con `kind: invalid | not_found | forbidden | conflict | failed`:
  - `SupplierError`, `PayrollError` y `TimeEntryError` pasan a extenderlo sin cambiar su uso;
  - `apiError(e)` en `api-helpers.ts` lo convierte en 400/404/403/409/500;
  - `core/errors.ts` lo convierte en `isError`;
  - los `asTool` desaparecen.
- **Lo que el store no cubre** se queda en la tool: resolución por nombre (`requireSingleMatch`), defaults del chat (vencimiento = fecha + plazo del proveedor, como prellena la app) y presentación.
- **El orden en el store** valida todo antes de la primera escritura (M7). Si hay varias escrituras sin transacción, el store documenta y prueba qué pasa si falla la segunda (el patrón de `createSupplier` con rollback).

### 3.5 Envoltura estándar de respuestas y errores

| Caso | Forma (llaves en español) | Helper |
|---|---|---|
| Colección | `{ total, mostrados, truncado, pagina?, paginas?, nota?, <plural>: [...] }` | `listResult()` |
| Detalle | `{ ...entidad, nota? }` (nombres, no UUID; valores resueltos) | `present()` del módulo |
| Escritura | `{ accion: 'creado' \| 'actualizado' \| 'quitado' \| 'sin_cambios' \| 'ya_existia', <entidad>: {...}, cambios?: { campo: { antes, ahora } }, avisos?: [], siguiente_paso? }` | `writeResult()` + `diff()` (generaliza `tools/payables.ts:205-211`) |
| Vista previa | `{ ..., puede_guardar, bloqueos, avisos, clave, vence, siguiente_paso }` | `confirm/preview-key.ts` |
| Error | `isError: true`, texto «Qué falló. Qué corregir. Ej.: {entrada válida}» | `ToolError(msg, { example })`, `toToolResult()` |

- **Errores.** `toToolResult(e, toolName)` es el único mapeo:
  - `ToolError`, `DomainError` (cualquier kind), `GitHubError` y `OdooError` → su mensaje;
  - cualquier otra cosa → «Error interno en `<tool>`» + log con nombre, duración y el error.
- **Entrada.**
  - El registro usa `z.strictObject` (A4) y fija el locale de zod en español (`z.config(z.locales.es())`, zod 4.3.6 lo trae).
  - El prefijo «Input validation error» lo pone el SDK y seguirá en inglés (ver preguntas).
  - `parseInput` (hoy `tools/odoo/quotations.ts:213-221`) pasa al core para las llamadas directas.
- **`structuredContent` y `outputSchema`.**
  - El `outputSchema` cuesta presupuesto de `tools/list` (R11).
  - Se propone declarar `output` **solo** donde un consumidor lo lee: las vistas (`preview_time_report`, `odoo_preview_quotation`) y, después, las vistas previas de escrituras de riesgo alto.
  - Con `output`, el core emite `structuredContent` y el mismo JSON en texto (compatibilidad); sin `output`, solo texto, como hoy.
  - El SDK valida `structuredContent` contra el `outputSchema` (`mcp.js:186-207`), así que el contrato de la vista queda probado en cada llamada. La vista deja de importar tipos de la tool y toma `z.infer` del `output`.
- **`_meta` para vistas.** `withResultMeta` se queda tal cual, movido a `core/result.ts`.
- **Las envolturas de tools que ya existen** (las listas en inglés) **no** se cambian en los PRs mecánicos: se migran cuando su tool se fusiona o renombra (Matriz), para romper las rutinas una sola vez.

### 3.6 Cómo se monta la segunda ruta

```ts
// src/lib/mcp/core/http.ts
export function connectorRoute(connector: ConnectorDefinition) {
  const build = (role: McpRole) => createMcpHandler(
    (server) => registerConnector(server, connector, { role, deps: connector.deps() }),
    { serverInfo: connector.serverInfo, instructions: connector.instructions(role) },
    { basePath: connector.basePath, disableSse: true, maxDuration: 60 },   // '/api' | '/api/odoo' → …/mcp
  )
  const handlers = { admin: build('admin'), member: build('member') }
  return withMcpAuth((req) => handlers[roleFrom(req.auth)](req), verifyTokenFor(connector), {
    required: true,
    resourceMetadataPath: connector.metadataPath, // dymmsa: '/.well-known/oauth-protected-resource' (se conserva)
                                                  // odoo:   '/.well-known/oauth-protected-resource/api/odoo/mcp'
    resourceUrl: appUrl(),                        // es el ORIGEN: mcp-handler le concatena el path (B5)
  })
}

// src/app/api/odoo/[transport]/route.ts
export const runtime = 'nodejs'
export const maxDuration = 60          // literal: Next lo lee estático
const handler = connectorRoute(odoo)
export { handler as GET, handler as POST, handler as DELETE }
```

Lo que hay que tocar para montarla:

- **Metadatos RFC 9728.**
  - El catch-all resuelve el conector por `params.path`:
    - `[]` y `['api','mcp']` → DYMMSA-WEB (se conserva la raíz por compatibilidad);
    - `['api','odoo','mcp']` → Odoo;
    - cualquier otro → 404.
  - Responde `resource = origen + connector.path`. El test verifica que cada conector anuncia su propia URL.
- **`withMcpAuth` por conector**, con su `resourceMetadataPath`: el 401 de cada endpoint lleva al cliente a sus propios metadatos.
- **`verifyTokenFor(conector)`.**
  - Hoy es el mismo `verifyToken`: una sola allowlist y la misma caché.
  - Queda listo para ligar `client_id` → conector si se decide (M9).
  - El rol se sigue resolviendo una vez por token.
- **`src/proxy.ts:80`**: agregar `api/odoo/mcp` al matcher excluido. Sin eso, el proxy no rompe la llamada, pero corre un `getUser()` de cookies en cada petición del MCP.
- **Health**:
  - `protected_resource` y `mcp_unauthenticated` por conector;
  - las tools de lectura del health pasan a usar stores, no tools (M3).
- **Consentimiento.** `consentSummary(role)` → `consentSummary(conectores, role)`. Mientras el token no esté ligado al conector, la pantalla describe **lo que abren los dos** (M9).
- **`serverInfo`**: `{ name: 'dymmsa', title: 'DYMMSA-WEB' }` y `{ name: 'dymmsa-odoo', title: 'Odoo DYMMSA' }`.
- **Presupuesto de tiempo.** `REQUEST_BUDGET_MS + PRE_TOOL_HEADROOM_MS ≤ maxDuration` se prueba contra la ruta de **Odoo** (las escrituras se mudan ahí). `odoo-writer.test.ts:754` lee las dos rutas.
- **`coverage.test.ts`**: entrada `'odoo/[transport]': 'fuera: endpoint MCP de Odoo'`.
- **Vistas**: `views/generated/<vista>.ts`. DYMMSA-WEB importa `time-report` y Odoo importa `odoo-quotation`.
- **Transición.**
  - Durante un release, DYMMSA-WEB sigue registrando también las `odoo_*` (composición en `connector.ts`), así que nada se rompe hasta que el admin agregue el conector «Odoo DYMMSA» en Claude web, escritorio y Code.
  - Luego un PR las quita.
  - Alternativa: `static` en `src/app/api/odoo/mcp/route.ts`. Con SSE apagado no hace falta el segmento dinámico, pero `[transport]` mantiene la simetría con la ruta actual.

## 4. Plan de refactor por PRs

Cada PR pasa `bun run check` y el **snapshot de `tools/list`** del PR 1, salvo que diga por qué cambia.

| # | PR | Toca | Cómo se prueba | Riesgo |
|---|---|---|---|---|
| 1 | **Red de seguridad** (sin cambio de producción) | `tests/mcp/harness.ts` (SDK real en memoria: `connect(conector, rol, deps)`, `callTool`), `tests/mcp/snapshot.test.ts` + golden de `tools/list` e instrucciones por rol | Pasa en `main` tal cual | Nulo |
| 2 | **Extraer `core/`** sin cambio de comportamiento | `run`/`ToolResult`/`readOnly`/`pagination` (`server.ts:41-76`) → `core/run.ts`, `core/schema.ts`; `shared.ts` → `core/errors.ts`, `core/result.ts`, `core/auth/live-admin.ts`; `oauth/supabase/context/env/routes` → `core/`; `fold/sanitizeSearch/isUuid` → `src/lib/text.ts` (corrige `quotation-plan.ts:6`); `McpRole` a `core/auth`. `shared.ts` queda como re-export temporal | Snapshot idéntico; tests de tools sin cambios salvo imports | Bajo |
| 3 | **`defineTool` + registro derivado + catálogo** (mecánico) | `core/define.ts`, `core/register.ts`, `core/catalog.ts`; las 55 tools se mudan a `connectors/{dymmsa,odoo}/modules/*` con **exactamente** su texto, shape y anotaciones de hoy; `registerDymmsaTools` = componer los dos conectores en el mismo endpoint; vistas con `defineView`; manifiesto, consentimiento y docs derivados (docs vía Server Component); `manifest.test.ts` sin regex; `COVERAGE` tipado con `ToolName` | Snapshot idéntico, **orden incluido**; tests de contrato por definición | Medio-bajo: diff grande pero mecánico. Se parte en 3a (Odoo, 19 tools) y 3b (DYMMSA-WEB, 36) |
| 4 | **Segundo conector en paralelo** | `core/http.ts`, `src/app/api/odoo/[transport]/route.ts`, metadatos por path, `proxy.ts`, health por conector, `serverInfo`, instrucciones partidas, presupuesto por conector, consentimiento de los dos, `coverage`, `odoo-writer.test`, vistas por archivo. DYMMSA-WEB **sigue** sirviendo las `odoo_*` | Snapshot de DYMMSA-WEB idéntico + snapshot nuevo de Odoo; test de metadatos por path; manual: `claude mcp add --transport http odoo-dymmsa https://…/api/odoo/mcp`, 401 con `resource_metadata` correcto, OAuth completo y una lectura; conector nuevo en Claude web con el mismo Client ID | Medio (OAuth y descubrimiento). Rollback: borrar la ruta |
| 5 | **Quitar el bloque Odoo de DYMMSA-WEB** (tras agregar el conector en los clientes) | `connectors/dymmsa/connector.ts` sin `odoo_*`; instrucciones sin bloque B; presupuestos re-medidos (hoy: DYMMSA 36 tools / 28,674; Odoo 19 / 18,019); docs con dos secciones; ADR-041; filas MCP y Odoo de CLAUDE.md | Snapshot cambia a propósito; test de referencias cruzadas en descripciones e instrucciones | Medio (rutinas y hábitos: avisar antes) |
| 6 | **Contrato de entrada y errores** | `z.strictObject` en el registro, locale es, primitivas en las 8 enums y 19 fechas, `DomainError` base + `apiError()` en rutas + mapeo en `run`; se borran los `asTool`; log con nombre de tool | Snapshot cambia (enums, `additionalProperties`) → re-medir presupuesto; tests nuevos: campo desconocido → `isError` en español con ejemplo | Medio: entradas que hoy pasan ahora fallan. Mitigación opcional: una semana registrando llaves desconocidas antes de rechazarlas |
| 7 | **Anotaciones completas** | El tipo exige `destructiveHint`, `idempotentHint` y `openWorldHint` en escrituras; `readOnlyHint` derivado de `kind`; valores por tool según la auditoría de diseño | Snapshot de anotaciones; probar en claude.ai qué tools piden aprobación | Bajo |
| 8 | **Envolturas + `output` donde lo consume una vista** | `core/result.ts` (`listResult`, `writeResult`, `diff`); `output` en `preview_time_report` y `odoo_preview_quotation`; las vistas leen `structuredContent` y toman el tipo del `output` | `views.test.ts` con el SDK real (el SDK valida la salida); presupuesto | Bajo-medio |
| 9 | **Confirmación genérica** (prerrequisito de riesgo medio y alto) | `core/confirm/preview-key.ts` con `MCP_PREVIEW_SECRET` (Matriz, hallazgo 3); `confirm: 'summary'` (el core agrega `confirmar` y devuelve el resumen si falta) y `'preview'`; `preview-token.ts` de Odoo se monta encima con sus mismas claims; `AdminProof` a `src/lib/auth/` | Los tests de `preview-token` (firma, caducidad, otro admin) pasan sobre la base nueva | Medio (seguridad) |
| 10 | **Partir `tools/odoo/quotations.ts`** | `modules/quotations/{schema,present,preview,save,reread,notes}.ts`; `parseInput`/`errorName` al core | `odoo-quotations.test.ts` (1,001 líneas) y snapshot idénticos | Bajo |
| 11 | **Red de cobertura de escritura** (Matriz, hallazgo 8) | `tests/mcp/write-coverage.test.ts`: cada handler `POST/PATCH/PUT/DELETE` → `ToolName` o `fuera: <motivo>`, con lecturas por POST y refrescos de caché clasificados aparte | Falla si aparece una ruta de escritura sin decisión | Nulo |
| 12+ | **Por entidad, en pares** | **a) Store:** extraer la regla de la ruta a `src/lib/<modulo>-store.ts` (schema zod + `DomainError`); la ruta lo usa; se corrige en el mismo PR el orden de escrituras con bug (p. ej. `cancel`). **b) Tool:** definición + handler + test con el harness + `docs.evals` | a) tests de ruta intactos + unit del store; b) harness + presupuesto | Según la ficha |

Orden sugerido para los pares 12+, de menor a mayor riesgo y siguiendo la Matriz:
1. Finanzas (`save_payable` fusiona tres tools).
2. Ajustes.
3. Tareas (`save_task`).
4. Proveedores y marcas.
5. Materiales.
6. Horas (borrar checada).
7. Equipo y perfil.
8. Productos ETM.
9. Catálogo URREA.
10. Nómina (periodo).
11. Cotizaciones.
12. Al final, Inventario y Órdenes, **después** del RPC atómico de stock (Matriz, hallazgo 1).

Riesgos del plan:
- **El snapshot se vuelve ruido** si se regenera sin leerlo. El script de regeneración (`bun run mcp:snapshot`) imprime el diff de tamaños por tool, y el PR explica cada cambio.
- **Los clientes cachean la lista** y las rutinas usan nombres. Por eso existe la transición del PR 4–5 y los renombres van juntos con las fusiones.
- **El token no está ligado al recurso** (M9): el segundo conector no agrega seguridad por sí solo. Es separación de contexto, no de permisos.
- **PR 3 es grande.** Partirlo en 3a/3b y prohibir cambios de texto dentro de él: si un texto cambia, el snapshot lo delata.

## 5. Reglas de código para las tools nuevas

Checklist para pegar en la fila del MCP de CLAUDE.md:

1. **Una tool = un archivo** en `connectors/<conector>/modules/<modulo>/` con `defineTool`. Nada se registra a mano, ni se agrega al manifiesto, ni a las listas de un test.
2. **La regla vive en el store** (`src/lib/<modulo>-store.ts`), compartido con la ruta. La tool solo:
   - mapea la entrada (español → dominio con `aliasShape`);
   - resuelve nombres con `requireSingleMatch`;
   - llama al store;
   - presenta el resultado.

   Prohibido `db.from(...).insert/update/delete` dentro de una tool.
3. **Entrada estricta y tipada.**
   - Usa las primitivas de `core/schema` (`isoDate`, `isoMonth`, `limit`, `ref`).
   - Los enums salen de constantes del dominio.
   - Nunca `z.string()` para un enum, una fecha o un id.
   - Cada campo con `.describe()`; requerido solo lo indispensable.
4. **Anotaciones completas** (el tipo las exige).
   - `destructiveHint: false` solo si la tool únicamente agrega.
   - `idempotentHint: true` solo si repetir la misma llamada no cambia nada.
5. **Confirmación según el riesgo de la ficha:** `confirm: 'none' | 'summary' | 'preview'`.
   - `'summary'` exige `confirmar: true`.
   - `'preview'` exige la clave HMAC del core, emitida por su gemela de solo lectura.
6. **Errores.**
   - El store lanza `DomainError(kind)`; la tool, `ToolError` con qué corregir y un ejemplo de entrada válida.
   - Ningún `try/catch` para traducir errores: lo hace el core.
   - **Se valida todo antes de la primera escritura**: nunca un `isError` sobre algo que sí se escribió.
7. **Respuesta.**
   - Usa `listResult` / `writeResult`.
   - Nombres en vez de UUID, valores ya resueltos y `cambios` antes/ahora en las ediciones.
   - Si hay `output`, declarar su schema y medir el presupuesto.
   - Nunca mencionar la bitácora (ADR-028).
8. **Dependencias por `ctx`** (`db`, `user`, `clock`, `deadline`, `deps`). Nada de importar `callOdoo`, `odooWriter`, `fetchGitHub` ni `todayInMexico()` dentro del handler.
9. **Tests.**
   - Unit del store (lo comparten la ruta y la tool).
   - Test de la tool por el harness con el SDK real: entrada válida, campo desconocido, regla rota y búsqueda ambigua.
   - 1–2 frases reales en `docs.evals` (R12).
10. **Presupuesto.** El test del conector debe pasar. Subir un tope es un cambio explícito con su porqué en el PR.
11. **Sin referencias cruzadas** a tools del otro conector en descripciones ni instrucciones, salvo que se marquen como cruce explícito.
12. **Documentación en el mismo PR:**
    - `docs.example` y `limits`;
    - la ficha de la bóveda;
    - la fila del MCP en CLAUDE.md;
    - `CHANGELOG.md` si el usuario lo nota.

## 6. Preguntas abiertas

1. **Clientes OAuth y consentimiento.**
   - ¿Un solo Client ID para los dos conectores, o uno por conector dentro de la misma allowlist?
   - Con uno solo, el consentimiento no sabe qué conector pide acceso, y el token abre los dos endpoints (`oauth.ts:122-124`). La pantalla tendría que describir ambos.
   - Con dos, `verifyTokenFor(conector)` puede rechazar el token del otro. Eso requiere mapear `client_id` → conector (¿`MCP_OAUTH_CLIENT_IDS=dymmsa:<id>,odoo:<id>`?).
2. **Un member en el conector de Odoo.** Hoy solo se conecta el admin. ¿El conector Odoo rechaza a un member en `verifyToken`, o le sirve la lista de lectura como hoy?
3. **Documentación.** ¿Server Component delgado que pasa el catálogo por props (recomendado), o separar `def`/`handler` por tool para que la página siga 100 % de cliente?
4. **`structuredContent` en claude.ai.** ¿El modelo recibe el texto, el `structuredContent` o los dos? Si son los dos, cada respuesta con `output` paga el doble de tokens. Conviene medirlo antes de pasar de las vistas a más tools.
5. **Transición entre conectores.** ¿Cuánto tiempo sirve DYMMSA-WEB también las `odoo_*`? ¿Quién actualiza las rutinas (la del viernes) y la configuración de Claude Code y escritorio?
6. **Mensajes del SDK.** Con el locale es, el motivo sale en español, pero el prefijo «Input validation error: Invalid arguments for tool …» sigue en inglés. ¿Se acepta, o se valida en `run` con un schema permisivo en el registro (se pierde el `additionalProperties: false` del JSON Schema)?
7. **Entrada estricta.** ¿Se activa de golpe en el PR 6, o primero una semana registrando llaves desconocidas para ver qué manda el modelo hoy?
8. **Idioma de parámetros.** ¿Se pasan a español los de tareas (`task_number`, `comment`, `state`) al fusionar `save_task`, y las listas en inglés de cotizaciones y órdenes al fusionarlas con su `get_`?
9. **Mensajes de `DomainError('failed')`.** Hoy `SupplierError('…', 'failed')` llega tal cual al modelo («Error al crear el proveedor»). ¿Se exponen esos mensajes o se vuelven genéricos con log?
10. **Topes iniciales por conector.** ¿Con qué presupuesto arranca cada uno tras el PR 5? La Matriz lleva DYMMSA-WEB a 45 tools (o ~39 con fusiones de lectura) contra 36 de hoy.
11. **Ubicación de los stores.** ¿Se conserva `src/lib/<modulo>-store.ts` plano (recomendado) o se pasa a `src/lib/<modulo>/{schema,store}.ts`?
