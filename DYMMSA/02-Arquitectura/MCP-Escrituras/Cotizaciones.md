# MCP escrituras — Cotizaciones

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]] · [[02-Arquitectura/MCP-Escrituras/Aprobacion-publica]] · [[02-Arquitectura/MCP-Escrituras/Ordenes]]

## Resumen

Cotizaciones = encabezado (`quotations`) + líneas (`quotation_items`: productos y separadores). Hoy se escriben con 5 rutas (crear, editar replace-all, cambio manual de estado, enviar a aprobación, borrar); la creación arranca en el **navegador** (Excel + merge con el catálogo ETM) y la ruta solo persiste. El MCP solo **lee** (`list_quotations`, `get_quotation`). Riesgo general **medio**: editar es reversible a mano, pero no hay historial (delete+insert), el auto-learn reescribe `etm_products` como efecto colateral y una cotización en revisión la ve el cliente. Toda la orquestación vive inline en las rutas: hay que extraer un `quotations-store.ts` antes de cablear nada.

## Rutas que escriben

### `POST /api/quotations/save` — `src/app/api/quotations/save/route.ts`
- **Auth / rol:** `requireAuth` (cualquier sesión, member o admin). RLS de `quotations` y `quotation_items`: policy `FOR ALL TO authenticated USING (true) WITH CHECK (true)` → cualquier usuario con sesión escribe también directo por PostgREST; en este módulo **no existe `is_admin()`**.
- **Entrada:** body `{ name, customer_name, items: QuotationItemRow[] }` casteado, **sin zod**. Validación inline: `name` y `customer_name` no vacíos tras trim (400) y al menos un producto (`isProductItem`, 400). **No** valida cantidad, ETM, precio ni `delivery_time`: `getBlockingIssues()` (`src/lib/quotation-validation.ts`) solo corre en el cliente (en la nube hay 16 líneas de producto sin cantidad en 4 cotizaciones convertidas). La BD solo tiene `quantity IS NULL OR > 0`, `unit_price IS NULL OR >= 0` y `separator_color` solo en separadores; **no hay CHECK de `item_type` ni de `delivery_time` en `quotation_items`** (verificado en la nube el 2026-10-22; `order_items` sí tiene el de `delivery_time`, así que un valor inválido reventaría hasta `create-order`).
- **Qué hace:**
  1. `calculateQuotationTotal(items)` (excluye separadores, `is_sold=false` y líneas sin precio o cantidad).
  2. INSERT `quotations` (`status='draft'`, `total_amount`, `created_by=user.id`; `approval_token` sale del default de la BD).
  3. `fetchCatalogDescriptionMapOrNull()` con los `model_code`.
  4. Mapea cada ítem: el separador anula los campos de producto; `dymmsa_description = resolveDymmsaDescription(item, catalogMap).value` (snapshot congelado, ADR-013); `delivery_time ?? 'immediate'`; `is_approved = null`; `is_sold ?? null`; `sort_order = index` (sobre todas las filas, separadores incluidos).
  5. INSERT `quotation_items`.
  6. Respuesta `{ quotation_id, total_amount, items_count, auto_learn }`.
- **Reglas y efectos secundarios:**
  - **Rollback:** si falla el insert de ítems → DELETE de la cotización + `explainPgError(itemsError, items)`. Si es violación de una regla responde 400 con `offendingEtm`, si no 500.
  - **Auto-learn** (`processAutoLearn`, aislado en try/catch → `warning: 'auto_learn_failed'`): hace INSERT en `etm_products` de los ETM nuevos (`brand='URREA'` solo con `model_code`) y UPDATE de los campos no vacíos que cambiaron, **incluido `price`**: el precio de esta cotización pasa a ser el precio de catálogo del ETM. También `is_sold` explícito (global) y la descripción curada que deje pasar `learnableDymmsaDescription()`.
