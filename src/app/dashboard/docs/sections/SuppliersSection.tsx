import { Truck } from '@/components/icons'
import { DocSection, List, Note } from './shared'

export function SuppliersSection() {
  return (
    <DocSection id="proveedores" icon={Truck} title="Proveedores" description="Directorio de proveedores de menudeo con su contacto, las marcas que surten y su plazo de pago.">
      <List>
        <li><strong>Contacto:</strong> nombre (unico), telefono, WhatsApp, correo, direccion y notas.</li>
        <li><strong>Marcas:</strong> cada proveedor lleva las marcas que surte (SURTEK, FOY, Truper...). Las marcas son un catalogo global; no se puede borrar una marca que algun proveedor tenga asignada.</li>
        <li><strong>Plazo de pago:</strong> dias de credito elegidos de una lista (1 semana, 15 dias, 1 mes, 2 meses, 3 meses) o &ldquo;Otro&rdquo; con el numero exacto. Vacio = contado.</li>
        <li>Filtra la lista por texto (nombre, telefono, correo) o por marca.</li>
      </List>
      <Note>
        El plazo de pago es el que <strong>pre-llena el vencimiento</strong> al registrar una factura por pagar de ese proveedor (ver Finanzas).
        Un proveedor con facturas registradas no se puede eliminar.
      </Note>
    </DocSection>
  )
}
