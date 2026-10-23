# MCP escrituras — Ajustes

> Issue #155 · Fase 0 (mapa, sin código) · Revisado contra el código el 2026-10-22
> Ver [[02-Arquitectura/MCP-Escrituras/00-Matriz]] · [[02-Arquitectura/API-Routes]]

## Resumen

`app_settings` es un key → `value` JSONB **sin seeds**: si una fila no existe, rige el default del código.
- `DEFAULT_PURCHASE_THRESHOLDS = { money: 100, pct: 0.8 }` en `src/lib/purchase-plan.ts`.
- `DEFAULT_CUT_MARGIN_MM = 20` en `src/lib/cut-plan.ts`.

Un solo método escribe: `PATCH /api/settings`, con whitelist estricta de **tres** keys. El MCP solo lee (`get_app_settings`). ADR-037 dejó la configuración fuera a propósito.

El riesgo es **medio**: cada cambio es global y silencioso. Todas las órdenes recalculan al vuelo su recomendación de mayoreo o menudeo y su necesidad de material de corte.

## Rutas que escriben

### `PATCH /api/settings` — `src/app/api/settings/route.ts`
- **Auth / rol:** `requireAuth`: cualquier sesión, member incluido. RLS `"Authenticated users can manage app settings"`: `FOR ALL TO authenticated USING (true)`.
  - La whitelist **solo existe en la ruta**.
  - Por PostgREST directo, un usuario autenticado puede escribir cualquier key con cualquier valor.
  - Los resolvers de lectura descartan los valores inválidos y caen al default ("config never breaks the plan").
