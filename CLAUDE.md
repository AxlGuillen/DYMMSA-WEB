# DYMMSA - Sistema de Cotizaciones y Gestión de Inventario

## 📋 DESCRIPCIÓN DEL PROYECTO

Aplicación web integral para automatizar el proceso completo de cotizaciones de DYMMSA, un distribuidor de herramientas URREA en Morelia, México. 

El sistema maneja desde la solicitud inicial del cliente hasta la entrega final, incluyendo gestión de inventario, pedidos a URREA, y seguimiento de Ordenes.

## 🎯 PROBLEMA QUE RESUELVE

### Situación Actual (Manual)

**Flujo Completo Real:**
1. Cliente envía Excel con códigos ETM
2. DYMMSA convierte ETM → URREA con macros manuales
3. Genera cotización y sube a Drive
4. Cliente marca productos aprobados en VERDE (toda la fila)
5. DYMMSA descarga Excel, revisa stock tienda manualmente
6. Genera pedido a URREA manualmente (solo faltantes)
7. URREA envía productos (algunos no surtidos)
8. DYMMSA confirma recepción manualmente
9. Genera cotización final solo con productos disponibles
10. Actualiza inventario manualmente

**Problemas:**
- Múltiples pasos manuales propensos a error
- No hay sistema de inventario integrado
- No hay tracking de Ordenes
- Base de datos ETM-URREA desactualizada (~384 de miles)
- Proceso lento (días)

### Solución Propuesta

Sistema automatizado que:
- ✅ Convierte ETM → URREA automáticamente
- ✅ Gestiona inventario tienda DYMMSA (código URREA + cantidad)
- ✅ Cotizador con tabla editable (pre-rellena desde BD, editable manualmente)
- ✅ Cotizaciones con link de aprobación por token (semi-privado)
- ✅ Aprobación parcial por ítem desde página pública
- ✅ Genera pedidos a URREA automáticamente desde orden
- ✅ Tracking de Ordenes con estados
- ✅ Actualiza inventario automáticamente
- ✅ Auto-aprende: crece y actualiza BD al guardar cotización

## 👤 CONTEXTO DEL DESARROLLADOR

- Frontend developer con experiencia en React/TypeScript
- Primer proyecto profesional con Next.js + Supabase
- Usa **Context7** para compartir contexto del proyecto con Claude
- Prefiere arquitecturas modernas, mantenibles y escalables
- **Convención:** TODO en inglés (código, BD, variables) para consistencia

## 🛠️ STACK TECNOLÓGICO

### Frontend
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **State Management:** Zustand
- **Data Fetching:** TanStack Query (React Query)

### Backend & Database
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (@supabase/ssr)
- **API:** Next.js API Routes (Route Handlers)

### Tools & Libraries
- **Package Manager:** Bun
- **Excel Processing:** SheetJS (xlsx) + ExcelJS
- **Version Control:** GitHub
- **Deployment:** Vercel

## 🏗️ ARQUITECTURA DE DATOS

### Tablas Implementadas

**1. etm_products** (Catálogo ETM → URREA)
```sql
id UUID, etm TEXT (unique), description TEXT, description_es TEXT,
model_code TEXT, price DECIMAL, brand TEXT,
created_at, updated_at, created_by UUID
```

**2. store_inventory** (Stock tienda - SIMPLE)
```sql
id UUID, model_code TEXT (unique), quantity INTEGER,
updated_at TIMESTAMPTZ
```

**3. quotations** (Cotizaciones — NUEVA)
```sql
id UUID, customer_name TEXT, status TEXT,
approval_token UUID (unique),
total_amount DECIMAL, notes TEXT,
original_file_url TEXT,
created_at, updated_at, created_by UUID
```

**Estados de cotización:**
- `draft` (editando en cotizador)
- `sent_for_approval` (link enviado al aprobador)
- `approved` (al menos un ítem aprobado)
- `rejected` (todos rechazados)
- `converted_to_order` (orden generada)

**4. quotation_items** (Productos por cotización — NUEVA)
```sql
id UUID, quotation_id UUID (FK),
etm TEXT, description TEXT, description_es TEXT,
model_code TEXT, brand TEXT,
unit_price DECIMAL, quantity INTEGER,
is_approved BOOLEAN (null=pendiente, true=aprobado, false=rechazado),
notes TEXT,
created_at TIMESTAMPTZ
```

**5. orders** (Ordenes de venta)
```sql
id UUID, quotation_id UUID (FK → quotations),
customer_name TEXT, status TEXT, total_amount DECIMAL,
urrea_order_file_url TEXT, notes TEXT,
created_at, updated_at, created_by UUID
```

