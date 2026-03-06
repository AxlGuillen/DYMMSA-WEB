# DYMMSA - Sistema de Cotizaciones y Gestión de Inventario

Sistema web para automatizar el proceso completo de cotizaciones de DYMMSA, distribuidor de herramientas URREA en Morelia, México.

## Descripción

DYMMSA-WEB automatiza el flujo de trabajo desde la solicitud inicial del cliente hasta la entrega final:

- Cotizador con tabla editable: sube Excel del cliente → pre-rellena datos desde catálogo
- Aprobación por link con token (sin login requerido para el aprobador externo)
- Aprobación parcial por ítem: el cliente aprueba o rechaza producto por producto
- Generación automática de orden desde cotización aprobada
- Verificación de stock y desglose automático (en tienda vs a pedir a URREA)
- Generación de Excel de pedido a URREA (solo faltantes)
- Confirmación de recepción y actualización de inventario
- Auto-aprendizaje: la base de datos ETM→URREA crece con cada cotización guardada

## Stack Tecnológico

| Categoría | Tecnología |
|-----------|------------|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS |
| Componentes UI | shadcn/ui |
| Estado (draft) | Zustand + localStorage |
| Data Fetching | TanStack Query |
| Base de datos | Supabase (PostgreSQL) |
| Autenticación | Supabase Auth (@supabase/ssr) |
| Procesamiento Excel | SheetJS (xlsx) + ExcelJS |
| Package Manager | Bun |
| Deploy | Vercel |

## Características

### Catálogo ETM-URREA
- CRUD completo de productos (`etm_products`)
- Importación masiva desde Excel
- Auto-aprendizaje: al guardar una cotización, ETMs nuevos se insertan y los existentes se actualizan

### Cotizador
- Sube Excel del cliente (multi-hoja, solo ETM es obligatorio)
- Detecta columna `ETM` case-insensitive; extrae columnas opcionales: `description`, `description_es`, `model_code`, `quantity`, `price`, `brand`
- Tabla editable pre-rellena con datos del Excel + catálogo de BD
- Modal por producto para edición ordenada; agregar filas manualmente
- Estado persistido en Zustand + localStorage (sobrevive recargas)
- Al guardar: crea registro en `quotations` + `quotation_items` y ejecuta auto-aprendizaje

### Aprobación por Link
- Genera token UUID al enviar cotización a aprobación
- Link público `/approve/[token]` — sin login requerido
- Aprobador externo marca cada ítem: ✅ aprobado / ❌ rechazado (aprobación parcial)
- Botón "Aprobar todo" para facilitar el proceso
- Una vez enviada la aprobación, no se puede modificar (banner informativo)

### Sistema de Cotizaciones
- Dashboard con lista, filtros por estado y búsqueda
- Vista detalle con stats: ítems aprobados/rechazados/pendientes, total
- Edición de cotizaciones en estado `draft`
- Estados: `draft` → `sent_for_approval` → `approved` / `rejected` → `converted_to_order`

### Sistema de Órdenes
- Generación automática desde cotización aprobada (solo ítems aprobados)
- Verificación de stock por `model_code`:
  - Stock completo → `quantity_to_order = 0`
  - Stock parcial → aparta disponible, pide faltante a URREA
  - Sin stock → todo va a URREA
- Descuenta inventario en el momento de crear la orden
- Genera Excel de pedido URREA (`.xlsx`): solo `brand = URREA` y `quantity_to_order > 0`
- Order Detail Page: editar `quantity_received` y `urrea_status` por ítem
- Confirmar recepción → suma al inventario (`store_inventory`)
- Cancelar orden → restaura inventario
- Estados: `pending_urrea_order` → `received_from_urrea` → `pending_payment` → `paid` → `completed`

### Inventario
- Gestión de stock por código URREA (`store_inventory`)
- CRUD + importación desde Excel
- Actualización automática al crear órdenes y confirmar recepciones

## Flujo Completo

```
1. Usuario sube Excel del cliente (códigos ETM)
   ↓
2. Sistema pre-rellena tabla editable (Excel + catálogo BD)
   Usuario completa datos faltantes, ajusta cantidades
   ↓
3. Guardar cotización
   → Auto-aprendizaje en etm_products (INSERT / UPDATE)
   → Crea quotations (status: draft) + quotation_items
   ↓
4. Enviar a aprobación
   → Genera approval_token UUID
   → Link /approve/[token] se comparte con el cliente (WhatsApp, email, etc.)
   ↓
5. Cliente abre el link (sin login) y aprueba/rechaza cada ítem
   → quotation_items.is_approved actualizado
   → status: approved / rejected
   ↓
6. DYMMSA ve cotización aprobada en el dashboard
   → Genera orden desde la cotización
   ↓
7. Sistema crea la orden
   → Solo ítems aprobados
   → Verifica stock, descuenta inventario inmediatamente
   → Crea order_items con desglose stock/a-pedir
   → status quotation: converted_to_order
   ↓
8. Descargar Excel URREA (solo faltantes, solo brand=URREA)
   → Usuario envía a URREA por WhatsApp
   ↓
9. URREA envía productos (días después)
   ↓
10. Usuario edita quantity_received + urrea_status por ítem
    → Confirmar recepción → suma al store_inventory
    ↓
11. Gestión de estados hasta completar la orden ✅
```

