# Estructura de Carpetas

```
src/
├── app/                          # Next.js App Router
│   ├── api/                      # Route Handlers (lógica server-side)
│   │   ├── approve/[token]/      # GET: cotización por token | POST: enviar decisiones
│   │   ├── inventory/import/     # POST: importar inventario desde Excel
│   │   ├── orders/
│   │   │   ├── [id]/
│   │   │   │   ├── cancel/       # POST: cancelar orden + restaurar inventario
│   │   │   │   ├── confirm-reception/ # POST: confirmar recepción + actualizar inventario
│   │   │   │   └── items/
│   │   │   │       ├── route.ts  # POST: agregar ítem a orden
│   │   │   │       └── [itemId]/ # PATCH: editar precio | DELETE: eliminar + restaurar stock
│   │   │   ├── auto-learn/       # POST: auto-learn manual (legacy)
│   │   │   └── create/           # POST: crear orden directa (legacy, sin cotización)
│   │   ├── products/
│   │   │   ├── import/           # POST: importar catálogo ETM desde Excel
│   │   │   └── next-dymmsa-code/ # GET: siguiente DYMMSA-{n} disponible
│   │   └── quotations/
│   │       ├── save/             # POST: crear cotización + auto-learn
│   │       └── [id]/
│   │           ├── route.ts      # GET: detalle de cotización
│   │           ├── create-order/ # POST: crear orden desde cotización aprobada
│   │           ├── send-for-approval/ # POST: generar token + cambiar status
│   │           └── update/       # PATCH: editar cotización (draft o approved)
│   │   ├── quotes/lookup/        # GET: lookup ETMs en etm_products
│   │   └── tasks/                 # Módulo Tareas (GitHub Issues, ADR-014)
│   │       ├── route.ts          # GET: lista | POST: crear
│   │       ├── upload/           # POST: imagen → bucket task-images → URL
│   │       └── [number]/
│   │           ├── route.ts      # GET: detalle+comentarios | PATCH: editar/cerrar/reabrir
│   │           └── comments/     # POST: comentar
│   │
│   ├── approve/[token]/          # Página PÚBLICA de aprobación (sin auth)
│   │   ├── page.tsx              # Server component: carga cotización por token
│   │   ├── ApprovalClient.tsx    # Client component: orquesta la UI de aprobación
│   │   ├── ApprovalFilters.tsx   # Filtros marca/proyecto + aprobar-visibles (issue #24)
│   │   ├── ApprovalDock.tsx      # Dock flotante sticky (anillo de progreso + acciones)
│   │   ├── SummaryTiles.tsx      # Tiles Cliente/Productos/Subtotal
│   │   ├── SuccessScreen.tsx     # Pantalla de confirmación tras enviar
│   │   ├── SplashIntro.tsx       # Splash del logo (1 vez por sesión, reduce-motion)
│   │   └── format.ts             # Formato de moneda local (público, sin modo discreto)
│   │
│   ├── dashboard/                # Área autenticada
│   │   ├── layout.tsx            # Layout con Sidebar + Navbar
│   │   ├── page.tsx              # Dashboard principal (métricas)
│   │   ├── db/page.tsx           # Catálogo ETM products
│   │   ├── docs/page.tsx         # Documentación interna
│   │   ├── inventory/page.tsx    # Gestión de inventario
│   │   ├── proveedores/page.tsx  # Proveedores de menudeo + marcas (issue #21)
│   │   ├── orders/
│   │   │   ├── page.tsx          # Lista de órdenes
│   │   │   ├── new/page.tsx      # Crear orden manual (legacy)
│   │   │   ├── [id]/page.tsx     # Detalle de orden
│   │   │   └── [id]/planner/page.tsx  # Planificador de compra mayoreo/menudeo (ADR-018)
│   │   ├── quotations/
│   │   │   ├── page.tsx          # Lista de cotizaciones
│   │   │   └── [id]/page.tsx     # Detalle de cotización
│   │   ├── quoter/page.tsx       # Cotizador (tabla editable)
│   │   └── tasks/
│   │       ├── page.tsx          # Lista de tareas + filtros + modal de creación
│   │       └── [number]/page.tsx # Detalle de tarea (descripción, comentarios, acciones)
│   │
│   ├── login/                    # Autenticación
│   ├── layout.tsx                # Root layout (providers)
│   └── page.tsx                  # Redirect a /dashboard
│
├── components/
│   ├── dashboard/                # DashboardMetrics, MetricCard, OrderStatusBreakdown
│   ├── db/                       # ExcelImporter, ProductForm, ProductsTable
│   ├── ColumnPicker.tsx          # Selector "Columnas" por tabla (checkbox + restablecer, issue #18)
│   ├── discrete-mode-toggle.tsx  # Toggle Eye/EyeOff para modo discreto (global)
│   ├── inventory/                # InventoryForm, InventoryImporter, InventoryTable
│   ├── layout/                   # Footer, Navbar, Sidebar
│   ├── orders/                   # NewOrderForm, OrderDetail, OrderStatusBadge, OrdersTable, PurchasePlanner
│   ├── providers/                # QueryProvider (TanStack), ThemeProvider
│   ├── quotations/               # QuotationDetail, QuotationStatusBadge, QuotationsTable
│   ├── quoter/                   # FileUploader, ProductModal, QuotationEditor, QuotePreview
│   ├── suppliers/                # SuppliersTable, SupplierForm, BrandsManager (issue #21)
│   ├── tasks/                    # TaskForm, TaskDetail, TaskPriorityBadge
│   └── ui/                       # shadcn/ui components (alert-dialog, badge, button, etc.)
│
├── hooks/
│   ├── useAuth.ts                # Auth state y helpers
│   ├── useCurrency.ts            # Formatea montos; devuelve '$•,•••.••' en modo discreto
│   ├── useDashboard.ts           # Métricas y stats del dashboard
│   ├── useInventory.ts           # CRUD inventario
│   ├── useOrders.ts              # CRUD + acciones de órdenes (add/edit/remove items, cancel, confirm)
│   ├── useProducts.ts            # CRUD catálogo ETM
│   ├── useQuotations.ts          # CRUD + acciones de cotizaciones
│   ├── usePurchasePlan.ts        # Plan de compra + guardado de decisiones (ADR-018)
│   ├── useVisibleColumns.ts      # Visibilidad de columnas por tabla (issue #18; SSR-safe con useMounted)
│   ├── useQuotes.ts              # Lookup ETMs para el cotizador
│   ├── useSuppliers.ts           # Proveedores + marcas (SUPPLIERS_KEY, BRANDS_KEY)
│   ├── useSettings.ts            # useUpdateSettings (app_settings, umbrales del planificador)
│   └── useTasks.ts               # Tareas (GitHub Issues): lista/detalle/crear/editar/comentar/upload
│
├── lib/
│   ├── excel/
│   │   ├── parser.ts             # extractProductRowsFromExcel, extractEtmCodesFromExcel
│   │   ├── generator.ts          # Generar Excel URREA output
│   │   └── detect-approved.ts    # Detectar filas verdes (legacy)
│   ├── supabase/
│   │   ├── client.ts             # createBrowserClient (browser)
│   │   ├── server.ts             # createClient (server/API routes)
│   │   └── admin.ts              # createAdminClient (service role, cuando necesario)
│   ├── format.ts                 # Fechas relativas/absolutas, sanitize, parseNumber, parseInteger
│   ├── business-rules.ts         # isProductItem, calculateQuotationTotal, allocateInventory, etc.
│   ├── approval-filters.ts       # Filtros de la página de aprobación: secciones/marcas (issue #24)
│   ├── purchase-plan.ts          # Planificador de compra: consolidación, math STD, recomendación (ADR-018)
│   ├── api-helpers.ts            # requireAuth() + respuestas estándar para route handlers
│   ├── inventory.ts              # computeRestoration (pura) + restoreOrderInventory (DB)
│   ├── auto-learn.ts             # mergeEtmFields (pura) + processAutoLearn (orchestración)
│   ├── github.ts                 # Cliente GitHub Issues (módulo Tareas): fetchGitHub + mapeos puros
│   └── utils.ts                  # cn() — class merging
│
├── stores/
│   ├── columnStore.ts            # Zustand store: columnas ocultas por tabla (persist 'dymmsa-columns', issue #18)
│   ├── discreteModeStore.ts      # Zustand store: modo discreto ON/OFF (persist en localStorage)
│   └── quotationStore.ts         # Zustand store: draft de cotización (persist en localStorage)
│
└── types/
    ├── database.ts               # Interfaces TS: EtmProduct, StoreInventory, Order, OrderItem,
    │                             #   Quotation, QuotationItem, QuotationItemRow, etc.
    └── index.ts                  # Re-exporta desde database.ts
```

