# DYMMSA-WEB

Web system for automating the full quotation workflow of DYMMSA, an authorized URREA tools distributor in Morelia, Mexico.

## Overview

DYMMSA-WEB covers the entire sales cycle — from the customer's initial request to final delivery:

- Editable quotation table: upload customer Excel → auto-fill from catalog
- Approval via shareable link with UUID token (no login required for the external approver)
- Item-level partial approval: customer approves or rejects each product individually
- Automatic order generation from an approved quotation
- Stock verification and automatic allocation (in-store vs. to order from URREA)
- URREA purchase order Excel export (pending items only)
- Reception confirmation and inventory update
- Auto-learn: the ETM → URREA catalog grows with every saved quotation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styles | Tailwind CSS + shadcn/ui |
| Client state | Zustand + localStorage |
| Server state | TanStack Query |
| Database + Auth | Supabase (PostgreSQL 17.6) · @supabase/ssr · RLS enabled |
| Excel | SheetJS (parse) + ExcelJS (generate) |
| Package manager | Bun |
| Deployment | Vercel |

## Features

### ETM–URREA Catalog
- Full CRUD for `etm_products`
- Bulk import from Excel
- Auto-learn: when a quotation is saved, new ETMs are inserted and existing ones are updated with any new data

### Quotation Builder
- Upload customer Excel (multi-sheet; only the ETM column is required)
- Case-insensitive ETM column detection; optional columns: `description`, `description_es`, `model_code`, `quantity`, `price`, `brand`
- Editable table pre-filled from Excel + database catalog
- Per-product modal for structured editing; manual row addition
- Draft persisted in Zustand + localStorage (survives page reloads)
- On save: creates `quotations` + `quotation_items` records and runs auto-learn
- Section separators to organize large quotations (300+ items)

### Approval Flow
- Generates a UUID token when a quotation is sent for approval
- Public page `/approve/[token]` — no login required for the external approver
- Approver marks each item: ✅ approved / ❌ rejected (partial approval)
- "Approve all" button for convenience
- Once submitted, the approval cannot be changed (informational banner shown)

### Quotation Management
- Dashboard with list view, status filters, and search
- Detail view with stats: approved / rejected / pending items, total amount
- Discrete mode: mask monetary values app-wide (useful for demos)
- Editing allowed in both `draft` and `approved` status:
  - DYMMSA can add extra products to an already-approved quotation
  - New items are auto-approved (internal approval)
  - Existing items preserve their original approval status
  - Quantity and price of approved items can be edited
- Statuses: `draft` → `sent_for_approval` → `approved` / `rejected` → `converted_to_order`

### Order Management
- Auto-generated from an approved quotation (approved items only)
- Stock check per `model_code`:
  - Full stock → `quantity_to_order = 0`
  - Partial stock → reserve available, order the rest from URREA
  - No stock → entire quantity goes to URREA
- Inventory is deducted immediately when the order is created
- URREA purchase order Excel (`.xlsx`): only `brand = URREA` and `quantity_to_order > 0`
- Order detail page: edit `quantity_received` and `urrea_status` per item
- Flexible item management on active orders:
  - Add last-minute products (automatic stock check)
  - Edit unit price per item
  - Remove products (automatically restores reserved inventory)
- Confirm reception → adds to `store_inventory`
- Cancel order → restores inventory
- Statuses: `ordered` → `received` → `delivered` → `completed` / `cancelled`

### Inventory
- Stock management by URREA model code (`store_inventory`)
- Full CRUD + Excel import
- Automatically updated when orders are created and receptions are confirmed

## Full Workflow