## Estructura del Proyecto

```
src/
├── app/
│   ├── api/
│   │   ├── approve/[token]/        # GET + POST públicos (sin auth)
│   │   ├── inventory/              # Import inventario Excel
│   │   ├── orders/
│   │   │   ├── [id]/cancel/        # Cancelar orden + restaurar inventario
│   │   │   └── [id]/confirm-reception/  # Confirmar recepción + actualizar inventario
│   │   ├── products/               # Import catálogo Excel
│   │   ├── quotations/
│   │   │   ├── save/               # Crear cotización + auto-learn
│   │   │   └── [id]/
│   │   │       ├── send-for-approval/   # Generar token + cambiar status
│   │   │       ├── update/              # Editar cotización draft
│   │   │       └── create-order/        # Generar orden desde cotización aprobada
│   │   └── quotes/lookup/          # Lookup ETMs contra etm_products
│   ├── approve/[token]/            # Página pública de aprobación (sin auth)
│   ├── dashboard/
│   │   ├── db/                     # Catálogo ETM-URREA
│   │   ├── inventory/              # Gestión de inventario
│   │   ├── orders/                 # Lista + detalle de órdenes
│   │   │   └── [id]/
│   │   ├── quotations/             # Lista + detalle de cotizaciones
│   │   │   └── [id]/
│   │   └── quoter/                 # Cotizador (upload + tabla editable)
│   └── login/
├── components/
│   ├── layout/                     # Navbar, sidebar, layouts
│   ├── orders/                     # OrderDetail, OrdersTable, OrderStatusBadge
│   ├── products/                   # ProductsTable, ProductModal, etc.
│   ├── quotations/                 # QuotationDetail, QuotationsTable, QuotationStatusBadge
│   ├── quoter/                     # FileUploader, QuotationEditor, ProductModal
│   └── ui/                         # shadcn/ui components
├── hooks/
│   ├── useQuotations.ts            # useQuotations, useQuotation, useSaveQuotation,
│   │                               # useSendForApproval, useUpdateQuotation,
│   │                               # useCreateOrderFromQuotation
│   ├── useOrders.ts                # useOrders, useOrder, useUpdateOrderStatus,
│   │                               # useConfirmReception, useCancelOrder
│   └── useQuotes.ts                # useLookupEtms
├── lib/
│   ├── excel/                      # extractProductRowsFromExcel, generateUrreaOrderExcel
│   └── supabase/                   # client.ts, server.ts
├── stores/
│   └── quotationStore.ts           # Zustand + persist (draft cotización)
└── types/
    └── database.ts                 # Todos los tipos TypeScript del proyecto
```

## Base de Datos

**etm_products** — Catálogo ETM → URREA (auto-aprendizaje)
```sql
id, etm (unique), description, description_es, model_code, price, brand,
created_at, updated_at, created_by
```

**store_inventory** — Stock de tienda
```sql
id, model_code (unique), quantity, updated_at
```

**quotations** — Cotizaciones
```sql
id, customer_name, status, approval_token (unique), total_amount,
notes, original_file_url, created_at, updated_at, created_by
```
Estados: `draft` → `sent_for_approval` → `approved` / `rejected` → `converted_to_order`

**quotation_items** — Productos por cotización
```sql
id, quotation_id (FK), etm, description, description_es, model_code, brand,
unit_price, quantity, is_approved (null=pendiente | true | false), notes, created_at
```

**orders** — Órdenes de venta
```sql
id, quotation_id (FK → quotations), customer_name, status, total_amount,
urrea_order_file_url, notes, created_at, updated_at, created_by
```
Estados: `pending_urrea_order` → `received_from_urrea` → `pending_payment` → `paid` → `completed` / `cancelled`

**order_items** — Productos por orden
```sql
id, order_id (FK), etm, model_code, description, brand,
quantity_approved, quantity_in_stock, quantity_to_order, quantity_received,
urrea_status (pending | supplied | not_supplied), unit_price, created_at
```
Constraint: `quantity_in_stock + quantity_to_order = quantity_approved`

## Instalación

### Prerrequisitos
- Node.js 18+
- Bun
- Cuenta de Supabase

### Setup

1. Clonar el repositorio
```bash
git clone https://github.com/AxlGuillen/DYMMSA-WEB.git
cd DYMMSA-WEB
```

2. Instalar dependencias
```bash
bun install
```

3. Configurar variables de entorno
```bash
cp .env.example .env.local
```

Editar `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=tu_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_supabase_anon_key
```

4. Ejecutar en desarrollo
```bash
bun dev
```

5. Abrir [http://localhost:3000](http://localhost:3000)

## Scripts

```bash
bun dev      # Servidor de desarrollo
bun build    # Build de producción
bun start    # Iniciar producción
bun lint     # Ejecutar linter
```

## Deploy

El proyecto está configurado para deploy en Vercel:

```bash
vercel
```