- **Dónde vive la lógica:** la orquestación es inline en la ruta; los helpers ya están en lib (`business-rules.ts`, `urrea-catalog.ts`, `auto-learn.ts`, `supabase-errors.ts`). **La mitad de "crear" vive en el cliente** (ver abajo). Hay que extraerla a `createQuotation()` en un store.
- **Quién la usa en la UI:** `useSaveQuotation` → `/dashboard/quoter` (`QuoterPage.handleSave`).

#### Qué parte de "crear cotización" vive en el cliente
1. **Parseo del Excel en el navegador:** `extractProductRowsFromExcel` (`src/lib/excel/parser.ts`, SheetJS cargado bajo demanda) → filas `{ etm, description, description_es, model_code, quantity, price, brand }`.
2. **ETM "new":** se vuelve `DYMMSA-TEMP-n` y luego `DYMMSA-<next+i>` con `GET /api/products/next-dymmsa-code` (`max+1` sobre `etm_products`, **sin reservar**: dos borradores en paralelo pueden sacar el mismo código).
3. **Lookup:** `POST /api/quotes/lookup` (ETM + `modelCodes`) → `found` y `catalogDescriptions`.
4. **Merge** (inline en `quoter/page.tsx`):
   - el catálogo ETM gana `description`, `description_es`, `model_code` y `brand`;
   - el Excel gana `quantity` y `price` (`price` cae al del catálogo si viene vacío);
   - `is_sold` y la `dymmsa_description` curada se heredan del catálogo;
   - `delivery_time = 'immediate'`.
5. **Edición en el store Zustand `dymmsa-quotation-draft`** (localStorage) con `QuotationEditor`. `ProductModal` hace su propio lookup por ETM al agregar una línea.
6. **Pre-flight:** `getMissingHeaderFields`, `hasNoProducts` y `getBlockingIssues`.
7. **`POST /save`** y luego `reset()` del store.

**Conclusión:** crear desde el chat **es viable** si los pasos 3, 4 y 6 se mudan al server (`lookupEtms()` + `prefillLine()` + validación en el store; el cotizador web puede llamar las mismas funciones).

El paso 1 no aplica en el chat: la ruta nunca recibe el .xlsx. Claude lee el Excel adjunto o el usuario dicta, y la tool recibe **filas transcritas** (precedente: `save_time_entries`, ADR-035). El draft de localStorage no se toca nunca: es del navegador.

### `PATCH /api/quotations/[id]/update` — `src/app/api/quotations/[id]/update/route.ts`
- **Auth / rol:** `requireAuth`. Misma RLS abierta.
- **Entrada:** `{ name, customer_name, items }`, los tres obligatorios. Es **replace-all**: `items` es la lista COMPLETA y una línea que no venga se borra. Mismas validaciones que `save` (sin zod, sin `getBlockingIssues`). Estados permitidos: `draft | sent_for_approval | approved`; cualquier otro → 400. Coincide con `canEdit` de `QuotationDetail`.
- **Qué hace:**
  1. Lee el status (404 si no existe) y valida.
  2. Calcula el total.
  3. Lee **todos** los ítems actuales (`limit(5000)`; el error de esta lectura **se ignora**) y arma mapas por id de `is_approved`, `is_sold` y `dymmsa_description`.
  4. Lee el catálogo.
  5. **DELETE de todos los ítems**.
  6. Re-INSERT con `sort_order = index`:
     - `is_approved`: el de la UI si viene (`!== undefined`); si no, el de la BD por `_dbId ?? _id`. `is_sold` sigue la misma regla.
     - `dymmsa_description`: se re-resuelve con la curada de la UI o, si no viene, con el snapshot de la BD.
  7. Si el insert falla: re-INSERT de los originales (best-effort, **su error no se revisa**) + `explainPgError`.
  8. UPDATE de `quotations` (name, customer_name, total_amount). **Su error no se revisa**: si falla, las líneas cambiaron y el encabezado o el `total_amount` sellado quedan viejos sin aviso.
  9. Auto-learn de **todas** las líneas, con `storedSnapshots`.
