# DYMMSA - Sistema de Cotizaciones y Gestión de Inventario

## 📋 DESCRIPCIÓN DEL PROYECTO

Aplicación web integral para automatizar el proceso completo de cotizaciones de DYMMSA, un distribuidor de herramientas URREA en Morelia, México. 

El sistema maneja desde la solicitud inicial del cliente hasta la entrega final, incluyendo gestión de inventario, pedidos a URREA, y seguimiento de órdenes.

## 🎯 PROBLEMA QUE RESUELVE

### Situación Actual (Manual)

**Flujo Completo Real:**
1. Cliente envía Excel con códigos ETM
2. DYMMSA convierte ETM → URREA con macros manuales
3. Genera cotización y sube a Drive
4. Cliente marca productos aprobados en VERDE
5. DYMMSA descarga Excel, revisa stock tienda manualmente
6. Genera pedido a URREA manualmente (solo faltantes)
7. URREA envía productos (algunos no surtidos)
8. DYMMSA confirma recepción manualmente
9. Genera cotización final solo con productos disponibles
10. Actualiza inventario manualmente

**Problemas:**
- Múltiples pasos manuales propensos a error
- No hay sistema de inventario integrado
- No hay tracking de órdenes
- Base de datos ETM-URREA desactualizada (~384 de miles)
- Proceso lento (días)

### Solución Propuesta

Sistema automatizado que:
- ✅ Convierte ETM → URREA automáticamente
- ✅ Gestiona inventario de tienda DYMMSA
- ✅ Detecta productos aprobados (verde) automáticamente
- ✅ Genera pedidos a URREA automáticamente
- ✅ Tracking de órdenes con estados
- ✅ Actualiza inventario automáticamente
- ✅ Auto-aprende: crece BD con cada cotización

## 👤 CONTEXTO DEL DESARROLLADOR

- Frontend developer con experiencia en React/TypeScript
- Primer proyecto profesional con Next.js + Supabase
- Usa **Context7** para compartir contexto del proyecto con Claude
- Prefiere arquitecturas modernas, mantenibles y escalables

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

### Tablas del Sistema

**1. etm_products** (Catálogo ETM → URREA)
```sql
id, etm (PK), description, descripcion, modelo, precio, marca,
created_at, updated_at, created_by
```

**2. inventario_dymmsa** (Stock tienda)
```sql
id (PK), producto_id (FK), cantidad_disponible, cantidad_minima,
ubicacion, updated_at
```

**3. ordenes** (Órdenes de venta)
```sql
id (PK), cliente_nombre, estado, total, archivo_original,
archivo_aprobado, created_at, updated_at, created_by
```

**4. orden_items** (Productos por orden)
```sql
id (PK), orden_id (FK), producto_id (FK), cantidad_solicitada,
en_stock_dymmsa, cantidad_pedir_urrea, estado_urrea, precio
```

**5. recepciones_urrea** (Recepciones de URREA)
```sql
id (PK), orden_id (FK), productos_recibidos, productos_no_surtidos,
fecha_recepcion, confirmado_por
```

### Estados de Orden
```
cotizacion_generada → aprobada_cliente → pedido_urrea → 
recibiendo_urrea → completada / cancelada
```

## 🔄 FLUJO COMPLETO DEL SISTEMA

### Flujo Automatizado
```
1. Cliente envía Excel con códigos ETM
   ↓
2. Usuario sube Excel → SISTEMA genera cotización (consulta etm_products)
   ↓
3. Usuario sube cotización a Drive + envía email al cliente
   ↓
4. Cliente marca productos aprobados en VERDE
   ↓
5. Usuario sube Excel con marcas verdes
   ↓
6. SISTEMA detecta automáticamente productos verdes
   ↓
7. SISTEMA verifica inventario_dymmsa:
   - En stock → Apartar para venta
   - Faltantes → Agregar a lista pedido URREA
   ↓
8. SISTEMA genera Excel formato URREA (plantilla)
   - Llena código y cantidad automáticamente
   - Solo productos faltantes
   ↓
9. Usuario envía pedido a URREA
   ↓
10. URREA envía productos
   ↓
11. Usuario confirma recepción:
    - Marca productos surtidos/no surtidos
    ↓
12. SISTEMA actualiza inventario automáticamente:
    - Suma productos recibidos de URREA
    - Resta productos vendidos al cliente
    ↓
13. SISTEMA genera cotización FINAL (solo productos confirmados)
    ↓
14. Orden → COMPLETADA
    ↓
15. SISTEMA auto-aprende:
    - Agrega nuevos ETM-URREA a catálogo automáticamente
```