**Estados de orden:**
- `pending_urrea_order` (inicial - esperando envío a URREA)
- `received_from_urrea` (productos recibidos)
- `pending_payment` (esperando pago cliente)
- `paid` (cliente pagó)
- `completed` (entrega completa)
- `cancelled` (orden cancelada)

**6. order_items** (Productos por orden)
```sql
id UUID, order_id UUID (FK),
etm TEXT, model_code TEXT, description TEXT, brand TEXT,
quantity_approved INTEGER, quantity_in_stock INTEGER,
quantity_to_order INTEGER, quantity_received INTEGER,
urrea_status TEXT, unit_price DECIMAL,
created_at TIMESTAMPTZ
```

**Estados URREA:** `pending`, `supplied`, `not_supplied`

**Constraint:** `quantity_in_stock + quantity_to_order = quantity_approved`

## 🔄 FLUJO COMPLETO DEL SISTEMA

### Flujo Automatizado Definitivo
```
1. COTIZADOR: Usuario sube Excel cliente (multi-hoja)
   - Sistema extrae ETMs y cualquier columna disponible
     (description, description_es, model_code, brand, price, quantity)
   - Solo ETM es obligatorio en el Excel
   ↓
2. TABLA EDITABLE (estado gestionado con Zustand + localStorage)
   - Pre-rellena columnas encontradas en el Excel
   - Contrasta con etm_products por ETM → completa datos faltantes
   - Todos los campos son editables excepto ETM
   - quantity puede venir del Excel o ingresarse manualmente
   - Se pueden agregar filas nuevas manualmente
   - Modal por producto para edición ordenada (v1)
   ↓
3. GUARDAR COTIZACIÓN ("Save Quotation")
   - AUTO-APRENDIZAJE en etm_products:
     * ETM nuevo → INSERT con todos los datos del ítem
     * ETM existente con datos cambiados → UPDATE (precio, marca, descripción)
   - Crea registro en `quotations` (status: draft)
   - Crea `quotation_items` con is_approved = null
   ↓
4. ENVIAR A APROBACIÓN
   - Genera approval_token UUID único
   - Status quotation → sent_for_approval
   - Link: /approve/[approval_token]  (semi-privado, sin login)
   ↓
5. PÁGINA DE APROBACIÓN (acceso por token en URL)
   - Preview de la cotización para el aprobador externo
   - Aprobador marca cada ítem: aprobar ✅ o rechazar ❌
   - Puede aprobar todos, algunos o ninguno (aprobación parcial)
   - Submit → quotation_items.is_approved se actualiza
   - Status quotation → approved / rejected
   ↓
6. DYMMSA ve cotización aprobada en su dashboard
   - Visualiza ítems aprobados vs rechazados
   - Genera orden desde cotización
   ↓
7. CREAR ORDEN desde cotización aprobada
   - Solo quotation_items con is_approved = true
   - Verifica stock DYMMSA por model_code:
     * Stock completo → quantity_to_order = 0
     * Stock parcial → apartar disponible, pedir faltante
     * Sin stock → quantity_to_order = quantity_approved
   - RESTAR inventario inmediatamente
   - Status quotation → converted_to_order
   - Crea orden con quotation_id FK (status: pending_urrea_order)
   ↓
8. GENERAR Excel formato URREA (.xlsm)
   - Solo order_items con quantity_to_order > 0 Y brand = URREA
   - Productos de otras marcas se excluyen (notificación al usuario)
   - Columnas: model_code | quantity
   - Descargar automáticamente
   ↓
9. Usuario envía Excel a URREA (WhatsApp - fuera del sistema)
   ↓
10. URREA envía productos (días después)
    ↓
11. Usuario accede a Order Detail Page
    - Edita manualmente: quantity_received y urrea_status por ítem
    - Confirma recepción
    ↓
12. SISTEMA actualiza inventario
    - SUMAR quantity_received al store_inventory
    ↓
13. Gestión estados orden
    - pending_urrea_order → received_from_urrea → pending_payment → paid → completed
    ↓
14. Orden completada ✅
```

## 📐 FASES DE DESARROLLO

### ✅ Fase 0: Setup Inicial - COMPLETADA
Proyecto Next.js 16, dependencias, shadcn/ui, estructura base.

### ✅ Fase 1: Autenticación - COMPLETADA
Supabase Auth, login, protección de rutas.

### ✅ Fase 2: Catálogo Productos - COMPLETADA
Tabla etm_products, CRUD completo, importación masiva desde Excel.

### ✅ Fase 3: Cotizador Básico - COMPLETADA
Subir Excel, detectar ETM multi-hoja, generar cotización descargable.

### ✅ Fase 4: Inventario Tienda - COMPLETADA
Tabla store_inventory, CRUD, importación Excel (model_code + quantity).