- **Reglas y efectos secundarios:**
  - **Los ids de `quotation_items` cambian en CADA guardado.** `QuotationDetail` usa esa firma (`itemsSignature`) para saber que llegaron datos nuevos. Ningún id de línea sirve entre dos ediciones.
  - **No toca `status` ni `approval_token`.**
  - `is_approved` se preserva en cualquier estado y las líneas nuevas nacen `null`. En `approved` eso significa que **no entran a la orden** hasta que alguien las apruebe (`create-order` toma solo `is_approved === true`).
  - **Sin transacción:** entre el DELETE y el INSERT la cotización tiene 0 ítems; la página pública los lee en ese momento.
  - **Sin control de concurrencia:** la última escritura gana. Una pestaña abierta en `QuotationDetail` + una edición desde el chat = cambios perdidos.
  - ⚠️ **Auto-learn re-aprende TODAS las líneas reenviadas.** Re-guardar una cotización vieja (aunque sea para cambiar solo el nombre) regresa `etm_products.price` (y descripción, modelo y marca) a los valores de esa cotización.
- **Dónde vive la lógica:** inline en la ruta, con helpers de lib. Hay que extraer `updateQuotationItems()` y crear aparte un `updateQuotationHeader()` (nombre o cliente sin reenviar líneas ni disparar auto-learn).
- **Quién la usa en la UI:** `useUpdateQuotation` → `QuotationDetail.handleSave`, y el autoguardado previo de `handleSendForApproval` y `handleCreateOrder` cuando hay cambios sin guardar (`isDirty`). Las ediciones locales que manda:
  - `ProductModal`: editar o agregar una línea, con lookup del ETM.
  - Botones ✓/✗ (`handleApprovalChange`): **solo se pintan en `approved`**.
  - Separadores: `handleAddSeparatorAfter`, etiqueta y color.
  - Drag & drop para reordenar, y quitar línea.
  - `toItemRow()` convierte filas de la BD a `QuotationItemRow`; hoy vive dentro de `QuotationDetail.tsx`.
  - Al cambiar el ETM de una línea en el modal se conserva su `_dbId`, y con él el `is_approved` que el cliente le dio al producto anterior.

### `PATCH /api/quotations/[id]/status` — `src/app/api/quotations/[id]/status/route.ts`
- **Auth / rol:** `requireAuth`.
- **Entrada:** `{ status }` contra la whitelist `MANUAL_QUOTATION_STATUSES` (`src/lib/quotation-status.ts`: draft, sent_for_approval, approved, rejected). Cualquier otro valor → 400, con un mensaje que habla de "Convertida a orden" aunque el valor sea otro.
- **Qué hace:**
  1. Lee (404 si no existe).
  2. Si el estado actual es `converted_to_order`, busca `orders.quotation_id`: si la búsqueda falla → 500 (fail-closed); si existe la orden → 400 "Elimina la orden vinculada…".
  3. UPDATE `{ status, approval_token: crypto.randomUUID(), approved_at: now() }`. `approved_at` solo se escribe si el destino es `approved` y aún está vacío.
- **Reglas y efectos secundarios:**
  - **Regenera `approval_token` en cada cambio**: el link compartido muere (404).
  - **No hay matriz de transiciones**: cualquiera de los 4 estados va a cualquiera, **incluido el mismo**, que también regenera el token.
  - Preserva `is_approved` y `approved_at`; aquí nunca borra `approved_at`.
  - No valida contenido: se puede marcar `approved` sin líneas aprobadas (luego `create-order` responde 400).
