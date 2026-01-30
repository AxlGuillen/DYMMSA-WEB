# DYMMSA - Sistema de Cotizaciones y Gestión de Inventario

Sistema web para automatizar el proceso completo de cotizaciones de DYMMSA, distribuidor de herramientas URREA en Morelia, México.

## Descripción

DYMMSA-WEB automatiza el flujo de trabajo desde la solicitud inicial del cliente hasta la entrega final, incluyendo:

- Conversión automática de códigos ETM a códigos URREA
- Gestión de inventario de tienda
- Detección automática de productos aprobados en Excel (filas verdes)
- Generación de pedidos a URREA
- Tracking de órdenes con múltiples estados
- Auto-aprendizaje: la base de datos crece con cada cotización

## Stack Tecnológico

| Categoría | Tecnología |
|-----------|------------|
| Framework | Next.js 16 (App Router) |
| Lenguaje | TypeScript |
| Estilos | Tailwind CSS |
| Componentes UI | shadcn/ui |
| Estado | Zustand |
| Data Fetching | TanStack Query |
| Base de datos | Supabase (PostgreSQL) |
| Autenticación | Supabase Auth |
| Procesamiento Excel | SheetJS + ExcelJS |
| Package Manager | Bun |

## Características Principales

### Catálogo ETM-URREA
- CRUD completo de productos
- Importación masiva desde Excel
- Conversión automática ETM → URREA

### Cotizador
- Subir Excel del cliente con códigos ETM
- Detección multi-hoja
- Generación de cotización descargable

### Inventario
- Gestión de stock por código URREA
- Importación desde Excel
- Actualización automática al recibir productos

### Sistema de Órdenes
- Detección de productos aprobados (filas verdes en Excel)
- Verificación automática de stock
- Generación de pedido URREA (solo productos faltantes)
- Estados: `pending_urrea_order` → `received_from_urrea` → `pending_payment` → `paid` → `completed`
- Edición de recepción múltiple (envíos parciales)
- Cancelación de órdenes con devolución de inventario

## Estructura del Proyecto

```
src/
├── app/
│   ├── api/                    # API Routes
│   │   └── orders/             # Endpoints de órdenes
│   ├── dashboard/              # Páginas protegidas
│   │   ├── db/                 # Catálogo ETM-URREA
│   │   ├── inventory/          # Gestión de inventario
│   │   ├── orders/             # Sistema de órdenes
│   │   └── quoter/             # Cotizador
│   └── login/                  # Autenticación
├── components/
│   ├── layout/                 # Navbar, layouts
│   ├── orders/                 # Componentes de órdenes
│   ├── products/               # Componentes de productos
│   └── ui/                     # shadcn/ui components
├── hooks/                      # Custom hooks (useAuth, useOrders, etc.)
├── lib/
│   ├── excel/                  # Procesamiento de Excel
│   └── supabase/               # Cliente Supabase
└── types/                      # TypeScript types
```

## Base de Datos

### Tablas

**etm_products** - Catálogo de conversión ETM → URREA
```sql
id, etm (unique), description, description_es, model_code, price, brand, created_at, updated_at, created_by
```

**store_inventory** - Stock de tienda
```sql
id, model_code (unique), quantity, updated_at
```

**orders** - Órdenes de venta
```sql
id, customer_name, status, total_amount, original_file_url, urrea_order_file_url, notes, created_at, updated_at, created_by
```

**order_items** - Productos por orden
```sql
id, order_id, etm, model_code, description, quantity_approved, quantity_in_stock, quantity_to_order, quantity_received, urrea_status, unit_price, created_at
```

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
bun dev          # Servidor de desarrollo
bun build        # Build de producción
bun start        # Iniciar producción
bun lint         # Ejecutar linter
```

## Flujo de Trabajo

```
1. Cliente envía Excel con códigos ETM
   ↓
2. Sistema genera cotización (conversión ETM → URREA)
   ↓
3. Cliente marca productos aprobados en VERDE
   ↓
4. Usuario sube Excel con filas verdes
   ↓
5. Sistema detecta productos aprobados automáticamente
   ↓
6. Auto-aprendizaje: nuevos ETM se agregan al catálogo
   ↓
7. Sistema verifica stock y crea orden
   ↓
8. Genera Excel de pedido URREA (solo faltantes)
   ↓
9. Usuario envía pedido a URREA
   ↓
10. URREA envía productos
    ↓
11. Usuario confirma recepción (edita cantidades)
    ↓
12. Sistema actualiza inventario
    ↓
13. Usuario gestiona estados hasta completar
```
 
## Deploy

El proyecto está configurado para deploy en Vercel:

```bash
vercel
```
