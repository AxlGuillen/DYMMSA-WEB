# ADR-031 — La documentación del asistente se genera del manifiesto del MCP

**Fecha:** 2026-09-24
**Estado:** Aceptado · issue #118
**Relacionado:** [[ADR-015-MCP-Interno]] · [[ADR-025-Bloque-Odoo-MCP]] · [[ADR-030-MCP-Cobertura-y-Escrituras-Payables]] · [[ADR-024-Vistas-Guiadas]] (mismo patrón anti-drift)

## Contexto

La auditoría del 2026-09-24 encontró la documentación in-app (`/dashboard/docs`) detenida en el
2026-07-09: ocho módulos sin una línea y tres afirmaciones falsas (el Excel URREA "solo marca
URREA" y descargado desde la orden; la recepción "suma al inventario"). El MCP, que crece casi
cada semana, no aparecía en ningún lado. Una pestaña escrita a mano envejecería igual.

## Decisión

1. **`src/lib/mcp/manifest.ts`** es la única descripción "para humanos" de cada tool: nombre,
   bloque (`app`/`odoo`), módulo, `read`/`write`, título, pregunta ejemplo y —solo en las
   escrituras— sus límites. La sección **Asistente (IA)** de la documentación se **renderiza del
   manifiesto** (`docs/sections/AssistantSection.tsx`): conteos, agrupación por módulo, distintivo
   "escribe" y la lista de acciones con sus límites.
2. **`tests/mcp/manifest.test.ts`** lee `server.ts` y exige igualdad en ambos sentidos: una tool
   registrada sin manifiesto o una entrada sin tool rompe el CI. Además fija que las escrituras
   son exactamente las cinco aprobadas (ADR-015/ADR-030), que cada una declara límites, y que el
   bloque Odoo no contiene escrituras (ADR-025). **Agregar una tool = agregar su fila al
   manifiesto**, o el CI lo recuerda.
3. La página de docs se parte en **secciones por archivo** (`docs/sections/*.tsx`, con `DocSection`
   como marco común) en vez de seguir creciendo el único `page.tsx` de 1,300 líneas. Las
   secciones nuevas: Planificar compra, Corte y medidas, Proveedores, Finanzas, Horas y Equipo,
   Tablas/vistas guiadas/atajos, Asistente. El flujo del sistema gana los pasos de planificar
   compra y corte, y la recepción dice la verdad (solo el excedente entra al inventario, ADR-019).

## Consecuencias

- `server.ts` sigue siendo la verdad ejecutable (títulos y descripciones para el modelo); el
  manifiesto es la verdad **para las personas**. Se toleran dos textos porque tienen audiencias
  distintas; lo que no se tolera es que difieran en *qué tools existen* — eso lo cuida el test.
- `SERVER_INSTRUCTIONS` no se genera del manifiesto (agrupa con reglas, no solo lista); queda
  como está.
- La documentación no describe la bitácora de facturas (ADR-028): un member la lee.
