import { DollarSign } from '@/components/icons'
import { DocSection, List, Note, Sub } from './shared'

export function FinanceSection() {
  return (
    <DocSection id="finanzas" icon={DollarSign} title="Finanzas" description="Las facturas por pagar (gastos propios) y el cierre del mes contra los ingresos que se leen de Odoo.">
      <Note>
        La <strong>facturacion oficial</strong> de la empresa (facturas a clientes, cobros, CFDI) vive en <strong>Odoo</strong>. Aqui se registran
        los <strong>gastos</strong> por pagar y se leen los ingresos de Odoo para ver el cierre; la app nunca escribe en Odoo.
      </Note>
      <Sub>Facturas por pagar</Sub>
      <List>
        <li>Se capturan con proveedor, concepto, monto, fecha de factura y vencimiento. El vencimiento se <strong>pre-llena</strong> con la fecha mas el plazo del proveedor y se puede editar.</li>
        <li>Estados: <strong>Pendiente</strong> (asi nace siempre), <strong>Pagada</strong> y <strong>Cancelada</strong>.</li>
        <li>Al marcar pagada (boton ✓ o desde el popup de editar) se guarda la <strong>fecha real de pago</strong>: por default hoy, o la que captures. Esa fecha es la que manda para el mes, no el vencimiento. Regresar a pendiente la limpia.</li>
        <li>Filtros por estado, mes de vencimiento, proveedor, rango de monto y texto del concepto. Las fechas se muestran en el formato que elijas (selector junto a los filtros).</li>
        <li>Los administradores ven ademas <strong>quien</strong> marco cada factura como pagada y el historial de cambios en el popup.</li>
      </List>
      <Sub>Overview del mes</Sub>
      <List>
        <li><strong>Egresos:</strong> pendiente del mes por semana de vencimiento, vencido (incluye lo arrastrado de meses anteriores), por vencer en 7 dias y pagado en el mes. Las canceladas no cuentan en nada.</li>
        <li><strong>Ingresos (Odoo):</strong> lo cobrado en el mes por fecha real de pago, lo facturado por cobrar y lo vencido por cobrar. Se refresca cada 15 minutos o con el boton de actualizar.</li>
        <li><strong>Notas de credito sin aplicar</strong> se muestran aparte como saldo a favor del cliente y <strong>nunca se restan</strong> del por cobrar: no se sabe si el cliente la usara.</li>
        <li><strong>Cierre:</strong> real = cobrado &minus; pagado; proyectado = real &minus; pendiente del mes &minus; vencido arrastrado.</li>
      </List>
      <Note>
        Si Odoo no responde, la pantalla lo dice y muestra solo egresos: nunca se queda en blanco.
      </Note>
    </DocSection>
  )
}
