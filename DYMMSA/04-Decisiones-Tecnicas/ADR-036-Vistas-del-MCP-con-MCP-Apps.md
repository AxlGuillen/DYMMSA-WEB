# ADR-036 — Vistas del MCP con MCP Apps

**Fecha:** 2026-10-07
**Estado:** Aceptado (prueba con una vista) · sin issue
**Relacionado:** [[ADR-023-MCP-OAuth-Supabase]] · [[ADR-034-MCP-Reglas-de-Crecimiento]] · [[ADR-035-Reporte-del-Checador-por-el-MCP]]

## Contexto

El conector solo respondía texto: la revisión del reporte del checador antes de guardarlo era una
tabla que el modelo tenía que redactar y el usuario confirmar por escrito. MCP-UI, que se evaluó
antes, se convirtió en enero de 2026 en la extensión oficial **MCP Apps**
(`io.modelcontextprotocol/ui`). Una tool declara `_meta.ui.resourceUri: ui://…` y el host
pinta ese recurso (`text/html;profile=mcp-app`) en un iframe aislado, con un puente
JSON-RPC por `postMessage`.

Soporte medido en octubre de 2026:
- **La pinta:** Claude web, escritorio y móvil (chat), Cowork web y escritorio, ChatGPT, VS Code y Goose.
- **No la pinta:** Cowork móvil (claude-ai-mcp#1085) y Claude Code (solo texto).

Donde no hay soporte, el host usa el resultado de texto de siempre.

## Decisión

1. **Una vista por ahora, como prueba:** `preview_time_report`, la revisión del reporte del
   checador. Es una tool de **lectura** (ADR-034: lectura y escritura nunca juntas) que devuelve
   lo siguiente; nada se guarda:
   - la tabla por persona y día;
   - los totales contra los del propio reporte;
   - quién no tiene perfil y quién no vino.

   La vista lo pinta con un botón "Guardar en Horas" que llama `save_time_entries` con las
   mismas filas (las recibe en `ui/notifications/tool-input`). Después avisa al modelo con
   `updateModelContext` para que no ofrezca guardar otra vez. Sin vista, la misma respuesta le
   sirve al modelo para mostrar el resumen y pedir confirmación.
2. **`@modelcontextprotocol/ext-apps` 1.3.2**, la última que acepta el SDK 1.26 que fija
   `mcp-handler` 1.x. La 1.4+ pide SDK ≥1.29, y `mcp-handler` 2 exige el SDK v2. Esa migración
   va aparte. El protocolo de la extensión (2026-01-26) es el mismo.
   - En el servidor: `registerAppTool` / `registerAppResource` sobre el `McpServer` de siempre.
   - En la vista: la clase `App`, más `applyDocumentTheme` / `applyHostStyleVariables` para
     tomar el tema y los colores de Claude.
3. **HTML autocontenido y versionado en git.**
   - La vista vive en `src/mcp-views/<nombre>/` (`main.ts` sin React + `styles.css`).
   - `bun run build:mcp-views` la empaqueta con `Bun.build` en un solo HTML y la escribe en
     `src/lib/mcp/views/generated.ts`, con el hash de sus fuentes y de la versión de ext-apps.
   - `tests/mcp/views.test.ts` falla si el HTML quedó viejo, o si carga algo externo (sin CSP
     que declarar).
   - Así Vercel no necesita un paso de build extra. Pesa ~300 KB, casi todo zod y el protocolo
     del cliente; el host la descarga una vez.
4. **Mismos permisos que la tool.**
   - La vista solo pinta lo que devolvió la tool y llama tools con el token de quien la usa.
   - La tool y su recurso se registran solo para el admin: un member no ve ninguno.
   - Todo texto se inserta con `textContent`, porque nombres y notas vienen de filas transcritas.
5. **Identidad del servidor:** `serverInfo` declara `title`, `websiteUrl` e `icons`
   (`/dymmsa-logo.webp`). Hoy Claude no pinta el icono de un conector propio (sale la letra,
   claude-ai-mcp#152); queda declarado para cuando lo haga.

## Consecuencias

- **Presupuesto:** `TOOL_BUDGET.listTotal` sube de 36,000 a 37,000. La tool de lectura gemela
  es obligatoria por ADR-034, y el test ahora mide también `_meta`. Medición: admin 50 tools,
  ~36,350 de `tools/list`, ~7,310 de instrucciones (tras recortar dos líneas en la review del PR #138; el tope sigue en 7,500).
- **Vistas siguientes,** si la prueba convence: corte de nómina, Mi semana, cierre del mes. Cada
  una se suma a `VIEWS` en `scripts/mcp-views.ts` y lleva su tool de lectura.
- **Al subir ext-apps** cambia el hash: hay que regenerar las vistas, y el test lo recuerda.

## Alternativas descartadas

- **Formularios nativos (elicitation)** para confirmar: Cowork escritorio los declara y nunca los
  muestra (la llamada se cuelga), y no dan una tabla.
- **Cargar ext-apps desde un CDN** dentro del HTML: obliga a declarar dominios en la CSP y a
  depender de un tercero al pintar.
- **React en la vista:** triplica el peso para una tabla y un botón.
