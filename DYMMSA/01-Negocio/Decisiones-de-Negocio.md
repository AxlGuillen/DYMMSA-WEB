# Decisiones de Negocio

> Ver también el flujo completo: [[01-Negocio/Flujo-Operacional]] · Decisiones técnicas detalladas: [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]], [[04-Decisiones-Tecnicas/ADR-001-Separadores]], [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]]

## Por qué aprobación parcial (no todo-o-nada)

Los clientes de DYMMSA frecuentemente aprueban solo parte de una cotización. El flujo con Google Drive ya soportaba esto (marcar filas en verde individualmente). El sistema replica esa granularidad: cada ítem tiene su propio estado `is_approved` (null=pendiente, true=aprobado, false=rechazado).

→ Implementación: [[03-Modulos/Aprobacion-por-Token#Aprobación parcial]]

---

## Por qué token público sin login para el cliente

Los clientes son empresas externas. Pedirles que creen una cuenta en el sistema de DYMMSA genera fricción innecesaria. La aprobación es un acto puntual: reciben el link, aprueban, listo. El token UUID es suficientemente opaco para funcionar como semáforo semi-privado.

→ Implementación: [[03-Modulos/Aprobacion-por-Token#Seguridad y acceso]]

---

## Por qué deducir inventario al crear la orden (no al confirmar recepción)

Si se esperara a confirmar recepción para restar inventario, el mismo stock podría prometerse a dos órdenes distintas. Al apartar inmediatamente al crear la orden, se garantiza que lo que se dice disponible realmente lo está.

→ Implementación: [[03-Modulos/Inventario#Movimientos automáticos de inventario]] · [[03-Modulos/Ordenes#Crear orden desde cotización]]

---

## Por qué la comunicación con URREA sigue siendo por WhatsApp

URREA no tiene API pública ni portal de pedidos automatizable accesible para distribuidores pequeños. El sistema genera el Excel en el formato que URREA acepta; el envío humano por WhatsApp es inevitable en el contexto actual.

→ Implementación: [[03-Modulos/Ordenes#Generar Excel URREA]]

---

## Por qué cotizaciones aprobadas son editables (Fase 5.5)

DYMMSA opera de forma informal: a veces el cliente aprueba verbalmente productos fuera de la cotización, o DYMMSA necesita ajustar precios post-aprobación. Restringir la edición solo a `draft` no reflejaba la realidad operacional. La solución: `canEdit = isDraft || isApproved`; ítems nuevos agregados por DYMMSA entran con `is_approved=true` (aprobación interna).

→ ADR completo: [[04-Decisiones-Tecnicas/ADR-004-Aprobacion-Flexible]] · Implementación: [[05-Fases/Fase-5.5-Flexibilidad]]

---

## Por qué ETM es el identificador primario (no model_code)

Los clientes de DYMMSA hablan en ETM, no en model_code URREA. El catálogo ETM→URREA es el puente. Además, hay productos sin model_code (otras marcas, productos personalizados) que igualmente necesitan cotizarse.

→ Ver: [[03-Modulos/Catalogo-ETM]] · [[04-Decisiones-Tecnicas/ADR-002-DYMMSA-codes]]

---

## Por qué el auto-learn solo actualiza campos no vacíos

Si el usuario deja un campo vacío en la tabla editable, no significa que el campo en BD deba borrarse — simplemente no tienen el dato a mano. Solo se sobreescribe cuando el nuevo valor es explícito y diferente al existente. Esto protege datos buenos de ser reemplazados por vacíos accidentales.

→ Implementación: [[03-Modulos/Catalogo-ETM#Auto-learn (automático al guardar cotización)]]
