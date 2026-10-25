# ADR-040: escrituras acotadas en Odoo (cotización → venta → factura en borrador, nunca timbrar)

> **Ampliado por [[ADR-041-Dos-Conectores-MCP-y-Composicion-de-Tools]] (2026-10-22):**
> - Se aprueba una séptima operación: asignar la clave SAT a un producto existente, dentro de `odoo_save_product` y con el botón de la vista (#154).
> - `product.unspsc.code` entra al catálogo de lectura.
> - `odoo_confirm_quotation` se separa de `odoo_save_quotation`.
> - `odoo_create_draft_invoice` pasa a dos fases.
> - Las tools Odoo viven en su propio conector, «Odoo DYMMSA».
>
> **2026-10-24 (ADR-041 B2b, #155):** confirmar ya es `odoo_confirm_quotation` (`folio` + `clave` de la revisión, misma firma y mismo `confirmSale` de la fachada) y `odoo_save_quotation` perdió `confirmar`. `odoo_create_draft_invoice` sin `confirmar` solo devuelve el resumen y con `confirmar: true` crea el borrador como antes. Las 6 operaciones y la lista negra no cambian.
>
> **2026-10-24 (ADR-041 B2c, #154): séptima operación y `product.unspsc.code` en el catálogo de lectura** (decisión 13 de ADR-041, aceptada el 2026-10-22).
> - **La 7.ª operación es `product.product.write` con `vals` = solo `unspsc_code_id`** (`write-catalog.ts`, zod `strict`, de 1 a 40 ids, sin contexto). Precio, nombre, impuestos, tipo o archivar se rechazan con «campo no permitido», y la lista negra sigue evaluándose primero (`x_studio_*`, `l10n_mx_*`, `unlink`, `toggle_active`, contexto `active_test`…). La fachada la expone como `assignSatKey(proof, ids, satKeyId, dl)` y exige el `AdminProof` vivo. Su resultado incierto tiene su propio consejo (`sat-keys`): repetir el mismo clic, y los que ya tengan clave salen como ya asignados.
> - **Sin tool nueva:** va dentro de `odoo_save_product` en modo `asignar` (`[{ producto_id, clave_sat, clave_sat_tecleada? }]`), con el mismo botón de la vista y la misma autorización en `_meta`. Antes de escribir relee los productos: **una clave que alguien ya capturó en Odoo no se pisa** (sale en `ya_tenian`). Una escritura por clave distinta.
> - **La autorización firma las claves permitidas** (claims `v: 2`): `h` es la lista de alta **sin** sus claves, `ks` las ofrecidas por producto nuevo (la de la línea más hasta 3 sugeridas) y `a` los existentes sin clave con las suyas. El servidor acepta una clave ofrecida, o una que el admin tecleó (`clave_sat_tecleada: true`) y que existe en el catálogo; cualquier otra es «La autorización no corresponde a estos productos». `01010101` y una clave inexistente siguen con los mensajes de siempre.
> - **Sugerencias en la vista previa:** una sola lectura de `product.unspsc.code` (`code`, `name`, activos, OR de `ilike`, tope 400) cuando algún producto nuevo o existente de las líneas no tiene clave, con proyección fija como el resto del camino de escritura (no pasa por `ODOO_CATALOG`). La línea acepta `categoria_sat` para buscar con ese texto. Una vista previa bloqueada no la gasta; si la lectura falla, la vista previa sale igual, con aviso.
> - **`product.unspsc.code` (`code`, `name`) entra a `ODOO_CATALOG`** para que `odoo_search_records` responda «¿qué clave SAT llevan las brochas?». Revierte la alternativa descartada de abajo solo para este modelo: es el catálogo público del SAT, y hoy solo se conecta el admin.
> - **Fuera:** recordar la clave elegida para la próxima vez (puente app↔Odoo, decisión 9).

**Fecha:** 2026-10-18
**Estado:** Aceptado e implementado. Infraestructura en PR #149; registro de las 4 tools, vista `odoo-quotation`, manifiesto, consentimiento e instrucciones el 2026-10-20 (rama `feat/144-wire-odoo-writes`). Falta la prueba en producción.
**Relacionado:** [[ADR-025-Bloque-Odoo-MCP]] · [[ADR-034-MCP-Reglas-de-Crecimiento]] · [[ADR-036-Vistas-del-MCP-con-MCP-Apps]] · issue #144

## Contexto

Hasta ahora el bloque Odoo del MCP solo leía (ADR-025). La #144 pide que el asistente:
- cree y edite **cotizaciones** (`sale.order` en borrador);
- las **confirme** como venta;
- haga la **factura completa en borrador** desde una venta confirmada.

Nunca debe publicar, timbrar ni enviar. La facturación oficial vive en Odoo Online 19 y el timbrado (PAC SW) está **en producción**: un `action_post` por error sería un CFDI real.

Lo que encontró la exploración de solo lectura (2026-10-17):
- **La llave es de administrador.** Odoo tiene un solo usuario interno, el dueño (uid 2), y su llave tiene todos los permisos, así que Odoo no frenaría nada. Un usuario técnico con solo Ventas sí frenaría `_post`, pero cuesta una licencia.
- **Política de facturación.** El 99.6 % de los productos son bienes con política de facturación "por entrega".
- **Efecto de confirmar.** Confirmar crea la entrega OFI/OUT.
- **Nada timbra un borrador.** No hay automatizaciones, y los crons no tocan borradores con `auto_post='no'`.
- **El borrador no consume folio.** En v19 tiene `name=false`; la F se asigna al publicar.

## Decisiones (con el usuario, 2026-10-16/17)

1. **Solo administradores.** Un member no recibe las tools.
2. **El asistente confirma ventas,** siempre tras el sí explícito del usuario.
3. **Factura completa y nada más.** Siempre `advance_payment_method='delivered'`: sin anticipos, porcentajes ni montos fijos. Para bienes, solo después de que una persona valide la entrega en Odoo. La tool lo revisa antes y nunca toca inventario.
4. **Productos nuevos:**
   - solo con el clic en el botón de la vista;
   - solo como bienes (`consu`), con los defaults de la instancia (factura por entrega, IVA 16, Unidades);
   - clave SAT opcional con aviso; el asistente nunca la inventa;
   - los servicios nuevos se dan de alta a mano.
5. **Sin clientes nuevos** (`res.partner` nunca se crea).
6. **Edición:** cualquier cotización `draft`/`sent`, incluidas las hechas a mano. Se edita línea por línea y conserva las descripciones escritas.
7. **Atribución al dueño.** Todo queda como uid 2 (`create_uid`, chatter, vendedor). Cada escritura **agrega** una línea en `internal_note` con qué administrador de DYMMSA-WEB la pidió, sin pisar la nota.
8. **Encendido por ventanas.** `ODOO_WRITE_API_KEY` se pone en Vercel **solo en Production** cuando se va a usar y se quita al terminar, con redeploy en cada caso. En Preview cualquier rama escribiría en el Odoo real.
9. **Sin puente con las cotizaciones de la app en v1.** La regla de oro sigue igual.

## Diseño: la frontera de escritura, por capas

| Capa | Dónde | Garantía |
|---|---|---|
| Lector de solo lectura | `client.ts` (`READ_METHODS` congelado: `search_read`, `read_group`, `search_count`; `assertReadCall` antes de la cola) | Ninguna lectura, actual o futura, puede escribir |
| Llave aparte | `env.ts` (`ODOO_WRITE_API_KEY`, sin respaldo en `ODOO_API_KEY`, leída en cada llamada) | Sin la variable no se escribe nada y las lecturas siguen; es el interruptor |
| Escritor crudo | `client.ts` `createOdooRawWriter`: misma cola, `https` obligatorio, sin seguir redirecciones, sin reintentos salvo un 429 corto | Una sola vía de red para escribir |
| Allowlist + lista negra | `write-catalog.ts`. La lista negra (account*, l10n_mx*, res.partner*, stock.*, mail.*, ir.*; métodos post/send/edi/stamp/unlink/cancel…; llaves `l10n_mx*`/`x_studio*`; contexto `default_*`, `send_email`…) **se evalúa primero**. Después vienen las operaciones exactas con zod `strict`: 6 al aprobarse, 7 desde el 2026-10-24 | `sale.order` create/write/action_confirm, `product.product.create`, `product.product.write` solo con `unspsc_code_id` (#154) y el wizard de factura (create + create_invoices con su contexto exacto). Nada más |
| Fachada | `writer.ts`: ids, contexto y nota interna los arma el servidor; los `[1]`/`[2]` solo tocan líneas releídas de **esa** venta (`ownedSaleLines`) | El chat nunca manda contexto, ids de wizard ni comandos libres |
| Admin vivo | `requireLiveAdmin` relee `profiles` (TTL 90 s) y emite un `AdminProof` reconocido por identidad (`WeakSet`) | Un objeto armado por el modelo nunca pasa; un admin degradado deja de escribir |
| Clave de vista previa | `preview-token.ts`: HMAC (secreto derivado de la llave de escritura) que ata admin, contenido canónico, intención (`crear`/`editar`/`confirmar`) y `write_date`; vale 30 min | Se guarda exactamente lo que se mostró, y si alguien cambió la cotización desde la vista previa se rechaza |
| Autorización del botón | Solo en `_meta` del resultado de la vista previa (`withResultMeta`) | Sin vista no hay alta de productos; `visibility ['app']` es solo una pista para el host |
| Idempotencia | `origin = 'Asistente DYMMSA · <k10>'`, derivado de la clave. Antes de crear se busca; dos coincidencias son error | Repetir la misma llamada no duplica |
| Resultado incierto | `OdooUncertainWriteError(operación, reintento)`: nunca se reintenta solo, y el mensaje pide repetir **la misma** llamada | Un timeout no duplica ni deja la duda escondida |
| Plazo | `deadline.ts`: presupuesto de 50 s bajo el `maxDuration` de 60, revisado **al salir de la cola**; con menos de 15 s no sale a la red | Ninguna función se corta a media escritura |
| Verificación posterior | La factura se relee: `state='draft'`, sin `name`, sin `sending_data`, `l10n_mx_edi_cfdi_state` vacío | Si algo saliera distinto, se avisa |

**Fuera, a propósito:** publicar, timbrar, enviar, cancelar o borrar (desde el MCP), clientes, pagos, notas de crédito, validar entregas e inventario, anticipos y facturas parciales.

## Presupuesto del MCP (ADR-034)

Son 4 tools nuevas: `odoo_preview_quotation`, `odoo_save_quotation`, `odoo_save_product` y `odoo_create_draft_invoice`. Odoo pasa de 15 a 19 y el tope sube de 16 a 20 (decisión 2026-10-16). Con las tools se suben también, de forma explícita, `descriptionsTotal`, `listTotal` e `instructions`, que hoy están casi llenos. `odoo_create_draft_invoice` queda como excepción con nombre a la regla "una `save_x` por entidad", igual que `update_payable`. `requireLiveAdmin` revierte, para Odoo, la alternativa descartada en ADR-034 de "leer el rol en cada llamada": aquí sí se relee, porque la RLS no protege a Odoo.

## Alternativas descartadas

- **Usuario técnico de Odoo** (solo Ventas): frenaría `_post` dentro de Odoo, pero cuesta una licencia, no cierra el wizard de envío ni `l10n_mx_edi.document`, y no puede limpiar pruebas. Queda como defensa adicional futura; la barrera del código es obligatoria con cualquier llave.
- **Una sola llave para leer y escribir:** no permite apagar solo las escrituras.
- **Ampliar `ODOO_CATALOG` para las tools nuevas:** ampliaría `odoo_query` para los members. Las tools leen con proyecciones fijas.

## Pendiente

- ~~**PR siguiente:** vista `odoo-quotation`, registro de las 4 tools, manifiesto, consentimiento, instrucciones, presupuesto, documentación in-app y CLAUDE.md.~~ Hecho el 2026-10-20. Notas del cableado:
  - `odoo_save_product` se registra con `_meta.ui.visibility: ['app']`: el host no se la ofrece al modelo, solo al botón de la vista.
  - La vista copia la llave `dymmsa/autorizacion` en vez de importar `preview-token.ts` (empaquetaría `node:crypto`); `tests/mcp/views.test.ts` la amarra a `PRODUCTS_AUTHORIZATION_META`.
  - La documentación in-app no lista las 4 tools (son `adminOnly`, como Nómina); deja de decir «nunca escribe en Odoo» y dice «nunca publica, timbra ni envía».
  - Topes de ADR-034: Odoo 16 → 20 tools, descripciones 18,500 → 20,000, `tools/list` 40,000 → 47,000 (el esquema de líneas viaja en la vista previa y en el guardado), instrucciones 7,500 → 8,000.
- **Prueba en producción:** con el guion de la fase A y el contacto de la empresa, fuera de horario y con el dueño avisado. Después se anotan aquí sus resultados en §Verificación.
