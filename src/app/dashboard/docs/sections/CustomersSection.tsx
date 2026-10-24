import { Contact } from '@/components/icons'
import { DocSection, List, Note, Sub } from './shared'

export function CustomersSection() {
  return (
    <DocSection id="clientes" icon={Contact} title="Clientes" description="La cartera de los clientes de Odoo y su estado de cuenta listo para mandar.">
      <Sub>Cartera</Sub>
      <List>
        <li>Los clientes y sus facturas se <strong>leen de Odoo</strong> (no se copian): se guardan 15 minutos; <strong>Actualizar</strong> trae lo último.</li>
        <li>El rango es por <strong>fecha de vencimiento</strong>. Sin &ldquo;desde&rdquo; entra todo lo vencido; por defecto llega hasta el fin del mes en curso.</li>
        <li>Elige si ver solo vencidas, solo por vencer o ambas. Una factura que vence <strong>hoy</strong> todavia cuenta como por vencer.</li>
        <li><strong>Solo con saldo</strong> esconde a quien no debe nada en el rango ni tiene notas de credito; la busqueda filtra por nombre o ciudad.</li>
      </List>
      <Sub>Estado de cuenta</Sub>
      <List>
        <li>Al abrir un cliente ves su contacto (telefono, correo y RFC), lo que debe, cada factura abierta con su <strong>saldo</strong> (lo que falta tras pagos parciales) y sus ultimas ventas y pagos.</li>
        <li><strong>Excel</strong> e <strong>Imprimir</strong> (tambien sirve para guardar PDF) usan el mismo rango de la pantalla.</li>
        <li>Los montos nunca se convierten: una factura en dolares lleva su moneda al lado y los totales avisan que la incluyen sin convertir.</li>
      </List>
      <Note>
        Lo que se manda al cliente lleva solo su nombre, folios, fechas y montos: <strong>ni RFC ni datos de contacto</strong>.
        Las notas de credito sin aplicar se muestran aparte como saldo a favor y <strong>no se restan</strong> de lo que debe.
        El asistente da la misma informacion con el conector «Odoo DYMMSA»: pidele el estado de cuenta de un cliente con su periodo.
      </Note>
    </DocSection>
  )
}