- **Dónde vive la lógica:** inline, salvo la whitelist. Hay que extraer `changeQuotationStatus()`.
- **Quién la usa en la UI:** `useChangeQuotationStatus` → dropdown de `QuotationDetail` con diálogo de confirmación. Se deshabilita si hay cambios sin guardar (`isDirty`), si hay una orden vinculada o si la petición está en curso.

### `POST /api/quotations/[id]/send-for-approval` — `src/app/api/quotations/[id]/send-for-approval/route.ts`
- **Auth / rol:** `requireAuth`. Sin body.
- **Qué hace:** solo desde `draft` (otro estado → 400 con el estado actual). UPDATE `status = 'sent_for_approval'` y devuelve el `approval_token` existente: **no lo regenera** (es el default de la BD o el último que generó `/status`).
- **Reglas y efectos secundarios:**
  - No valida las líneas: la UI solo valida si hay cambios sin guardar antes de autoguardar.
  - **No notifica a nadie**: el link se copia a mano (`handleCopyLink`).
  - Su comportamiento **no tiene test** (solo el 401 de `auth-guards.test.ts`; nada en integration ni e2e).
- **Dónde vive la lógica:** inline (unas 20 líneas); se fusiona en `changeQuotationStatus()`.
- **Quién la usa en la UI:** `useSendForApproval` → `QuotationDetail.handleSendForApproval`.

### `DELETE /api/quotations/[id]` — `src/app/api/quotations/[id]/route.ts`
- **Auth / rol:** `requireAuth`.
- **Qué hace:**
  1. 404 si no existe.
  2. Busca una orden vinculada: si la búsqueda falla → 500; si existe → 400 "Elimina la orden vinculada antes de eliminar esta cotización." (ADR-010).
  3. DELETE `quotations`; los ítems se van por `ON DELETE CASCADE`. Un 23503 (orden ligada después del chequeo) → el mismo 400.
- **Reglas y efectos secundarios:** irreversible, sin soft delete ni bitácora. Lo que el auto-learn ya escribió en `etm_products` se queda.
- **Dónde vive la lógica:** inline.
- **Quién la usa en la UI:** `useDeleteQuotation` → AlertDialog de `QuotationDetail`.

### `POST /api/quotes/lookup` — `src/app/api/quotes/lookup/route.ts` (**lectura**, no escribe)
- **Auth / rol:** `requireAuth`.
- **Entrada:** `{ etmCodes: string[] (no vacío → si no, 400), modelCodes?: string[] }`.
- **Qué hace:**
  1. SELECT de `etm_products` por `etm` → `found` y `notFound`.
  2. `fetchCatalogDescriptionMap()` → `catalogDescriptions`, indexado por `catalogKey`. API-Routes.md dice "code normalizado": la doc está desfasada.
  3. No escribe nada; es POST por el tamaño del arreglo.
- **Dónde vive la lógica:** mixta (el SELECT y el armado inline; el catálogo en `urrea-catalog.ts`). Es justo lo que el store necesita para prellenar líneas server-side → extraer `lookupEtms()`.
- **Quién la usa en la UI:** `useLookupEtms` (cotizador) y `ProductModal` (fetch directo).
- **Ojo:** `tests/mcp/coverage.test.ts` solo barre rutas `GET`, así que esta lectura no está en la red de lectura. La futura red de escritura (por método) debe clasificarla **como lectura**, no como escritura sin tool.

### Referencia: `POST /api/quotations/[id]/create-order`
Lo mapea [[02-Arquitectura/MCP-Escrituras/Ordenes]]. Lo que importa aquí:
- exige `status = 'approved'`;
- toma solo productos con `is_approved === true && is_sold !== false`;
- marca la cotización `converted_to_order`.

Una cotización convertida ya **no es editable** (ni por ruta ni desde el chat) hasta que se elimine su orden y se reabra con `/status`.

### Mapa del caso que disparó #155: "cambia precios y tiempos de entrega de esta cotización"

