# Contexto DYMMSA

## ¿Quiénes son?

DYMMSA es un distribuidor autorizado de herramientas **URREA** ubicado en **Morelia, México**. Su modelo de negocio consiste en:

1. Recibir solicitudes de clientes (principalmente empresas) con listas de productos que necesitan.
2. Cotizar esos productos desde el catálogo URREA.
3. Verificar qué hay en su tienda física y qué hay que pedir a URREA.
4. Gestionar el pedido a URREA, la recepción y la entrega final al cliente.

---

## El problema original (flujo manual)

Antes del sistema, todo el proceso era manual:

1. Cliente envía un **Excel con códigos ETM** (códigos genéricos, no de URREA).
2. DYMMSA convierte ETM → model_code URREA usando **macros de Excel** manuales.
3. Genera una cotización y la sube a **Google Drive**.
4. El cliente descarga el Excel, marca los productos aprobados **coloreando la fila en verde**.
5. DYMMSA descarga el Excel, detecta filas verdes manualmente.
6. Revisa **stock de tienda manualmente**.
7. Genera un pedido a URREA (solo los faltantes) de forma manual.
8. URREA envía los productos (algunos no surtidos).
9. DYMMSA confirma recepción manualmente.
10. Genera cotización final solo con los disponibles.
11. Actualiza inventario manualmente.

### Problemas identificados

- Múltiples pasos manuales → alta probabilidad de error humano.
- No hay sistema de inventario integrado.
- No hay tracking de órdenes ni historial.
- Base de datos ETM→URREA desactualizada (~384 entradas antes del sistema).
- Proceso lento: puede tomar días.
- Comunicación con URREA solo por WhatsApp (sigue siendo así, fuera del sistema).

---

## La solución (este sistema)

Una aplicación web que automatiza el flujo completo:

- Convierte ETM → model_code automáticamente (BD creciente por auto-learn).
- Gestiona inventario de tienda DYMMSA.
- Cotizador con tabla editable, modal por producto.
- Aprobación parcial por ítems via link con token (sin que el cliente necesite login).
- Genera pedidos a URREA automáticamente en formato Excel.
- Tracking de órdenes con estados bien definidos.
- Actualiza inventario automáticamente al crear/cancelar/confirmar orden.
- Se auto-aprende: cada cotización guardada actualiza el catálogo ETM.

---

> Ver flujo completo: [[01-Negocio/Flujo-Operacional]] · Stack técnico: [[02-Arquitectura/Stack]]

## Contexto del desarrollador

- Frontend developer con experiencia en React/TypeScript.
- Primer proyecto profesional con Next.js + Supabase.
- Convención del proyecto: **todo en inglés** (código, BD, variables, API).
- Usa Claude Code + Context7 como asistentes de desarrollo.