### ✅ Fase 5.5: Flexibilidad en Cotizaciones y Órdenes - COMPLETADA

**Objetivo:** Permitir edición post-aprobación para adaptarse al flujo informal de DYMMSA.

#### Cotizaciones aprobadas editables ✅
- `PATCH /api/quotations/[id]/update` acepta `status = 'approved'` además de `draft`
- Ítems existentes preservan su `is_approved` original al re-insertar
- Ítems nuevos agregados por DYMMSA entran con `is_approved = true` (aprobación interna)
- `QuotationDetail`: `canEdit = isDraft || isApproved` controla todos los controles de edición
- Botón "Agregar" y editar/eliminar por fila disponibles en cotizaciones aprobadas
- "Enviar a aprobación" solo aparece en `draft`

#### Ítems de orden editables ✅
- `POST /api/orders/[id]/items` — agrega producto con check de stock y deducción de inventario
- `PATCH /api/orders/[id]/items/[itemId]` — edita `unit_price`, recalcula `total_amount`
- `DELETE /api/orders/[id]/items/[itemId]` — elimina ítem y restaura `quantity_in_stock` al inventario
- `OrderDetail`: botón "Agregar" con dialog, edición de precio inline por fila, eliminación con confirmación
- Solo disponible cuando orden no está `completed` ni `cancelled`

**Nuevas rutas:**
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/orders/[id]/items` | ✅ | Agregar ítem a orden (stock check + inventario) |
| PATCH | `/api/orders/[id]/items/[itemId]` | ✅ | Editar precio de ítem |
| DELETE | `/api/orders/[id]/items/[itemId]` | ✅ | Eliminar ítem + restaurar inventario |

**Nuevos hooks:**
- `useAddOrderItem` — POST agregar ítem
- `useEditOrderItem` — PATCH editar precio
- `useRemoveOrderItem` — DELETE eliminar ítem

### ✅ Fase 5: Cotizador, Aprobación y Sistema de Ordenes - COMPLETADA

**Objetivo:** Implementar flujo completo: cotizador con tabla editable → aprobación por link → orden automática.

#### 5A: Cotizador (tabla editable) ✅
1. ✅ Subir Excel cliente multi-hoja → extraer ETMs y columnas disponibles (`FileUploader` + `extractProductRowsFromExcel`)
2. ✅ Tabla editable pre-rellena con datos del Excel + BD (`QuotationEditor` + lookup `/api/quotes/lookup`)
3. ✅ Modal por producto para edición ordenada (`ProductModal` con modos create/edit)
4. ✅ Zustand store + localStorage para persistir estado draft (`quotationStore.ts`, key: `dymmsa-quotation-draft`)
5. ✅ Agregar filas manualmente (botón en `QuotationEditor` abre `ProductModal` en modo create)
6. ✅ Guardar cotización en BD (`POST /api/quotations/save` → crea `quotations` + `quotation_items`)
7. ✅ Auto-aprendizaje al guardar: ETM nuevo → INSERT, existente con cambios → UPDATE en `etm_products`

#### 5B: Aprobación por link ✅
8. ✅ Generar approval_token UUID y link semi-privado (`POST /api/quotations/[id]/send-for-approval`)
9. ✅ Página pública `/approve/[token]` — server component + `ApprovalClient` (sin auth)
10. ✅ Aprobación parcial: cada ítem tiene botón ✅/❌/? independiente; botón "Aprobar todo"
11. ✅ Submit → actualiza `quotation_items.is_approved` + status quotation (`approved`/`rejected`)
12. ✅ Banner informativo si la cotización ya fue procesada (no permite re-aprobar)

#### 5C: Orden desde cotización ✅
13. ✅ Dashboard cotizaciones con filtros por estado y búsqueda (`/dashboard/quotations`)
14. ✅ `QuotationDetail` — vista completa con stats, edición draft, envío a aprobación, creación de orden
15. ✅ Generar orden desde cotización aprobada (`POST /api/quotations/[id]/create-order`)
    - Solo `quotation_items` con `is_approved = true`
    - Verifica stock en `store_inventory` por `model_code`
    - Crea `order_items` con desglose: `quantity_in_stock` + `quantity_to_order`
    - Resta inventario inmediatamente; status quotation → `converted_to_order`
16. ✅ Generar Excel URREA (`.xlsx`) descargable desde `OrderDetail`
    - Solo ítems con `quantity_to_order > 0` Y `brand = URREA`
    - Notificación al usuario sobre productos de otras marcas excluidos
17. ✅ `OrderDetail` — edición manual de `quantity_received` y `urrea_status` por ítem
18. ✅ Confirmar recepción → suma `quantity_received` a `store_inventory` (`POST /api/orders/[id]/confirm-reception`)
19. ✅ Gestión de estados de orden via dropdown (5 transiciones posibles)
20. ✅ Cancelar orden → restaura inventario (`POST /api/orders/[id]/cancel`)

**Rutas implementadas:**
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/api/quotations/save` | ✅ | Crear cotización + auto-learn |
| POST | `/api/quotations/[id]/send-for-approval` | ✅ | Generar token + cambiar status |
| PATCH | `/api/quotations/[id]/update` | ✅ | Editar cotización draft |
| POST | `/api/quotations/[id]/create-order` | ✅ | Generar orden desde cotización aprobada |
| GET | `/api/approve/[token]` | ❌ público | Obtener cotización por token |
| POST | `/api/approve/[token]` | ❌ público | Enviar decisiones de aprobación |
| POST | `/api/orders/[id]/confirm-reception` | ✅ | Confirmar recepción + actualizar inventario |
| POST | `/api/orders/[id]/cancel` | ✅ | Cancelar orden + restaurar inventario |