## 📐 FASES DE DESARROLLO

### ✅ Fase 0: Setup Inicial - COMPLETADA
Proyecto Next.js 16, dependencias, shadcn/ui, estructura base.

### ✅ Fase 1: Autenticación - COMPLETADA
Supabase Auth, login, protección de rutas, middleware.

### ✅ Fase 2: Catálogo Productos - COMPLETADA
Tabla etm_products, CRUD completo, importación masiva desde Excel.

### ✅ Fase 3: Cotizador Básico - COMPLETADA
Subir Excel, detectar ETM multi-hoja, generar cotización descargable.

### 🔄 Fase 4: Inventario Tienda (ACTUAL)
**Objetivo:** Sistema de inventario DYMMSA con CRUD completo.

**Tareas:**
- Crear tabla inventario_dymmsa en Supabase
- CRUD de inventario (agregar, editar, eliminar, ver stock)
- Importación/actualización masiva desde Excel
- Vista de productos con bajo stock
- Ajustes de inventario con historial

### Fase 5: Detección Productos Aprobados
**Objetivo:** Detectar productos marcados en verde del cliente.

**Tareas:**
- Subir Excel con productos marcados en verde
- Detectar celdas verdes con ExcelJS
- Extraer productos aprobados automáticamente
- Crear orden con estado "aprobada_cliente"

### Fase 6: Verificación Stock y Pedido URREA
**Objetivo:** Comparar vs inventario y generar pedido URREA.

**Tareas:**
- Comparar productos aprobados vs inventario_dymmsa
- Separar: en stock vs a pedir
- Llenar plantilla Excel URREA automáticamente (código + cantidad)
- Generar archivo descargable para enviar a URREA

### Fase 7: Sistema de Órdenes
**Objetivo:** Tracking completo de órdenes con estados.

**Tareas:**
- Crear tablas ordenes y orden_items
- Dashboard de órdenes con filtros por estado
- Vista detallada de orden
- Cambios de estado manual
- Historial de cambios

### Fase 8: Recepción y Confirmación URREA
**Objetivo:** Confirmar productos recibidos y actualizar inventario.

**Tareas:**
- Módulo de recepción: marcar surtidos/no surtidos
- Actualizar inventario automáticamente
- Generar cotización final (solo productos disponibles)
- Cerrar orden como completada

### Fase 9: Auto-aprendizaje BD
**Objetivo:** Enriquecer catálogo automáticamente.

**Tareas:**
- Leer Excel aprobado con productos nuevos
- Detectar ETM no existentes en etm_products
- Agregar automáticamente con datos del Excel
- Log de productos agregados

### Fase 10: Mejoras y Optimización
**Objetivo:** Pulir UX/UI y optimizar performance.

**Tareas:**
- Reportes y estadísticas
- Notificaciones
- Exportar datos
- Optimizaciones de performance

## 🔧 CONSIDERACIONES TÉCNICAS