| Aspecto | Regla hoy (código) | Qué tiene que hacer una tool |
|---|---|---|
| Identidad de la línea | Los ids se regeneran en cada guardado; la UI **no muestra números de línea** | Referenciar por posición `linea` (1-based sobre todas las filas = `sort_order + 1`) + guarda opcional `etm` que debe coincidir; si el ETM se repite (la validación lo permite entre secciones) → `requireSingleMatch` |
| Lista completa | `update` es replace-all | El store arma la lista desde la BD (`toItemRow` → mover a `src/lib`) con `_dbId`, aplica los cambios y reenvía todo |
| `sort_order` | `= index` al reinsertar | Agregar/mover/quitar recalcula por índice; nunca escribir `sort_order` a mano |
| `is_approved` | Se preserva por `_dbId`; nuevas = `null` | No mandarlo salvo cambio explícito. Avisar: "en una aprobada, las líneas nuevas quedan pendientes y no entran a la orden" y "la línea 4 la aprobó el cliente a $X; queda aprobada a $Y" |
| `is_sold` | Tri-estado; `false` sale del total y de la validación, "No disponible" en `/approve`, y **se propaga a `etm_products` (global)** | `vendemos: true / false / null`; avisar el efecto global |
| `dymmsa_description` | Snapshot; el catálogo (`code+brand`) gana a la curada | Si la línea resuelve al catálogo, rechazar el cambio ("tiene descripción oficial URREA"); si no, la curada nueva se snapshotea y el auto-learn la aprende |
| Totales | `calculateQuotationTotal` sella `total_amount` | Responder con el total antes → después |
| Validación | Solo en el cliente (`getBlockingIssues`) | Correrla en el store + zod: `delivery_time` enum (no hay CHECK), cantidad entera > 0, precio ≥ 0, `separator_color` con `isSeparatorColor()` (hoy no se valida en el server) |
| Estados editables | draft / sent_for_approval / approved | `rejected` → "cámbiala a borrador primero"; `converted_to_order` → "elimina la orden y reábrela" |
| `approval_token` | Editar no lo regenera; cambiar de estado sí | En `sent_for_approval` el cliente puede tener la página abierta con ids viejos: **bug** (ver [[02-Arquitectura/MCP-Escrituras/Aprobacion-publica]]) |
| Auto-learn | Re-aprende todas las líneas reenviadas (precio incluido) | Decidir el alcance (pregunta 3) y reportar lo que tocó en `etm_products` |
| Concurrencia | Ninguna | `version` = hash de (ids de ítems + `quotations.updated_at`): cualquier guardado intermedio la cambia |
| Cambio de ETM en una línea | La UI conserva `_dbId` → conserva la aprobación del producto anterior | Tratarlo como reemplazo: prellenar desde el catálogo y no heredar la aprobación sin preguntar (pregunta 4) |
| Edición masiva | La UI no la tiene | Valor nuevo del chat: "entrega 1 semana a todas" → `lineas: 'todas'` |

## Cobertura MCP actual
- `list_quotations` (lectura, `tools/quotations.ts → listQuotations`):
  - parámetros: `status`, `search` (ilike sobre `customer_name`/`name`), `page`, `pageSize`;
  - devuelve el `total_amount` sellado.
- `get_quotation` (lectura, `getQuotation`):
  - parámetro: solo `id` UUID;
  - devuelve encabezado, `orden` ligada, `total` y `total_approved` recalculados, y las líneas en orden.
  - **No** devuelve: id ni posición de línea, `sort_order`, `separator_color`, `description` y `description_es` por separado (las funde), `approval_token` / link ni ninguna versión.
  - Expone `notes` (de la cotización y de la línea), que **ninguna ruta escribe**: columnas muertas. El replace-all de `update` además borraría las notas de línea; hoy hay 0 filas con notas.