- **Entrada:** body `{ settings: { key: value, … } }`. Vacío → 400 "El body debe incluir \"settings\" con al menos una key". Cada key pasa por `SETTING_VALIDATORS`, que está **inline en la ruta**:
  - `purchase_threshold_money` (`SETTING_THRESHOLD_MONEY`): número finito > 0, en MXN, sin tope;
  - `purchase_threshold_pct` (`SETTING_THRESHOLD_PCT`): número finito en (0, 1]. Es una **fracción**: la UI captura de 1 a 100 y divide entre 100;
  - `cut_margin_mm` (`SETTING_CUT_MARGIN_MM`): número finito ≥ 0. **0 es válido** (#59).

  Una key desconocida → 400 "Configuración desconocida: …"; un valor inválido → 400. La validación es todo-o-nada: revisa todas las keys antes de escribir.
- **Qué hace:** un solo upsert de todas las entradas con `onConflict: 'key'`. El trigger `update_app_settings_updated_at` corre en los updates. Responde `{ settings: body.settings }`.
- **Reglas y efectos secundarios:**
  - No hay "borrar la key" ni "volver al default": para restablecer se escribe el valor default explícito.
  - Umbrales:
    - la recomendación del planificador se calcula al vuelo por orden (ADR-018), así que mover un umbral cambia la recomendación de **todas** las órdenes;
    - las decisiones ya guardadas (`order_purchase_decisions`) no cambian: solo quedan stale si cambia N o el std;
    - si el % parado sube de nivel, grupos que antes se redondeaban pueden pasar a "revisar", y "revisar" bloquea el guardado.
  - El margen de corte cambia la necesidad neta de todas las listas de corte y del corte rápido.
  - Las lecturas usan `resolveThresholds()` (`purchase-plan.ts`) y `resolveCutMargin()` (`cut-plan.ts`), con las mismas reglas que la whitelist.
- **Dónde vive la lógica:** `SETTING_VALIDATORS` y el upsert viven inline en la ruta; las constantes de las keys y los resolvers, en lib. Antes de cablear una tool hay que extraer a `src/lib/settings-store.ts` (o `settings.ts`):
  - `SETTING_VALIDATORS` / `parseSettingsPatch()`;
  - `saveSettings(db, entries)`.

  `get_app_settings` tiene además su propia lista `KEYS` (`tools/settings.ts`): debería salir de la misma fuente.
- **Quién la usa en la UI:** `useUpdateSettings` (`src/hooks/useSettings.ts`), que invalida `['settings']` y las órdenes. La llaman:
  - `PurchasePlanner`, en el popup de umbrales: valida, guarda, vuelve a pedir el plan y avisa cuántas recomendaciones cambiaron **en esa orden**;
  - `CutPlanner`, con el margen al salir del campo (onBlur), en el modo de orden y en el corte rápido.

## Cobertura MCP actual

- **`get_app_settings`** (lectura, sin parámetros): `planificador_compra.umbral_dinero_parado_mxn`, `umbral_pct_parado` (fracción) y `corte.margen_por_corte_mm`, más `guardadas` / `por_default` (qué key tiene fila y cuál corre con el default).
- `get_purchase_plan` y `get_cut_plan` resuelven los mismos valores para sus cálculos.
- **No puede hoy:** cambiar ninguna configuración.

> La doc va atrasada: la sección "Keys actuales" de `app_settings` en CLAUDE.md y la fila `PATCH /api/settings` de [[02-Arquitectura/API-Routes]] solo listan `purchase_threshold_money` y `purchase_threshold_pct`. La whitelist real también tiene `cut_margin_mm`.

## Casos de uso desde el chat

1. "Sube el umbral de dinero parado a $150" → `purchase_threshold_money = 150`.
2. "Pon el % parado en 70 %" → `purchase_threshold_pct = 0.7`.
3. "El margen de corte ahora es de 3 mm" / "corta sin margen" → `cut_margin_mm = 3` / `0`.
4. "Regresa los umbrales a los de fábrica" → 100 y 0.8 explícitos (no hay borrado de key).
5. "¿Cuántas recomendaciones de la orden 12 cambian si subo el umbral a $200?" → simulación. La UI solo la mide después de guardar, y por orden.
6. "¿Qué umbrales tengo?" → `get_app_settings` (lectura, ya existe).

## Riesgo por operación

| Operación | Riesgo | Por qué |
|---|---|---|
| Cambiar umbral de dinero parado | medio | Global y silencioso: mueve recomendaciones en todas las órdenes abiertas; reversible y validado |
| Cambiar % parado | medio | Igual, y puede pasar grupos a "revisar", lo que bloquea guardar el plan hasta decidir |
| Cambiar margen de corte | medio | Cambia cuánto material se pide en todas las listas de corte; 0 es legítimo |
| Restablecer defaults | medio | Es el mismo upsert con valores conocidos |

## Propuesta de tools

**`save_app_settings` (nueva)** — entidad: configuración de la app.
- Parámetros:
  - `umbral_dinero_parado_mxn?`: > 0;
  - `umbral_pct_parado?`: fracción (0, 1], descrita como "0.8 = 80 %". Un `80` se rechaza con un mensaje que lo explica;
  - `margen_por_corte_mm?`: ≥ 0;
  - `restablecer?: true`: escribe los defaults del código, sin borrar filas;
  - `confirmar?: true`.

  Los nombres son los mismos que devuelve `get_app_settings`, para que el modelo no tenga que traducir.
- **Patrón: confirmar** (riesgo medio).
  - Sin `confirmar`: valida y devuelve `{ actual, nuevo, default }` por key, más "nada guardado; repite con confirmar: true".
  - Con `confirmar`: hace el upsert vía `settings-store`.
- **Nunca** acepta un par genérico `clave`/`valor`: el contrato es la whitelist.
- `adminOnly`: sí.
- Refactor: `src/lib/settings-store.ts`, con una sola lista de keys, sus validadores y `saveSettings`, compartida por `PATCH /api/settings`, `get_app_settings` y la tool nueva.
- Costo: **+1 tool**, unos 1,000 caracteres de `tools/list` (estimado).

**Alternativa (0 tools):** seguir fuera, como decidió ADR-037. Son tres números que se cambian muy de vez en cuando, y la UI muestra el impacto en la orden abierta al guardar. Lo que se pierde es "cámbialo desde el celular".

**Total del módulo:** +1 tool nueva (`save_app_settings`), o 0 si se mantiene fuera.

## Fuera a propósito

- No habrá un setter genérico de keys: dejaría pasar cualquier key y saltarse la whitelist, que hoy es la única barrera porque la RLS está abierta.
- No habrá borrado de filas: la app tampoco lo tiene, y "volver al default" se resuelve escribiendo el valor default.

## Preguntas abiertas

1. ¿Entra la configuración al MCP (+1 tool en un presupuesto lleno, 36/36) o sigue fuera como decidió ADR-037?
2. ¿`confirmar` obligatorio (propuesta) o escritura directa, si se considera que es reversible?
3. ¿La tool debe calcular el impacto antes de confirmar, como el popup ("N productos cambian de recomendación")? Para todas las órdenes abiertas habría que correr `buildPurchasePlan` orden por orden: caro, y lento con muchas órdenes.
4. ¿El % se recibe como fracción (como la BD y `get_app_settings`) o de 1 a 100 (como la UI)?
5. ¿Se restringe también la ruta (`requireAdmin`)? Hoy cualquier member cambia umbrales globales desde el planificador, y la RLS deja escribir cualquier key por PostgREST.
