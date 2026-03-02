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

### 🔄 Fase 5: Cotizador, Aprobación y Sistema de Ordenes (ACTUAL)

**Objetivo:** Implementar flujo completo: cotizador con tabla editable → aprobación por link → orden automática.

#### 5A: Cotizador (tabla editable)
1. Subir Excel cliente multi-hoja → extraer ETMs y columnas disponibles
2. Tabla editable pre-rellena con datos del Excel + BD (etm_products)
3. Modal por producto para edición ordenada
4. Zustand store + localStorage para persistir estado draft
5. Agregar filas manualmente
6. Guardar cotización en BD (quotations + quotation_items)
7. Auto-aprendizaje al guardar: INSERT/UPDATE en etm_products

#### 5B: Aprobación por link
8. Generar approval_token y link semi-privado `/approve/[token]`
9. Página de aprobación: preview cotización + aprobar/rechazar por ítem
10. Actualizar is_approved en quotation_items + estado quotation

#### 5C: Orden desde cotización
11. Dashboard cotizaciones con estados
12. Generar orden desde cotización aprobada (solo ítems aprobados)
13. Verificar stock, crear order + order_items, restar inventario
14. Generar Excel URREA (.xlsm) con faltantes brand=URREA
15. Order Detail Page: editar quantity_received y urrea_status
16. Confirmar recepción → sumar al store_inventory
17. Gestión de estados de orden

**Excel de entrada (cliente):**
- Solo ETM es obligatorio; demás columnas opcionales
- Columnas reconocidas: `ETM`, `description`, `description_es`, `model_code`, `quantity`, `price`, `brand`
- Multi-hoja permitido, columna ETM detectada case-insensitive
- Ignorar columnas de imágenes

### Fase 6: Mejoras y Optimización (FUTURO)
Reportes, estadísticas, notificaciones, optimizaciones.

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
- ⬜ Cotizador: subir Excel → tabla editable pre-rellena
- ⬜ Tabla editable: modal por producto, agregar filas manualmente
- ⬜ Guardar cotización en BD + auto-aprendizaje etm_products
- ⬜ Link de aprobación por token (página pública `/approve/[token]`)
- ⬜ Aprobación parcial por ítem desde página de aprobación
- ⬜ Generar orden desde cotización aprobada
- ⬜ Verificación stock y desglose order_items
- ⬜ Generación Excel URREA (faltantes brand=URREA)
- ⬜ Order Detail Page con edición manual
- ⬜ Confirmación recepción → actualizar inventario
- ⬜ Gestión de estados orden y cotización
- ⬜ Función cancelar orden

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

**Última actualización:** 2026-02-27
**Fase actual:** Fase 5 - Cotizador, Aprobación por Link y Sistema de Ordenes
**Stack:** Next.js 16 + TypeScript + Supabase + shadcn/ui
```

---