# Flujo Operacional

> Implementación técnica paso a paso: [[03-Modulos/Cotizador|Cotizador]] → [[03-Modulos/Aprobacion-por-Token|Aprobación]] → [[03-Modulos/Ordenes|Órdenes]] → [[03-Modulos/Inventario|Inventario]]

## Flujo automatizado completo

```
CLIENTE                          DYMMSA (sistema)                    URREA
──────                           ────────────────                    ─────
Envía Excel con ETMs
                    → Cotizador: upload Excel
                      extrae ETMs + columnas disponibles
                      pre-rellena desde BD etm_products
                      tabla editable (Zustand + localStorage)
                      usuario ajusta precios/cantidades
                      
                    → Guardar Cotización
                      auto-learn etm_products
                      crea quotations (status: draft)
                      crea quotation_items (is_approved=null)
                      
                    → Enviar a Aprobación
                      genera approval_token UUID
                      status → sent_for_approval
                      comparte link /approve/[token]

Recibe link público
Aprueba/rechaza
cada ítem
                    → Sistema recibe decisiones
                      actualiza is_approved por ítem
                      status → approved / rejected

                    → DYMMSA revisa cotización aprobada
                      puede editar (Fase 5.5)
                      
                    → Crear Orden
                      solo ítems is_approved=true
                      stock check store_inventory por model_code
                      aparta stock disponible (quantity_in_stock)
                      calcula quantity_to_order = approved - in_stock
                      RESTA inventario inmediatamente
                      status quotation → converted_to_order
                      crea orders (status: ordered)
                      crea order_items con desglose

                    → Generar Excel URREA
                      solo ítems: brand=URREA AND quantity_to_order>0
                      columnas: model_code | quantity
                      se descarga automáticamente

                                              DYMMSA envía Excel
                                              por WhatsApp →

                                                              URREA procesa
                                                              Envía productos
                                                              (días después)
                    ← Productos llegan
                    
                    → Order Detail: edición manual
                      quantity_received y urrea_status por ítem
                      Confirmar recepción:
                      SUMA quantity_received a store_inventory
                      status → received

                    → Gestión estados:
                      received → delivered → completed
                      (o cancelled → restaura inventario)

Recibe productos
entregados
```

---

## Reglas de negocio clave

| Regla | Detalle | Ver |
|-------|---------|-----|
| Solo ETM es obligatorio en el Excel | Otras columnas se extraen si existen, se dejan vacías si no | [[03-Modulos/Cotizador#Parseo de Excel]] |
| Separadores no cuentan | `item_type='separator'` excluido de totales, auto-learn, aprobación, Excel URREA | [[04-Decisiones-Tecnicas/ADR-001-Separadores]] |
| Stock se aparta al crear orden | No al confirmar recepción — evita doble promesa al cliente | [[01-Negocio/Decisiones-de-Negocio#Por qué deducir inventario al crear la orden]] |
| Cancelar restaura inventario | `quantity_in_stock` vuelve al store al cancelar la orden | [[03-Modulos/Inventario#Movimientos automáticos de inventario]] |
| Auto-learn solo actualiza con datos no vacíos | No sobreescribe datos buenos con campos vacíos | [[03-Modulos/Catalogo-ETM#Auto-learn]] |
| brand=URREA requerido para Excel URREA | Productos de otras marcas se excluyen con notificación | [[03-Modulos/Ordenes#Generar Excel URREA]] |
| Comunicación URREA fuera del sistema | WhatsApp — el sistema solo genera el Excel | [[01-Negocio/Decisiones-de-Negocio#Por qué la comunicación con URREA sigue siendo por WhatsApp]] |
