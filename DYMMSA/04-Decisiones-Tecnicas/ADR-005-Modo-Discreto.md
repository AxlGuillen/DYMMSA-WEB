# ADR-005: Modo Discreto — Enmascarar valores monetarios

> **Estado:** Implementado 2026-05-07  
> **Fase:** 6 — Mejoras UX  
> **Archivos clave:** `src/stores/discreteModeStore.ts`, `src/hooks/useCurrency.ts`, `src/components/discrete-mode-toggle.tsx`

---

## Contexto

DYMMSA necesita poder mostrar la aplicación a personas externas (clientes, proveedores, socios) sin revelar información financiera sensible. El objetivo era una solución tipo "botón de privacidad bancaria": un toggle global, persistente y de un solo clic.

---

## Decisión

### 1. Zustand + localStorage para el estado global

Se creó `discreteModeStore` siguiendo exactamente el patrón de `quotationStore` (el único store existente):

```ts
export const useDiscreteModeStore = create<DiscreteModeStore>()(
  persist(
    (set) => ({
      isDiscreteMode: false,
      toggleDiscreteMode: () => set((state) => ({ isDiscreteMode: !state.isDiscreteMode })),
    }),
    { name: 'dymmsa-discrete-mode' }
  )
)
```

**Alternativa descartada:** React Context. Requería un Provider adicional en el layout y más boilerplate. Zustand ya era el patrón establecido y funciona sin Provider.

### 2. `useCurrency` devuelve una función, no un valor

```ts
export function useCurrency() {
  const isDiscreteMode = useDiscreteModeStore((s) => s.isDiscreteMode)
  return (value: number | null | undefined): string => {
    if (value == null) return '—'
    if (isDiscreteMode) return '$•,•••.••'
    return `$${value.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
  }
}
```

**Por qué retornar una función y no un valor:** Los componentes usan `.map()` para renderizar tablas. Si el hook devolviera un valor, habría que llamarlo una vez por cada ítem — violando las reglas de hooks ("no se puede llamar dentro de callbacks"). Al devolver una función formateadora, se llama el hook una sola vez al inicio del componente y la función `fmt` se usa libremente dentro de cualquier `.map()`.

**Patrón de uso:**
```tsx
const fmt = useCurrency()  // una llamada
items.map(item => <td>{fmt(item.unit_price)}</td>)  // ✅ función normal
```

### 3. Centralización del formato de moneda

La función local `formatCurrency` que existía en `DashboardMetrics.tsx` fue eliminada. Ahora existe un solo lugar donde se define el formato `es-MX` con `minimumFractionDigits: 2`. Esto también corrigió inconsistencias donde algunos sitios omitían los decimales.

### 4. Máscara elegida: `$•,•••.••`

Mantiene la estructura visual de un número monetario (separadores de miles, decimales) pero oculta los dígitos. El usuario externo entiende que hay un precio, pero no puede leerlo.

### 5. La página de aprobación pública (`/approve/[token]`) queda excluida

Esta página es vista por los **clientes** para que aprueben o rechacen ítems. Si se enmascararan los precios, el cliente no podría tomar una decisión informada. Por tanto, `ApprovalClient.tsx` no importa `useCurrency` ni `useDiscreteModeStore`.

El modo discreto solo aplica a las páginas autenticadas del sistema interno.

---

## Consecuencias

- Todos los valores monetarios en la app autenticada se renderizan vía `useCurrency()`.
- Agregar un nuevo componente que muestre precios: importar `useCurrency`, llamar `const fmt = useCurrency()` al inicio del componente, usar `fmt(value)` en el render.
- La máscara `$•,•••.••` es consistente en toda la app.
- El estado persiste entre sesiones (localStorage), igual que el tema claro/oscuro.

---

## Archivos creados / modificados

| Acción | Archivo |
|--------|---------|
| Nuevo | `src/stores/discreteModeStore.ts` |
| Nuevo | `src/hooks/useCurrency.ts` |
| Nuevo | `src/components/discrete-mode-toggle.tsx` |
| Toggle UI | `src/components/layout/Sidebar.tsx` |
| Consumidor | `src/components/quotations/QuotationsTable.tsx` |
| Consumidor | `src/components/quotations/QuotationDetail.tsx` |
| Consumidor | `src/components/orders/OrdersTable.tsx` |
| Consumidor | `src/components/orders/OrderDetail.tsx` |
| Consumidor | `src/components/orders/NewOrderForm.tsx` |
| Consumidor | `src/components/quoter/QuotePreview.tsx` |
| Consumidor | `src/components/quoter/QuotationEditor.tsx` |
| Consumidor (eliminó `formatCurrency` local) | `src/components/dashboard/DashboardMetrics.tsx` |
| No modificado (intencional) | `src/app/approve/[token]/ApprovalClient.tsx` |

---

**Ver también:** [[02-Arquitectura/Estructura-de-Carpetas]] · [[05-Fases/Fase-6-Mejoras]]
