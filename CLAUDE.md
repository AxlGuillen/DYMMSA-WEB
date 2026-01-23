# DYMMSA - Sistema de Cotizaciones

## 📋 DESCRIPCIÓN DEL PROYECTO

Aplicación web para automatizar el proceso de cotizaciones de DYMMSA, un distribuidor de herramientas URREA en Morelia, México. 

El sistema permite procesar archivos Excel con códigos ETM (códigos genéricos de herramientas) y convertirlos automáticamente a productos URREA usando una base de datos centralizada en la nube, generando cotizaciones listas para enviar a clientes.

## 🎯 PROBLEMA QUE RESUELVE

**Situación actual:**
- Cliente grande solicita cotizaciones mediante Excel con códigos ETM
- DYMMSA debe convertir manualmente ETM → códigos URREA usando macros de Excel
- Si el Excel tiene múltiples hojas, debe copiar/pegar macros en cada una (tedioso y propenso a errores)
- Base de datos desactualizada (solo ~384 productos de miles disponibles)
- Proceso lento y manual

**Solución:**
- Subir Excel → Sistema procesa todas las hojas automáticamente → Descarga cotización
- Base de datos en nube accesible desde cualquier lugar
- Dashboard para mantener catálogo actualizado
- Sistema de roles para control de acceso
- Historial de cotizaciones para auditoría

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
- **Auth:** Better Auth
- **API:** Next.js API Routes (Route Handlers)

### Tools & Libraries
- **Package Manager:** Bun
- **Excel Processing:** SheetJS (xlsx) y/o ExcelJS
- **Version Control:** GitHub
- **Deployment:** Vercel

## 🏗️ ARQUITECTURA DE DATOS

### Entidades Principales

**Productos** (Catálogo ETM → URREA)
```
- etm (PK): Código ETM
- descripcion: Descripción del producto
- modelo: Código/modelo URREA
- precio: Precio del producto
- marca: "URREA" (por defecto)
- created_at, updated_at, created_by
```

**Cotizaciones** (Historial)
```
- id: UUID
- user_id: Quien generó la cotización
- filename: Nombre del Excel subido
- total_solicitados: Cantidad de ETMs en el Excel
- total_encontrados: ETMs que se encontraron en BD
- productos_etm: Array de códigos procesados
- created_at
```

**Users** (Better Auth)
```
- id, email, password
- role: 'admin' | 'user'
```

### Roles y Permisos
- **Admin:** CRUD completo de productos + cotizar + ver historial completo
- **User:** Solo cotizar + ver su propio historial

## 🎨 FLUJOS PRINCIPALES

### 1. Cotizar (Usuario/Admin)
```
Usuario sube Excel → Sistema detecta columna "ETM" en todas las hojas
→ Consulta BD Supabase → Muestra preview con estadísticas
→ Genera Excel cotización → Usuario descarga → Se guarda en historial
```

### 2. Gestionar Catálogo (Solo Admin)
```
Admin accede a dashboard → Ve tabla de productos
→ Puede: Crear, Editar, Eliminar, Buscar, Importar en lote
→ Cambios se reflejan inmediatamente en cotizaciones
```

### 3. Ver Historial (Admin ve todo, User ve solo suyo)
```
Usuario/Admin accede a historial → Ve tabla de cotizaciones pasadas
→ Puede filtrar por fecha, usuario → Ver detalles de cada cotización
```

## 📐 FASES DE DESARROLLO

### Fase 0: Setup Inicial
Crear proyecto Next.js 16, instalar dependencias (Tailwind, shadcn, Supabase, etc.), configurar estructura base.

### Fase 1: Autenticación
Implementar Better Auth con login/registro, protección de rutas, manejo de sesiones y roles.

### Fase 2: Base de Datos
Configurar Supabase, crear tablas, políticas RLS, migrar datos iniciales (384 productos).

### Fase 3: Dashboard Admin (CRUD)
Crear interfaz de administración para gestionar catálogo de productos con todas las operaciones CRUD.

### Fase 4: Cotizador Principal
Implementar funcionalidad core: subir Excel, procesar, consultar BD, generar cotización descargable.

### Fase 5: Historial y Mejoras
Página de historial de cotizaciones, mejoras UX/UI, optimizaciones de performance.

### Fase 6: Expansión Catálogo (Futuro)
Expandir catálogo de 384 a miles de productos mediante importación masiva o scraping.

## 🔧 CONSIDERACIONES TÉCNICAS

### Excel Processing
- Detectar columna "ETM" (case insensitive) en múltiples hojas
- Extraer códigos únicos, ignorar duplicados
- Generar Excel de salida con formato profesional

### Seguridad
- Row Level Security (RLS) en Supabase
- Validación server-side de permisos
- Sanitización de inputs
- Auth middleware en rutas protegidas

### Performance
- Cache con TanStack Query
- Paginación en tablas grandes
- Procesamiento de Excel en memoria (sin guardar archivos)
- Lazy loading de componentes pesados

### UX/UI
- Loading states en todas las operaciones asíncronas
- Mensajes de error claros y accionables
- Confirmaciones en acciones destructivas
- Diseño responsive (mobile-first)

## 📝 VARIABLES DE ENTORNO
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Better Auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
NEXT_PUBLIC_APP_URL=
```

## 🎯 CRITERIOS DE ÉXITO (MVP)

- ✅ Login funcional con roles (admin/user)
- ✅ Admin puede gestionar productos (CRUD completo)
- ✅ Usuario puede subir Excel multi-hoja y obtener cotización
- ✅ Sistema detecta ETMs en cualquier hoja automáticamente
- ✅ Cotización descargable en formato Excel profesional
- ✅ Historial guarda quién generó cada cotización
- ✅ App desplegada en Vercel y funcionando en producción

## 📚 RECURSOS DE REFERENCIA

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Better Auth Documentation](https://better-auth.com)
- [shadcn/ui Components](https://ui.shadcn.com)
- [SheetJS Documentation](https://docs.sheetjs.com)
- [TanStack Query](https://tanstack.com/query/latest)

## 🔄 NOTAS PARA CLAUDE

- Este proyecto usa **Context7** para compartir contexto
- El desarrollador indicará manualmente en qué fase del desarrollo se encuentra
- Priorizar código limpio, TypeScript estricto y buenas prácticas
- Incluir manejo de errores robusto en todas las operaciones
- Explicar decisiones técnicas cuando sea relevante

---