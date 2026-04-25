# ADR-002: Productos sin ETM → Código DYMMSA-{n}

> **Implementado en:** [[03-Modulos/Cotizador#Parseo de Excel]] (parser), [[03-Modulos/Catalogo-ETM#Código DYMMSA-{n}]] (ruta next-dymmsa-code)  
> **Tabla afectada:** [[02-Arquitectura/Base-de-Datos#etm_products|etm_products]]  
> **Fase:** [[05-Fases/Fase-6-Mejoras]]

**Fecha:** 2026-03-xx  
**Estado:** Implementado ✅

---

## Contexto

Algunos Excels de clientes contienen productos con el ETM en blanco o con el valor literal "new". Estos productos igualmente necesitan cotizarse, pero el sistema requiere un identificador en la columna `etm` para funcionar (es el identificador primario).

## Decisión

1. Durante el parseo (`extractProductRowsFromExcel`), cualquier ETM con valor `"new"` (cualquier casing) se reemplaza por `DYMMSA-TEMP-{n}` (contador local al parseo).

2. Existe `GET /api/products/next-dymmsa-code` que retorna el siguiente código `DYMMSA-{n}` disponible consultando la BD — evita colisiones con códigos ya asignados.

3. El usuario puede usar este código como ETM permanente en `ProductModal`.

4. En `QuotationEditor`, ítems con `model_code` vacío se resaltan en gris con una leyenda: "Producto sin código URREA".

## Reglas del auto-learn para DYMMSA codes

El auto-learn (`processAutoLearn`) **no asigna** `brand = 'URREA'` a productos sin `model_code`. Esto evita que productos de otras marcas o sin catálogo en URREA sean marcados incorrectamente como productos URREA.

## Alternativas consideradas

- **Bloquear productos sin ETM:** demasiado restrictivo. DYMMSA necesita cotizar todo lo que el cliente pide, incluso si no está en catálogo.
- **UUID aleatorio:** no legible por el usuario. `DYMMSA-{n}` es humanamente interpretable y fácil de buscar.
