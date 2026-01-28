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
- ✅ Detecta productos aprobados (fila verde) automáticamente
- ✅ Genera pedidos a URREA automáticamente
- ✅ Tracking de Ordenes con estados
- ✅ Actualiza inventario automáticamente
- ✅ Auto-aprende: crece BD con cada cotización

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

**3. orders** (Ordenes de venta)
```sql
id UUID, customer_name TEXT, status TEXT, total_amount DECIMAL,
original_file_url TEXT, urrea_order_file_url TEXT, notes TEXT,
created_at, updated_at, created_by UUID
```

**Estados de orden:**
- `pending_urrea_order` (inicial - esperando envío a URREA)
- `received_from_urrea` (productos recibidos)
- `pending_payment` (esperando pago cliente)
- `paid` (cliente pagó)
- `completed` (entrega completa)
- `cancelled` (orden cancelada)

**4. order_items** (Productos por orden)
```sql
id UUID, order_id UUID (FK), 
etm TEXT, model_code TEXT, description TEXT,
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
1. Usuario sube Excel cliente (códigos ETM) → genera cotización
   ↓
2. Usuario sube Excel con filas VERDES (productos aprobados)
   - Formato unificado (instrucción al personal)
   - Puede tener múltiples hojas
   - Verde: toda la fila (rango claro → fuerte)
   ↓
3. SISTEMA detecta productos con fila verde
   - Extrae: ETM, description, description_es, model_code, quantity, price
   ↓
4. AUTO-APRENDIZAJE: Agregar nuevos ETM a etm_products
   - Solo productos completos (todos los campos excepto quantity)
   - Si ETM no existe → INSERT
   ↓
5. SISTEMA verifica stock DYMMSA (por model_code)
   - Stock completo → apartar todo, quantity_to_order = 0
   - Stock parcial → apartar disponible, pedir faltante
   - Sin stock → quantity_to_order = quantity_approved
   - RESTAR inventario inmediatamente
   ↓
6. CREAR ORDEN en BD (estado: pending_urrea_order)
   - Guardar Excel original
   - Crear order_items con cantidades desglosadas
   ↓
7. GENERAR Excel formato URREA (.xlsx)
   - Solo productos con quantity_to_order > 0
   - Columnas: model_code | quantity
   - Descargar automáticamente
   ↓
8. Usuario envía Excel a URREA (WhatsApp - fuera del sistema)
   ↓
9. URREA envía productos (días después)
   ↓
10. Usuario accede a Order Detail Page
    - Edita manualmente: quantity_received y urrea_status
    - Confirma recepción
    ↓
11. SISTEMA actualiza inventario automáticamente
    - SUMAR quantity_received de URREA
    ↓
12. Usuario cambia estado orden manualmente
    - pending_payment → paid → completed
    ↓
13. Orden completada ✅
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

### 🔄 Fase 5: Sistema de Ordenes y Auto-aprendizaje (ACTUAL)

**Objetivo:** Implementar flujo completo desde Excel aprobado hasta orden completada.

**Tareas principales:**
1. Subir Excel con filas verdes (multi-hoja)
2. Detectar productos aprobados (color verde en fila)
3. Auto-aprendizaje: agregar nuevos ETM a catálogo
4. Verificar stock y crear orden
5. Generar Excel URREA (solo faltantes)
6. Order Detail Page con edición manual
7. Confirmación recepción y actualización inventario
8. Gestión de estados de orden

**Formato Excel aprobado (unificado):**
- Columnas: `ETM`, `description`, `description_es`, `model_code`, `quantity`, `price`, `[image]`
- Productos aprobados: TODA LA FILA en verde
- Rango verde: #00FF00, #00B050, #92D050, #C6E0B4
- Ignorar columna de imágenes
- Múltiples hojas permitidas

### Fase 6: Mejoras y Optimización (FUTURO)
Reportes, estadísticas, notificaciones, optimizaciones.

## 🔧 CONSIDERACIONES TÉCNICAS

### Excel Processing
- Detectar columna "ETM" (case insensitive) en múltiples hojas
- Detectar filas con fondo verde (cualquier celda verde = fila aprobada)
- Rango de verdes: #00FF00, #00B050, #92D050, #C6E0B4, etc
- Ignorar columnas de imágenes
- Formato URREA: skiprows=13 para imports de inventario

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
- ✅ Cotizador básico funcional
- ✅ Detección automática productos aprobados (verde)
- ✅ Auto-aprendizaje catálogo
- ✅ Verificación stock y generación pedido URREA
- ✅ Sistema de Ordenes con estados
- ✅ Order Detail Page con edición manual
- ✅ Actualización automática inventario
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

**Última actualización:** 2026-01-26  
**Fase actual:** Fase 5 - Sistema de Ordenes y Auto-aprendizaje  
**Stack:** Next.js 16 + TypeScript + Supabase + shadcn/ui
```

---