- **Hoy no puede:**
  - crear, editar líneas, cambiar estado, enviar a aprobación ni borrar;
  - buscar una cotización por nombre en un paso (hay que pasar por `list_quotations`);
  - el núcleo transaccional quedó solo-lectura por decisión del 2026-08-20 (ADR-015), que #155 revierte.
- **Lectura relacionada:** `search_products` (búsqueda de un ETM por texto; no tiene el lookup masivo) y `search_urrea_catalog`.

## Casos de uso desde el chat
1. "Cámbiale el precio a la línea 4 a 385 y ponle entrega 1 semana" → `update` (precio, `delivery_time`) + auto-learn (`etm_products.price`).
2. "A la de Andritz ponle entrega 2 semanas a todo" → `update` masivo de `delivery_time` (la UI no lo tiene).
3. "Quita el ETM 12345 y agrega 10 piezas del 6954" → `update` (quitar + agregar con prellenado por lookup) + `sort_order`.
4. "Ese no lo vendemos" → `update` con `is_sold=false` (sale del total, "No disponible" en aprobación, global en `etm_products`).
5. "Ponle una sección 'Tornillería' antes de la línea 8" → `update` (separador, `section_label`, color opcional).
6. "Mándala a aprobación y pásame el link" → `send-for-approval` (+ link: pregunta 7).
7. "El cliente me dijo por WhatsApp que aprueba todo menos la línea 5" → `update` (`is_approved` por línea) + `/status approved` (ver [[02-Arquitectura/MCP-Escrituras/Aprobacion-publica]]).
8. "Regrésala a borrador" / "márcala rechazada" → `/status` (regenera el token: el link viejo muere).
9. "Hazme una cotización para GE Power con estos 6 productos" (dictado o Excel adjunto) → `save` + prellenado server-side + auto-learn.
10. "Bórrala" → `DELETE` (propuesto **fuera**).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Editar nombre o cliente | bajo | Encabezado interno; hoy pasa por replace-all y re-dispara el auto-learn de todas las líneas → con `updateQuotationHeader()` aparte queda bajo |
| Editar precio / cantidad / entrega / `is_sold` en `draft` | medio | Reversible a mano pero sin historial; el auto-learn cambia `etm_products` (`price`, `is_sold` global) |
| Lo mismo en `approved` | medio | Cambia lo que irá a la orden; la aprobación del cliente se conserva a otro precio; las líneas nuevas quedan pendientes |
| Lo mismo en `sent_for_approval` | alto (hasta arreglar el bug) | El cliente puede estar viendo la página: ids viejos → sus decisiones se pierden o la cotización queda "aprobada" con 0 líneas |
| Agregar / quitar / mover líneas y separadores | medio | Las posiciones se recorren; quitar es borrar sin historial |
| Aprobar o rechazar líneas a nombre del cliente | medio | Decide qué entra a la orden; es la voz del cliente registrada por DYMMSA |
| Crear cotización (borrador) | medio | No la ve el cliente y se puede borrar; pero el auto-learn inserta ETMs y pisa precios en `etm_products`, y una transcripción mala mete cantidades o precios erróneos |
| Enviar a aprobación (draft → sent) | bajo | Reversible con `/status`; no notifica; el token no cambia |
| Cambio manual de estado | medio | Regenera el token (el link compartido muere); `approved` sella `approved_at` para siempre |
| Reabrir una convertida | medio | Solo si la orden ya se eliminó (guarda en la ruta) |
| Borrar cotización | alto | Irreversible, cascada de líneas, sin bitácora |

## Propuesta de tools

### `save_quotation` (nueva · escritura · bloque app · `adminOnly: true`)
- **Entidad:** cotización de DYMMSA-WEB (encabezado + líneas + estado). Un solo `save_x` por entidad (ADR-034), al estilo de `odoo_save_quotation`: **una intención por llamada**.
- **Intenciones** (se deducen de los parámetros; mezclarlas → error):
  - **crear** — sin `cotizacion`; requiere `nombre`, `cliente` y `lineas`.
  - **editar** — `cotizacion` + `nombre` y/o `cliente` y/o `cambios`.
  - **estado** — `cotizacion` + `estado`.
