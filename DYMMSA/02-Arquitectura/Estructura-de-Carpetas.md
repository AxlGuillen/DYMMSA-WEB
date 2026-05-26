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
│   │   └── quotes/lookup/        # GET: lookup ETMs en etm_products
│   │
│   ├── approve/[token]/          # Página PÚBLICA de aprobación (sin auth)
│   │   ├── page.tsx              # Server component: carga cotización por token
│   │   └── ApprovalClient.tsx    # Client component: UI de aprobación interactiva
│   │
│   ├── dashboard/                # Área autenticada
│   │   ├── layout.tsx            # Layout con Sidebar + Navbar
│   │   ├── page.tsx              # Dashboard principal (métricas)
│   │   ├── db/page.tsx           # Catálogo ETM products
│   │   ├── docs/page.tsx         # Documentación interna
│   │   ├── inventory/page.tsx    # Gestión de inventario
│   │   ├── orders/
│   │   │   ├── page.tsx          # Lista de órdenes
│   │   │   ├── new/page.tsx      # Crear orden manual (legacy)
│   │   │   └── [id]/page.tsx     # Detalle de orden
│   │   ├── quotations/
│   │   │   ├── page.tsx          # Lista de cotizaciones
│   │   │   └── [id]/page.tsx     # Detalle de cotización
│   │   └── quoter/page.tsx       # Cotizador (tabla editable)
│   │
│   ├── login/                    # Autenticación
│   ├── layout.tsx                # Root layout (providers)
│   └── page.tsx                  # Redirect a /dashboard
│
├── components/
│   ├── dashboard/                # DashboardMetrics, MetricCard, OrderStatusBreakdown
│   ├── db/                       # ExcelImporter, ProductForm, ProductsTable
│   ├── discrete-mode-toggle.tsx  # Toggle Eye/EyeOff para modo discreto (global)
│   ├── inventory/                # InventoryForm, InventoryImporter, InventoryTable
│   ├── layout/                   # Footer, Navbar, Sidebar
│   ├── orders/                   # NewOrderForm, OrderDetail, OrderStatusBadge, OrdersTable
│   ├── providers/                # QueryProvider (TanStack), ThemeProvider
│   ├── quotations/               # QuotationDetail, QuotationStatusBadge, QuotationsTable
│   ├── quoter/                   # FileUploader, ProductModal, QuotationEditor, QuotePreview
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
│   └── useQuotes.ts              # Lookup ETMs para el cotizador
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
│   ├── api-helpers.ts            # requireAuth() + respuestas estándar para route handlers
│   ├── inventory.ts              # computeRestoration (pura) + restoreOrderInventory (DB)
│   ├── auto-learn.ts             # mergeEtmFields (pura) + processAutoLearn (orchestración)
│   └── utils.ts                  # cn() — class merging
│
├── stores/
│   ├── discreteModeStore.ts      # Zustand store: modo discreto ON/OFF (persist en localStorage)
│   └── quotationStore.ts         # Zustand store: draft de cotización (persist en localStorage)
│
└── types/
    ├── database.ts               # Interfaces TS: EtmProduct, StoreInventory, Order, OrderItem,
    │                             #   Quotation, QuotationItem, QuotationItemRow, etc.
    └── index.ts                  # Re-exporta desde database.ts
```

## Tests (`tests/`, fuera de `src/`)

La carpeta `tests/` vive en la raíz del repo y espeja la estructura de `src/`. Ver [[04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing]].

```
tests/
├── helpers/
│   ├── supabase-mock.ts          # Fake del query builder de Supabase (chainable + thenable)
│   └── request.ts                # makeRequest, makeParams, makeExcelRequest, readJson
├── lib/                          # Tests de funciones puras (src/lib/*)
│   ├── format.test.ts
│   ├── business-rules.test.ts
│   ├── auto-learn.test.ts
│   └── inventory.test.ts
└── api/                          # Tests de route handlers (Supabase mockeado)
    ├── smoke.test.ts             # Valida el approach (mock.module + alias + NextResponse)
    ├── auth-guards.test.ts       # 18 rutas → 401 sin auth; /approve público
    ├── quotations.test.ts        # save, update, create-order
    ├── orders.test.ts            # create, [id] PATCH/DELETE, cancel, confirm-reception
    └── imports.test.ts           # inventory/import, products/import, auto-learn
```

Comando: `bun test tests/` (177 tests). Watch: `bun test:watch`. Coverage: `bun test:coverage`.

## Convenciones importantes

- **Páginas** son Server Components por defecto; se agregan `"use client"` solo donde se necesita interactividad.
- **API Routes** usan `createClient()` de `@supabase/ssr` para acceso autenticado.
- **Hooks** son wrappers de TanStack Query + fetch a las API Routes propias.
- **Types** en inglés, co-localizados en `src/types/database.ts`.
- **shadcn/ui**: los componentes se copian a `src/components/ui/` y se modifican directamente.