**Excel de entrada (cliente):**
- Solo ETM es obligatorio; demás columnas opcionales
- Columnas reconocidas: `ETM`, `description`, `description_es`, `model_code`, `quantity`, `price`, `brand`
- Multi-hoja permitido, columna ETM detectada case-insensitive
- Ignorar columnas de imágenes

### 🔄 Fase 6: Mejoras y Optimización (ACTUAL)
Reportes, estadísticas, notificaciones, optimizaciones, historial de cambios en cotizaciones/órdenes.

## 🔧 CONSIDERACIONES TÉCNICAS

### Excel Processing
- Detectar columna "ETM" (case insensitive) en múltiples hojas
- Extraer todas las columnas reconocidas: ETM, description, description_es, model_code, quantity, price, brand
- Solo ETM es obligatorio; columnas faltantes quedan vacías para edición manual
- Ignorar columnas de imágenes
- Formato URREA output: solo model_code + quantity, brand = URREA y quantity_to_order > 0
- Formato URREA inventario import: skiprows=13

### Cotizador / Estado
- Zustand store maneja el estado de la cotización en curso (draft)
- Persistir en localStorage como respaldo ante recargas
- Limpiar localStorage al guardar cotización exitosamente en BD

### Aprobación por Token
- approval_token: UUID v4 generado en el servidor al enviar a aprobación
- Ruta pública: `/approve/[token]` — accesible sin autenticación
- La página valida el token contra BD; si no existe → 404
- quotation con status !== `sent_for_approval` → mostrar estado actual (ya aprobada, etc.)

### Seguridad
- RLS en todas las tablas
- Validación server-side
- Middleware en rutas protegidas

### Performance
- Cache con TanStack Query
- Paginación en tablas grandes
- Procesamiento Excel en memoria

### UX/UI
- Loading states en operaciones
- Mensajes de error claros
- Diseño responsive

## 📝 VARIABLES DE ENTORNO
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## 🎯 CRITERIOS DE ÉXITO (MVP COMPLETO)

- ✅ Login funcional
- ✅ CRUD completo de productos
- ✅ CRUD completo de inventario
- ✅ Cotizador: subir Excel → tabla editable pre-rellena
- ✅ Tabla editable: modal por producto, agregar filas manualmente
- ✅ Guardar cotización en BD + auto-aprendizaje etm_products
- ✅ Link de aprobación por token (página pública `/approve/[token]`)
- ✅ Aprobación parcial por ítem desde página de aprobación
- ✅ Generar orden desde cotización aprobada
- ✅ Verificación stock y desglose order_items
- ✅ Generación Excel URREA (faltantes brand=URREA)
- ✅ Order Detail Page con edición manual
- ✅ Confirmación recepción → actualizar inventario
- ✅ Gestión de estados orden y cotización
- ✅ Función cancelar orden

## 📚 RECURSOS DE REFERENCIA

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [shadcn/ui Components](https://ui.shadcn.com)
- [SheetJS Documentation](https://docs.sheetjs.com)
- [ExcelJS Documentation](https://github.com/exceljs/exceljs)
- [TanStack Query](https://tanstack.com/query/latest)

## 🔄 NOTAS PARA CLAUDE

- Este proyecto usa **Context7** para compartir contexto
- El desarrollador indicará manualmente la fase actual
- Priorizar código limpio y TypeScript estricto
- TODO en inglés (código, BD, variables)
- Sistema crece iterativamente: empezar simple, agregar complejidad

---

**Última actualización:** 2026-03-06
**Fase actual:** Fase 6 - Mejoras y Optimización
**Stack:** Next.js 16 + TypeScript + Supabase + shadcn/ui
```

---