import { Scissors } from '@/components/icons'
import { DocSection, List, Note, Sub } from './shared'

export function CuttingSection() {
  return (
    <DocSection id="corte" icon={Scissors} title="Planificar corte y medidas de material" description="Para los productos DYMMSA que se mandan a hacer (tubo y placa de cobre): cuanto material pedir y como se acomoda.">
      <p className="text-muted-foreground">
        Dos entradas: <strong>Planificar corte</strong> desde una orden (guarda la lista de piezas) o desde el menu como
        <strong> corte rapido</strong> (efimero: las piezas viven solo en tu navegador, sirve para cotizar material sin orden).
        Desde una cotizacion con piezas DYMMSA hay un boton que las lleva al corte rapido ya capturadas.
      </p>
      <Sub>Como se captura</Sub>
      <List>
        <li>Todas las medidas en <strong>milimetros</strong>. Tubo: diametro y largo. Placa: espesor, ancho y largo.</li>
        <li>El campo &ldquo;pedido como&rdquo; guarda lo que pidio el cliente (ej. 1/2&quot;) junto a la medida real que se usara.</li>
        <li>Los productos del catalogo ETM con medidas nominales <strong>pre-llenan</strong> la lista, pero la verdad es lo que capturas aqui.</li>
      </List>
      <Sub>Como calcula</Sub>
      <List>
        <li><strong>Necesidad neta</strong> = (largo + margen de corte) &times; cantidad. Sobreestima a proposito: es la cifra para pedir.</li>
        <li>El <strong>margen por corte</strong> (default 20 mm, 0 es valido) se configura una vez y se cobra en cada particion.</li>
        <li><strong>Tubo</strong> se pide por barras: al elegir el largo de barra del proveedor, te dice cuantas salen y cuanto sobra.</li>
        <li><strong>Placa</strong> se pide por hoja de medida fija (ancho &times; largo). Las piezas se acomodan por carriles a lo largo de la hoja y se <strong>rotan 90&deg;</strong> si asi caben (se puede apagar por espesor cuando el material tiene veta). El diagrama pinta el paso de la sierra y el sobrante.</li>
      </List>
      <Sub>Medidas de material</Sub>
      <p className="text-muted-foreground">
        Las presentaciones del proveedor (&ldquo;barras de 6 m&rdquo;, &ldquo;hoja de 1220 &times; 2440&rdquo;) se aprenden solas al capturarlas y se administran en
        <strong> Medidas de material</strong>: alta manual y borrado de las erroneas.
      </p>
      <Note>
        El material de corte <strong>no</strong> entra al Pedido URREA ni a la compra local: tiene su propio Excel desde la pantalla de corte de la orden.
      </Note>
    </DocSection>
  )
}
