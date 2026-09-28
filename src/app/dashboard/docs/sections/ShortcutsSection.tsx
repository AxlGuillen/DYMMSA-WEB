import { Sparkles } from '@/components/icons'
import { DocSection, List } from './shared'

export function ShortcutsSection() {
  return (
    <DocSection id="atajos" icon={Sparkles} title="Tablas, vistas guiadas y atajos" description="Lo que aplica en todas las pantallas y no pertenece a un modulo.">
      <List>
        <li><strong>Vista guiada:</strong> el boton con el icono de ayuda en cada pantalla explica sus bloques. Es opcional y nunca arranca sola.</li>
        <li><strong>Columnas a tu medida:</strong> en las tablas principales puedes ocultar columnas (selector de columnas) y ajustar su ancho arrastrando el borde del encabezado, como en Excel. Se recuerda por tabla en tu navegador.</li>
        <li><strong>Filtro por marca</strong> en Inventario, Planificar compra y Catalogo URREA. En Inventario, &ldquo;Sin marca&rdquo; es una categoria filtrable.</li>
        <li><strong>Colores en las secciones</strong> de una cotizacion: cada separador puede llevar su color (o el automatico) y viaja a la orden y a la pagina de aprobacion.</li>
        <li><strong>Formato de fecha:</strong> selector en Finanzas y Horas para ver las fechas largas o cortas; se recuerda en tu navegador.</li>
        <li><strong>Novedades</strong> tiene dos pestañas: lo que cambio para ti (en lenguaje simple) y <strong>Actividad</strong>, la bitacora tecnica del desarrollo. Cuando una novedad menciona una tarea como <code className="rounded bg-muted px-1">#12</code>, es un enlace a la tarea.</li>
        <li><strong>Modo discreto y sonidos:</strong> en el menu lateral, para ocultar montos en pantalla y apagar los clics.</li>
      </List>
    </DocSection>
  )
}