```
1. User uploads customer Excel (ETM codes)
   ↓
2. System pre-fills the editable table (Excel + DB catalog)
   User fills in missing data and adjusts quantities
   ↓
3. Save quotation
   → Auto-learn in etm_products (INSERT / UPDATE)
   → Creates quotations (status: draft) + quotation_items
   ↓
4. Send for approval
   → Generates approval_token UUID
   → Link /approve/[token] shared with customer (WhatsApp, email, etc.)
   ↓
5. Customer opens the link (no login) and approves/rejects each item
   → quotation_items.is_approved updated
   → status: approved / rejected
   ↓
6. DYMMSA sees the approved quotation in the dashboard
   → Can add extra items or edit data (auto-approved internally)
   → Generates order from the quotation
   ↓
7. System creates the order
   → Approved items only
   → Checks stock, deducts inventory immediately
   → Creates order_items with stock/to-order breakdown
   → quotation status: converted_to_order
   ↓
8. Download URREA Excel (pending items only, brand = URREA)
   → User sends to URREA via WhatsApp
   ↓
9. URREA ships the products (days later)
   ↓
10. If needed, add/remove products from the order last-minute
    → Stock is adjusted automatically
    ↓
11. User edits quantity_received + urrea_status per item
    → Confirm reception → adds to store_inventory
    ↓
12. Manage statuses until order is completed
```

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── approve/[token]/             # GET + POST — public (no auth)
│   │   ├── inventory/                   # Excel inventory import
│   │   ├── orders/
│   │   │   ├── [id]/cancel/             # Cancel order + restore inventory
│   │   │   ├── [id]/confirm-reception/  # Confirm reception + update inventory
│   │   │   ├── [id]/items/              # POST: add item to order
│   │   │   └── [id]/items/[itemId]/     # PATCH: edit price | DELETE: remove + restore inv.
│   │   ├── products/                    # Excel catalog import
│   │   ├── quotations/
│   │   │   ├── save/                    # Create quotation + auto-learn
│   │   │   └── [id]/
│   │   │       ├── send-for-approval/   # Generate token + change status
│   │   │       ├── update/              # Edit draft or approved quotation
│   │   │       └── create-order/        # Generate order from approved quotation
│   │   └── quotes/lookup/               # Lookup ETMs against etm_products
│   ├── approve/[token]/                 # Public approval page (no auth)
│   ├── dashboard/
│   │   ├── db/                          # ETM–URREA catalog
│   │   ├── inventory/                   # Inventory management
│   │   ├── orders/[id]/                 # Order list + detail
│   │   └── quotations/[id]/             # Quotation list + detail
│   └── login/
├── components/
│   ├── layout/                          # Navbar, sidebar, layouts
│   ├── orders/                          # OrderDetail, OrdersTable, OrderStatusBadge
│   ├── quotations/                      # QuotationDetail, QuotationsTable, QuotationStatusBadge
│   ├── quoter/                          # FileUploader, QuotationEditor, ProductModal
│   └── ui/                              # shadcn/ui components
├── hooks/
│   ├── useQuotations.ts                 # All quotation mutations and queries
│   ├── useOrders.ts                     # All order mutations and queries
│   └── useQuotes.ts                     # useLookupEtms
├── lib/
│   ├── business-rules.ts                # Totals, item filters, allocation logic
│   ├── api-helpers.ts                   # requireAuth(), standard responses
│   ├── inventory.ts                     # computeRestoration, restoreOrderInventory
│   ├── auto-learn.ts                    # mergeEtmFields, processAutoLearn
│   ├── format.ts                        # Dates, strings, numbers
│   └── supabase/                        # client.ts, server.ts, admin.ts
├── stores/
│   ├── quotationStore.ts                # Zustand + persist (quotation draft)
│   └── discreteModeStore.ts             # Zustand + persist (discrete mode toggle)
└── types/
    └── database.ts                      # All TypeScript types for the project
```

## Database

**`etm_products`** — ETM → URREA catalog (auto-learn)
```sql
id, etm (unique), description, description_es, model_code, price, brand,
created_at, updated_at, created_by
```

**`store_inventory`** — In-store stock
```sql
id, model_code (unique), quantity, updated_at
```

**`quotations`** — Quotations
```sql
id, name, customer_name, status, approval_token (unique), total_amount,
notes, created_at, updated_at, created_by
```
Statuses: `draft` → `sent_for_approval` → `approved` / `rejected` → `converted_to_order`

**`quotation_items`** — Quotation line items
```sql
id, quotation_id (FK), item_type ('product' | 'separator'), section_label,
etm, description, description_es, model_code, brand, unit_price, quantity,
is_approved (null = pending | true | false), delivery_time, sort_order, created_at
```

**`orders`** — Sales orders
```sql
id, name, customer_name, status, total_amount, created_at, updated_at, created_by
```
Statuses: `ordered` → `received` → `delivered` → `completed` / `cancelled`

**`order_items`** — Order line items
```sql
id, order_id (FK), item_type ('product' | 'separator'), section_label,
etm, model_code, description, brand, quantity_approved, quantity_in_stock,
quantity_to_order, quantity_received, urrea_status ('pending' | 'supplied' | 'not_supplied'),
delivery_time, unit_price, sort_order, created_at
```
Constraint: `quantity_in_stock + quantity_to_order = quantity_approved`

## Setup

### Prerequisites
- Bun
- Supabase account

### Local development

1. Clone the repository
```bash
git clone https://github.com/AxlGuillen/DYMMSA-WEB.git
cd DYMMSA-WEB
```

2. Install dependencies
```bash
bun install
```

3. Set up environment variables
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

4. Start the development server
```bash
bun dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Scripts

```bash
bun dev                # Development server
bun build              # Production build
bun start              # Start production server
bun lint               # Run ESLint
bun run test           # Run the test suite (Vitest)
bun run test:watch     # Run tests in watch mode
bun run test:coverage  # Run tests with coverage
```

> Use `bun run test` (not `bun test`): the latter invokes Bun's built-in runner and fails on `vitest` imports.

## Testing

Single runner: **Vitest** (`vitest.config.ts`) with two environments — `node` (backend) and `jsdom` (React components via Testing Library). Tests live in a top-level `tests/` folder that mirrors `src/`:

```
tests/
├── helpers/        # Supabase mock + request builders (makeRequest, makeExcelRequest)
├── lib/            # Pure functions (format, business-rules, auto-learn, inventory) — node
├── api/            # Route handlers with a mocked Supabase client — node
│   ├── smoke.test.ts
│   ├── auth-guards.test.ts
│   ├── quotations.test.ts
│   ├── orders.test.ts
│   └── imports.test.ts
└── components/     # React components — jsdom + Testing Library
```

Backend handlers are tested as **unit tests with a mocked Supabase client** (no real database): the mock reproduces the chainable query builder and records calls, so tests can assert auth guards, validation, rollback and inventory side effects. This covers the critical business rules (separators excluded from totals, stock deducted on order creation, rollback on failed inserts, `is_approved` preservation, auto-learn brand rules, `requireAuth` on every route, allocation invariant).

```bash
bun run test           # 180 tests
```

See `DYMMSA/04-Decisiones-Tecnicas/ADR-007-Estrategia-Testing.md` for the full rationale.

## Deployment

The project is configured for deployment on Vercel. Push to `main` to trigger an automatic deploy.