## Tests (`tests/`, fuera de `src/`)

La carpeta `tests/` vive en la raíz del repo y espeja la estructura de `src/`. Runner: **Vitest** (`vitest.config.ts`, en la raíz), entornos `node` (lib/api) y `jsdom` (componentes). Ver [[04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing]].

```
tests/
├── helpers/
│   ├── supabase-mock.ts          # Fake del query builder (chainable+thenable) + matchers + accessors
│   ├── setup.ts                  # injectSupabaseServer / injectSupabaseAdmin (DRY del beforeEach)
│   ├── factories.ts              # AUTH, quotationItem, separator, orderProduct (payloads de API)
│   └── request.ts                # makeRequest, makeParams, makeExcelRequest, readJson
├── lib/                          # Funciones puras (src/lib/*) — node
│   ├── format.test.ts
│   ├── business-rules.test.ts
│   ├── auto-learn.test.ts
│   └── inventory.test.ts
├── api/                          # Route handlers (Supabase mockeado) — node
│   ├── smoke.test.ts             # Valida el approach (vi.mock + alias + NextResponse)
│   ├── auth-guards.test.ts       # 18 rutas → 401 sin auth; /approve público
│   ├── quotations.test.ts        # save, update, create-order
│   ├── orders.test.ts            # create, [id] PATCH/DELETE, cancel, confirm-reception
│   └── imports.test.ts           # inventory/import, products/import, auto-learn
└── components/                   # Componentes React (jsdom + Testing Library)
    ├── setup.ts                  # jest-dom + cleanup + polyfills (matchMedia, ResizeObserver, crypto, clipboard)
    ├── helpers/                  # render (QueryClientProvider), stores (resetStores), fixtures (shape UI)
    ├── smoke / badges / MetricCard / useCurrency / DiscreteModeToggle / QuotePreview
    └── ProductModal / QuotationEditor / QuotationDetail   # interactivos (userEvent, mock de hooks)
```

Comando: `bun run test` (226 tests). Watch: `bun run test:watch`. Coverage: `bun run test:coverage`. ⚠️ Usar `bun run test`, no `bun test`.

## Convenciones importantes

- **Páginas** son Server Components por defecto; se agregan `"use client"` solo donde se necesita interactividad.
- **API Routes** usan `createClient()` de `@supabase/ssr` para acceso autenticado.
- **Hooks** son wrappers de TanStack Query + fetch a las API Routes propias.
- **Types** en inglés, co-localizados en `src/types/database.ts`.
- **shadcn/ui**: los componentes se copian a `src/components/ui/` y se modifican directamente.