- **Parámetros principales:**
  - `cotizacion?`: UUID o texto (nombre o cliente) → `requireSingleMatch`.
  - `nombre?`, `cliente?`.
  - `lineas?` (crear): lista de dos formas:
    - producto: `{ etm, cantidad, precio?, entrega?, vendemos?, codigo?, marca?, descripcion?, descripcion_dymmsa? }`. El server prellena desde `etm_products` con las reglas del cotizador. `etm: "nuevo"` asigna `DYMMSA-N` (pregunta 6).
    - sección: `{ seccion, color? }`.
  - `cambios?` (editar): lista de operaciones:
    - **editar:** `{ linea | lineas: number[] | 'todas', etm?, precio?, cantidad?, entrega?, vendemos?, descripcion_dymmsa?, aprobacion?: 'aprobada' | 'rechazada' | 'pendiente' }` (`etm` es la guarda);
    - **agregar:** `{ agregar: <producto | sección>, despues_de? }`;
    - **quitar:** `{ quitar: linea, etm? }`;
    - **mover:** `{ mover: linea, a: linea }`.
  - `estado?`: `draft | sent_for_approval | approved | rejected` (`converted_to_order` nunca).
  - `confirmar?: true` y `version?`.
- **Patrón de confirmación:**
  - **crear y editar = confirmar.** La primera llamada no escribe nada y devuelve:
    - un resumen línea por línea antes → después, con los ETM prellenados y los no encontrados;
    - el total antes → después;
    - `bloqueos` (validación);
    - `avisos`: aprobación conservada, líneas nuevas pendientes, `is_sold` global, qué tocará el auto-learn en `etm_products`;
    - la `version`.

    La segunda llamada, con `confirmar: true` y la misma `version`, escribe; si cambió algo responde "vuelve a pedir el resumen" sin escribir.
  - **estado:** `sent_for_approval` desde `draft` = **directo** (bajo; valida líneas antes). Cualquier otro = **confirmar** (avisa que el link muere y que `approved` sella la fecha).
  - En `sent_for_approval`: **bloquear la edición** mientras no se arregle el bug de ids de [[02-Arquitectura/MCP-Escrituras/Aprobacion-publica]].
- **Store y refactor necesarios:**
  - `src/lib/quotations-store.ts`, compartido por rutas y tool (`QuotationError` → 400/404 en la ruta, `ToolError` en la tool):
    - `createQuotation()` (de `save`);
    - `updateQuotationItems()` (de `update`);
    - `updateQuotationHeader()` (nuevo, sin auto-learn);
    - `changeQuotationStatus()` (une `/status` y `send-for-approval`).
  - `src/lib/quotation-edit.ts` (puro, testeable): `toItemRow()` (mudarlo desde `QuotationDetail.tsx`), `applyQuotationChanges()`, `diffQuotation()` y `quotationVersion()`.
  - `lookupEtms()` (de `/api/quotes/lookup`) y `prefillLine()` (merge del cotizador, hoy inline en `quoter/page.tsx`): lo usan la ruta, el cotizador y la tool.
  - Validación server-side: `getBlockingIssues()` + zod del enum de entrega + `isSeparatorColor()`. De paso, revisar el error del UPDATE del encabezado y el de la lectura previa en `update`.
- **Reemplaza / fusiona:** nada de escritura existente. Hay que **cambiar `get_quotation`** para que la edición sea direccionable:
  - aceptar nombre o cliente (`requireSingleMatch`);
  - devolver `linea`, `separator_color`, `description` y `description_es` por separado, y la `version`.
