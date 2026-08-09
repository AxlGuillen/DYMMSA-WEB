# ADR-022 — Módulo de corte de material (tubos y placas DYMMSA)

**Fecha:** 2026-07-31
**Estado:** Implementado (issue #59, Fases 1–5)
**Rama:** `feat/59-cut-module`

## Contexto

Los productos de marca **DYMMSA** se mandan a hacer: se compra tubo o placa de
cobre y se corta a la medida. Todo el cálculo era manual: hacer match de la
medida pedida con la que existe, sumar un margen de 1–2 cm por partición,
juntar piezas para saber cuánto material pedir, y en placas acomodar los cortes
para aprovechar el ancho.

Restricción clave: **no se conoce el catálogo del proveedor**. Se le pide, él
dice qué tiene ("tengo barras de 6 m") y el taller se adapta.

## Decisión

### El problema vive en dos momentos

1. **Necesidad neta** (sin proveedor): `Σ (longitud + margen) × cantidad` por
   diámetro; en placas, área total + **ancho mínimo** de tira (la pieza más
   ancha manda). Es la cifra para PEDIR — sobreestima ligera y a propósito.
2. **Acomodo** (con la presentación capturada): patrón de corte por barra
   (first-fit decreasing 1D) o por tira (filas/shelf), con sobrante visible.

Cada presentación capturada se guarda en `material_presentations` → **el
catálogo del proveedor se arma solo con el uso** (solo tubos: las tiras de
placa se venden por largo, sin presentación fija).

### Decisiones técnicas

| Decisión | Porqué |
|---|---|
| Medidas **estructuradas**, no parseo del texto | Las descripciones traen formatos mixtos (`30/300`, `25x300`); un error de parseo = material mal pedido |
| `cut_plan_pieces` **por orden**, no columnas del producto | Las longitudes pedidas varían por pedido; `etm_products.cut_*` solo PRE-llenan |
| Unidades **siempre en mm**, `numeric` | 1/2" = 12.7 mm rompería un integer |
| Coerción numeric→number **en la frontera del API** | supabase-js entrega `numeric` como string; la lib matemática solo ve numbers |
| **SVG 2D**, no 3D | Un corte prismático ES una barra segmentada / un rectángulo; el SVG se imprime para el taller |
| Modelo físico del margen: `[pieza][corte]…[sobrante]` | La última partición puede caer a ras (su margen no se exige al entrar); el sobrante descuenta un corte por segmento con clamp en 0 |
| Ajuste manual que **avisa, no bloquea** | El taller conoce restricciones que el algoritmo no; exceso en rojo con mm exactos. El layout manual se descarta por firma de entradas si cambian piezas/barra/margen |
| PUT **replace-all con restauración** | Sin llave natural para upsert → delete+insert; si el insert falla se reinsertan las filas previas |
| `requested_label` por pieza | Conserva el match "lo que pidió el cliente ↔ medida usada", que antes se perdía |
| Placas = **tira de ancho conocido** (strip/shelf), v1 sin rotación | Coincide con cómo se compra ("¿cuánto largo de esta tira?"); puede haber veta/acabado que respetar |
| Margen configurable `cut_margin_mm` (default 20, **0 válido**) | En `app_settings` con whitelist, como los umbrales de compra |

### Lo que quedó fuera (a posta)

- **Rotación de piezas** en placas y **retazos reutilizables**: mejoras futuras
  con modelo de datos propio.
- **Lote multi-orden**: las tablas nacen con `order_id`; agregarse en lote sería
  una vista de agregación, no un refactor.
- **Persistir el layout manual**: se recalcula al recargar (v1).
- **Costo del material**: solo cantidades.

## Consecuencias

- Entrada: botón "Planificar corte" en `OrderDetail` (solo si hay ítems DYMMSA)
  y desde la card de compra local del planificador.
- La lógica vive en `src/lib/cut-plan.ts` (funciones puras, 21 tests) — NO en
  `business-rules.ts`, igual que `purchase-plan.ts`.
- Excel "pedido de material" con la necesidad neta por medida; la página es
  imprimible (`print:hidden` en controles).
