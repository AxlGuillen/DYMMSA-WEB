import { ShoppingCart } from '@/components/icons'
import { DocSection, List, Note, Sub } from './shared'

export function PurchasePlannerSection() {
  return (
    <DocSection id="compra" icon={ShoppingCart} title="Planificar compra (mayoreo vs menudeo)" description="Dentro de cada orden: decide que se pide a URREA por paquetes y que se compra al menudeo. De aqui salen los dos Excel de compra.">
      <p className="text-muted-foreground">
        Boton <strong>Planificar compra</strong> en el detalle de la orden. El sistema junta lo que hay que pedir
        <strong> por codigo y marca</strong> (si el mismo producto aparece en dos secciones, se suma antes de decidir) y
        compara contra el <strong>STD</strong> del catalogo URREA (piezas por paquete).
      </p>
      <Sub>Como decide</Sub>
      <List>
        <li>Lo que cabe en paquetes completos va a URREA tal cual. La decision es sobre el <strong>resto</strong> (lo que sobra del ultimo paquete).</li>
        <li><strong>Recomendacion automatica:</strong> si redondear al paquete deja parado mas dinero que el umbral (default $100), sugiere comprar el resto al menudeo; si el resto es casi un paquete completo (80% o mas), te pide <strong>revisar</strong> y decidir tu; si no, sugiere redondear.</li>
        <li>Puedes elegir <strong>mayoreo</strong>, <strong>menudeo</strong> o <strong>mixto</strong> por grupo. Con grupos en &ldquo;Revisar&rdquo; sin decidir no se guarda ni se genera el Excel.</li>
        <li>El precio que usa para el dinero parado es el de venta (promedio de las lineas con precio); los productos sin precio quedan en un bloque aparte y solo aplica la regla del porcentaje.</li>
        <li>Lo que <strong>no esta en el catalogo URREA</strong> (ninguna de sus marcas) va directo a <strong>compra local</strong>.</li>
      </List>
      <Sub>Los dos Excel</Sub>
      <List>
        <li><strong>Pedido URREA</strong>: piezas = paquetes &times; STD, de todo lo que esta en el catalogo (URREA, SURTEK, FOY...). Boton <strong>Copiar para Excel</strong> pega <code className="rounded bg-muted px-1">codigo⇥cantidad</code> en el Excel viejo de URREA.</li>
        <li><strong>Compra local</strong>: lo que no esta en el catalogo mas los restos que decidiste comprar al menudeo.</li>
        <li>Si hay cambios en pantalla, el boton <strong>guarda primero y luego genera</strong>: el archivo siempre refleja lo decidido.</li>
      </List>
      <Note>
        La decision se guarda <strong>por orden</strong>. Si despues cambia la cantidad a pedir o el STD del catalogo, la decision aparece como
        <strong> desactualizada</strong> para que la revises. Los umbrales se ajustan arriba de la pagina y aplican a todas las ordenes.
      </Note>
    </DocSection>
  )
}