- **Total de tools nuevas: 1** (`save_quotation`). El bloque app está en 36/36:
  - **Opción A (recomendada):** fusionar `list_quotations` dentro de `get_quotation` (sin cotización o con varias coincidencias = listado paginado; con una = detalle, como `get_profiles` sin persona) → impacto neto 0.
  - **Opción B:** subir el tope a 37.
  - En los dos casos el esquema de `cambios` es grande (estimado 2.5–3.5 k caracteres) y presiona `listTotal` (54,000 en el cable desde #158; 47,000 con el stub al escribir esta ficha), como pasó con las líneas de Odoo (ADR-040).
- **Opcional, no incluida en el total:** `preview_quotation` como vista MCP Apps (tabla con botón "Guardar") para crear desde un Excel largo transcrito (precedente `preview_time_report`, ADR-036) → +1 tool. Si se quisiera "alto" con clave HMAC, ojo: `src/lib/odoo/preview-token.ts` deriva su secreto de `ODOO_WRITE_API_KEY` (llave por ventanas, solo en Production); un secreto propio de la app sería requisito.

## Fuera a propósito
- `DELETE /api/quotations/[id]`: irreversible, en cascada y sin bitácora; mismo criterio que "borrar facturas se queda en la app" (ADR-030).
- `POST /api/quotes/lookup`: es lectura. La cubre `search_products` para consultas puntuales y el store la usa por dentro para prellenar.
- `POST /api/quotations/[id]/create-order`: se decide en [[02-Arquitectura/MCP-Escrituras/Ordenes]] (descuenta stock).
- El store Zustand `dymmsa-quotation-draft`: estado local del navegador, no es del server.
- `GET /api/products/next-dymmsa-code`: consecutivo del módulo Productos. Si `etm: "nuevo"` entra, su lógica se extrae allá (no reserva el número; el SELECT sin `limit` queda sujeto al tope de 1000 filas de PostgREST).

## Preguntas abiertas
1. ¿Diego (quien pidió el cambio) es admin? Toda escritura nueva sería `adminOnly`, pero la app deja editar cotizaciones a **cualquier** sesión y la RLS no distingue rol: el filtro del MCP sería más estricto que la app, no una barrera.
2. ¿Se permite editar desde el chat una cotización `sent_for_approval`? La recomendación es bloquearlo hasta arreglar el bug de ids viejos de `/approve` (o arreglarlo primero).
3. Auto-learn en ediciones del chat: ¿igual que la app (re-aprende todas las líneas reenviadas, precio incluido → `etm_products.price`), solo las líneas cambiadas, o nada? El mismo problema ya afecta a la app al re-guardar cotizaciones viejas.
4. Cambiar precio, cantidad o ETM de una línea que el cliente ya aprobó: ¿conserva la aprobación (hoy sí) o vuelve a pendiente?
5. ¿El chat puede aprobar o rechazar líneas a nombre del cliente? ¿Solo en `approved` (como los ✓/✗ de la UI) o en cualquier estado (como acepta la API)?
6. Crear desde el chat: ¿sí? ¿`etm: "nuevo"` asigna `DYMMSA-N` con un consecutivo que no se reserva? ¿Vista previa MCP Apps para listas largas (+1 tool)?
7. ¿El chat puede dar el link de aprobación? El `approval_token` es una credencial sin sesión (quien lo tenga aprueba); hoy `get_quotation` no lo expone.
8. Presupuesto: ¿fusionar `list_quotations` en `get_quotation` o subir el tope de la app?
9. ¿Una intención por llamada, o permitir "edítala y mándala a aprobación" en una sola (la UI autoguarda y luego envía)?
10. `save_quotation` convive con `odoo_save_quotation`: ¿basta la instrucción de "dos mundos" o conviene otro nombre (p. ej. `save_app_quotation`) para que "cambia esta cotización" no caiga en Odoo?
11. Cambio manual de estado desde el chat: ¿matriz de transiciones (hoy no hay: incluso el mismo estado regenera el token)? ¿Se permite marcar `approved` a mano?
