# ADR-041: dos conectores MCP (DYMMSA-WEB y Odoo DYMMSA) y reglas de composición de tools

**Fecha:** 2026-10-22
**Estado:** Aceptado. Implementación por fases, ver [[02-Arquitectura/MCP-Escrituras/01-Plan]] §7. **B3 hecho (2026-10-24):** los dos conectores ya están separados; medidas finales en § «Presupuestos por conector».
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

## Consecuencias

- **Reconexión.** El admin agrega «Odoo DYMMSA» en claude.ai y en Claude Code, y vuelve a dar los permisos por tool de las renombradas. Las rutinas que citan nombres viejos se actualizan.
- **Requisitos antes de abrir Órdenes e Inventario:**
  - los bugs de stock (Track 0);
  - mover el stock de forma atómica en la BD.
- **Cotizaciones** requiere antes el arreglo de `/approve` con ids viejos.
- **Variable nueva** `MCP_PREVIEW_SECRET` en Vercel (Production y Preview).
- **El trabajo se ordena por fases:** A (base sin cambio de comportamiento), B (separar), C (calidad transversal) y D (escrituras por entidad, en pares store → tool).