### Excel Processing
- Detectar columna "ETM" (case insensitive) en múltiples hojas
- Detectar celdas con fondo verde (colores: #00FF00, #00B050, etc)
- Llenar plantillas Excel existentes programáticamente
- Generar Excel con formato profesional

### Seguridad
- RLS (Row Level Security) en todas las tablas
- Validación server-side
- Sanitización de inputs
- Middleware en rutas protegidas

### Performance
- Cache con TanStack Query
- Paginación en tablas grandes
- Procesamiento Excel en memoria
- Lazy loading de componentes

### UX/UI
- Loading states en todas las operaciones
- Mensajes de error claros
- Confirmaciones en acciones destructivas
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
- ✅ Detección de productos aprobados (verde)
- ✅ Generación automática pedido URREA
- ✅ Sistema de órdenes con estados
- ✅ Confirmación de recepción URREA
- ✅ Actualización automática de inventario
- ✅ Auto-aprendizaje de catálogo
- ✅ App desplegada en Vercel

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
- Incluir manejo de errores robusto
- Sistema crece en complejidad: de cotizador simple a ERP ligero

---

**Última actualización:** 2026-01-24  
**Fase actual:** Fase 4 - Inventario Tienda  
**Stack:** Next.js 16 + TypeScript + Supabase + shadcn/ui
```

---

## 🚀 PROMPT PARA FASE 4: INVENTARIO

Ahora que actualizaste el CLAUDE.md, aquí está el prompt para empezar con el inventario:
```
FASE 4: INVENTARIO TIENDA DYMMSA

Lee CLAUDE.md actualizado para entender el flujo completo.

Vamos a crear el sistema de inventario de la tienda DYMMSA. Este es crucial porque necesitamos saber qué productos hay en stock para no pedir todo a URREA.

TAREAS:

1. **Crear tabla en Supabase (SQL):**

Genera el SQL para crear tabla inventario_dymmsa:
- id (UUID, PK)
- producto_id (FK a etm_products, UNIQUE)
- cantidad_disponible (INTEGER, default 0)
- cantidad_minima (INTEGER, default 5) - punto de reorden
- ubicacion (TEXT) - ubicación física en tienda
- notas (TEXT, opcional)
- updated_at (TIMESTAMPTZ)

Índices y RLS:
- Índice en producto_id
- Políticas RLS para usuarios autenticados

2. **Hook para inventario:**

hooks/useInventory.ts:
- useQuery para listar inventario con joins a etm_products
- Mostrar: ETM, Descripción, Modelo, Stock, Ubicación
- useMutation para crear/actualizar/eliminar
- useMutation para ajustar cantidad (suma/resta)
- useMutation para importar desde Excel

3. **Página admin inventario:**

app/(dashboard)/admin/inventario/page.tsx:
- Tabla con productos del inventario
- Columnas: ETM, Descripción, Modelo, Stock, Mínimo, Ubicación, Acciones
- Badge de color según stock:
  - Verde: stock > mínimo
  - Amarillo: stock <= mínimo
  - Rojo: stock = 0
- Búsqueda por ETM o descripción
- Filtro: Todos / Solo bajo stock / Sin stock
- Botones: "Agregar Producto", "Importar Excel", "Ajustar Stock"

4. **Componentes de inventario:**

components/inventario/InventoryTable.tsx:
- Tabla shadcn/ui con paginación
- Loading y empty states

components/inventario/InventoryForm.tsx:
- Form para agregar producto al inventario
- Select de productos de etm_products
- Campos: cantidad inicial, cantidad mínima, ubicación
- Validación con zod

components/inventario/StockAdjustment.tsx:
- Dialog para ajustar stock
- Opciones: Agregar (+) o Restar (-)
- Input cantidad
- Textarea para razón del ajuste
- Botón "Confirmar Ajuste"

components/inventario/ExcelImporterInventory.tsx:
- Subir Excel con columnas: ETM, CANTIDAD, UBICACION
- Preview antes de importar
- Opciones: "Actualizar existentes" o "Solo agregar nuevos"
- Progress bar
- Resumen: X actualizados, Y agregados, Z errores

5. **API Routes:**

app/api/inventario/route.ts:
- GET: listar inventario con joins
- POST: agregar producto al inventario

app/api/inventario/[id]/route.ts:
- PUT: actualizar stock
- DELETE: eliminar del inventario

app/api/inventario/import/route.ts:
- POST: importar desde Excel
- Validar estructura
- Actualizar/insertar en inventario_dymmsa

app/api/inventario/adjust/route.ts:
- POST: ajustar stock (suma/resta)
- Registrar ajuste en log (opcional tabla de movimientos)

6. **Actualizar Navbar:**
Agregar link "Inventario" en navbar a /dashboard/admin/inventario

IMPORTANTE:
- Relación 1:1 con etm_products (un producto puede estar o no en inventario)
- Si producto no está en inventario → stock = 0
- Excel de importación debe tener: ETM, CANTIDAD, UBICACION (opcional)
- Validar que ETM exista en etm_products antes de agregarlo al inventario
- Stock nunca puede ser negativo (validación)