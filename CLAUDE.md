# DYMMSA - Sistema de Cotizaciones

## DESCRIPCION DEL PROYECTO

Aplicacion web para automatizar el proceso de cotizaciones de DYMMSA, un distribuidor de herramientas URREA en Morelia, Mexico.

El sistema permite procesar archivos Excel con codigos ETM (codigos genericos de herramientas) y convertirlos automaticamente a productos URREA usando una base de datos centralizada en la nube, generando cotizaciones listas para enviar a clientes.

## PROBLEMA QUE RESUELVE

**Situacion actual:**
- Cliente grande solicita cotizaciones mediante Excel con codigos ETM
- DYMMSA debe convertir manualmente ETM → codigos URREA usando macros de Excel
- Si el Excel tiene multiples hojas, debe copiar/pegar macros en cada una (tedioso y propenso a errores)
- Base de datos desactualizada (solo ~384 productos de miles disponibles)
- Proceso lento y manual

**Solucion:**
- Subir Excel → Sistema procesa todas las hojas automaticamente → Descarga cotizacion
- Base de datos en nube accesible desde cualquier lugar
- Dashboard para mantener catalogo actualizado
- Historial de cotizaciones para auditoria

## CONTEXTO DEL DESARROLLADOR

- Frontend developer con experiencia en React/TypeScript
- Primer proyecto profesional con Next.js + Supabase
- Usa **Context7** para compartir contexto del proyecto con Claude
- Prefiere arquitecturas modernas, mantenibles y escalables

## STACK TECNOLOGICO

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
- **Excel Processing:** SheetJS (xlsx) y/o ExcelJS
- **Version Control:** GitHub
- **Deployment:** Vercel

## ARQUITECTURA DE DATOS

### Entidades Principales

**Products** (Catalogo ETM → URREA)
```
- etm (PK): Codigo ETM
- description: Descripcion del producto
- model: Codigo/modelo URREA
- price: Precio del producto
- brand: "URREA" (por defecto)
- created_at, updated_at, created_by
```

**Quotes** (Historial)
```
- id: UUID
- user_id: Quien genero la cotizacion
- filename: Nombre del Excel subido
- total_requested: Cantidad de ETMs en el Excel
- total_found: ETMs que se encontraron en BD
- etm_products: Array de codigos procesados
- created_at
```

**Users** (Supabase Auth)
```
- id, email (manejado por Supabase Auth)
```

### Roles y Permisos
Por ahora: Sin sistema de roles. Todos los usuarios autenticados tienen acceso completo. Se implementara en fase futura.

## FLUJOS PRINCIPALES

### 1. Cotizar (Usuario autenticado)
```
Usuario sube Excel → Sistema detecta columna "ETM" en todas las hojas
→ Consulta BD Supabase → Muestra preview con estadisticas
→ Genera Excel cotizacion → Usuario descarga → Se guarda en historial
```

### 2. Gestionar Catalogo
```
Usuario accede a dashboard → Ve tabla de productos
→ Puede: Crear, Editar, Eliminar, Buscar, Importar en lote
→ Cambios se reflejan inmediatamente en cotizaciones
```

### 3. Ver Historial
```
Usuario accede a historial → Ve tabla de cotizaciones pasadas
→ Puede filtrar por fecha → Ver detalles de cada cotizacion
```

## FASES DE DESARROLLO

### Fase 0: Setup Inicial
Crear proyecto Next.js 16, instalar dependencias (Tailwind, shadcn, Supabase, etc.), configurar estructura base.

### Fase 1: Autenticacion
Implementar autenticacion basica con Supabase Auth (login/logout), sin sistema de roles.

### Fase 2: Base de Datos
Configurar Supabase, crear tablas, politicas RLS, migrar datos iniciales (384 productos).

### Fase 3: Dashboard (CRUD)
Crear interfaz de administracion para gestionar catalogo de productos con todas las operaciones CRUD.

### Fase 4: Cotizador Principal
Implementar funcionalidad core: subir Excel, procesar, consultar BD, generar cotizacion descargable.

### Fase 5: Historial y Mejoras
Pagina de historial de cotizaciones.

### Fase 6: Expansion Catalogo (Futuro)
Expandir catalogo de 384 a miles de productos mediante importacion masiva o scraping.

## CONSIDERACIONES TECNICAS

### Excel Processing
- Detectar columna "ETM" (case insensitive) en multiples hojas
- Extraer codigos unicos, ignorar duplicados
- Generar Excel de salida con formato profesional

### Seguridad
- Row Level Security (RLS) en Supabase
- Validacion server-side de permisos
- Sanitizacion de inputs
- Middleware en rutas protegidas

### Performance
- Cache con TanStack Query
- Paginacion en tablas grandes
- Procesamiento de Excel en memoria (sin guardar archivos)
- Lazy loading de componentes pesados

### UX/UI
- Loading states en todas las operaciones asincronas
- Mensajes de error claros y accionables
- Confirmaciones en acciones destructivas
- Diseno responsive (mobile-first)

## VARIABLES DE ENTORNO
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## CRITERIOS DE EXITO (MVP)

- Login funcional con Supabase Auth
- Usuario puede gestionar productos (CRUD completo)
- Usuario puede subir Excel multi-hoja y obtener cotizacion
- Sistema detecta ETMs en cualquier hoja automaticamente
- Cotizacion descargable en formato Excel profesional
- Historial guarda quien genero cada cotizacion
- App desplegada en Vercel y funcionando en produccion

## RECURSOS DE REFERENCIA

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Auth with Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [shadcn/ui Components](https://ui.shadcn.com)
- [SheetJS Documentation](https://docs.sheetjs.com)
- [TanStack Query](https://tanstack.com/query/latest)

## NOTAS PARA CLAUDE

- Este proyecto usa **Context7** para compartir contexto
- El desarrollador indicara manualmente en que fase del desarrollo se encuentra
- Priorizar codigo limpio, TypeScript estricto y buenas practicas
- Incluir manejo de errores robusto en todas las operaciones
- Explicar decisiones tecnicas cuando sea relevante

---
