# Módulo: Dashboard

> **Módulos enlazados:** [[03-Modulos/Cotizador]], [[03-Modulos/Ordenes]], [[03-Modulos/Inventario]], [[03-Modulos/Catalogo-ETM]]  
> **Layout:** [[02-Arquitectura/Estructura-de-Carpetas#src/app/dashboard/|src/app/dashboard/layout.tsx]]

## Propósito

Vista principal del área autenticada. Muestra métricas de negocio, acceso rápido a módulos y estado del sistema.

## Métricas mostradas

- Total de cotizaciones (por estado)
- Total de órdenes (por estado)
- Monto total en cotizaciones activas
- Monto total en órdenes activas
- Stock total en inventario
- Productos en catálogo ETM

## Componentes

| Componente | Ruta | Rol |
|-----------|------|-----|
| `DashboardMetrics` | `src/components/dashboard/DashboardMetrics.tsx` | Contenedor de todas las métricas |
| `MetricCard` | `src/components/dashboard/MetricCard.tsx` | Card individual de métrica con icono, valor, label |
| `OrderStatusBreakdown` | `src/components/dashboard/OrderStatusBreakdown.tsx` | Desglose de órdenes por estado |

## Stats cards con filtros activos

Las páginas de **Cotizaciones**, **Órdenes** e **Inventario** tienen stats cards en la parte superior que funcionan como filtros rápidos: al hacer click en una card, se aplica el filtro correspondiente a la tabla.

## Layout del área autenticada

`src/app/dashboard/layout.tsx` — incluye:
- `Sidebar` (`src/components/layout/Sidebar.tsx`) — navegación lateral con links a módulos
- `Navbar` (`src/components/layout/Navbar.tsx`) — header con toggle de tema y botón de logout (con dialog de confirmación)

## Hook

- `useDashboard.ts` — `useStatusCounts()` — consulta conteos por estado de órdenes y cotizaciones.

## Archivos relevantes

- `src/app/dashboard/page.tsx`
- `src/components/dashboard/`
- `src/components/layout/`
- `src/hooks/useDashboard.ts`
