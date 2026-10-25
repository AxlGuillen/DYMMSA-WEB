import { Brain } from '@/components/icons'
import { CONNECTOR_NAMES, MCP_PATH, ODOO_MCP_PATH } from '@/lib/mcp/core/routes'
import { groupByModule, type ToolManifestEntry } from '@/lib/mcp/manifest'
import { DocSection, List, Note, Sub } from './shared'

function ToolRow({ tool }: { tool: ToolManifestEntry }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="flex items-center gap-2 shrink-0">
        <span className="font-medium text-foreground">{tool.title}</span>
        {tool.kind === 'write' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">escribe</span>
        )}
        {tool.confirm === 'two_phase' && (
          <span
            className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/50 dark:text-sky-300"
            title={tool.direct ? 'Lo sencillo lo hace directo; lo delicado te lo muestra primero y solo escribe con tu si' : 'Primero te muestra el resumen y solo escribe con tu si'}
          >
            {tool.direct ? 'puede pedir tu si' : 'pide tu si'}
          </span>
        )}
      </span>
      <span className="text-muted-foreground">&ldquo;{tool.example}&rdquo;</span>
    </li>
  )
}

function Block({ entries }: { entries: readonly ToolManifestEntry[] }) {
  return (
    <div className="space-y-3">
      {groupByModule(entries).map((group) => (
        <div key={group.module}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.module}</p>
          <ul className="ml-4 mt-1 list-disc space-y-1">
            {group.tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Rendered from the catalog (src/lib/mcp/catalog.ts), never typed by hand; the page passes it in because it is server-only. */
export function AssistantSection({ tools }: { tools: readonly ToolManifestEntry[] }) {
  const app = tools.filter((t) => t.connector === 'dymmsa')
  const odoo = tools.filter((t) => t.connector === 'odoo')
  const appWrites = app.filter((t) => t.kind === 'write')
  const dymmsa = `«${CONNECTOR_NAMES.dymmsa}»`
  const odooName = `«${CONNECTOR_NAMES.odoo}»`

  return (
    <DocSection id="asistente" icon={Brain} title="Asistente (IA)" description={`Lo que puedes preguntarle o pedirle a Claude con los dos conectores de DYMMSA: ${tools.length} capacidades, ${app.length} de ${dymmsa} y ${odoo.length} de ${odooName}.`}>
      <Sub>Dos conectores</Sub>
      <List>
        <li><strong>{dymmsa}</strong> (<code>{MCP_PATH}</code>): la plataforma &mdash; cotizaciones, ordenes, inventario de la tienda, gastos, horas, tareas.</li>
        <li><strong>{odooName}</strong> (<code>{ODOO_MCP_PATH}</code>): la facturacion oficial en Odoo.</li>
        <li>Son independientes: puedes prender uno o los dos en un chat. No hay vinculo entre sus registros: una cotizacion de la plataforma no es una de Odoo aunque coincidan nombre o monto.</li>
      </List>

      <Sub>Como se conecta</Sub>
      <List>
        <li>Desde Claude (web, movil o escritorio) se agrega el conector y se inicia sesion <strong>con tu propia cuenta</strong> de la plataforma: el asistente ve exactamente lo que tu ves (un miembro no ve las horas de otros, por ejemplo).</li>
        <li>Para agregar {odooName}: en Claude, <strong>Configuracion &rarr; Conectores &rarr; Agregar conector personalizado</strong>; nombre {odooName} y como URL la misma de {dymmsa} cambiando <code>{MCP_PATH}</code> por <code>{ODOO_MCP_PATH}</code>. Se inicia sesion con la misma cuenta.</li>
        <li>Cuando se publican capacidades nuevas hay que <strong>reconectar</strong> el conector para que aparezcan.</li>
        <li>Antes de cualquier accion que escriba, el asistente te dice que va a hacer y espera tu confirmacion; si un nombre coincide con varias cosas, pregunta cual.</li>
        <li>Lo delicado (por ejemplo, cambiar las cifras de una factura ya pagada o reescribir una tarea) va en <strong>dos pasos</strong>: primero te muestra un resumen de lo que cambia y solo escribe cuando le das tu si. Las acciones que a veces lo piden llevan la etiqueta <em>puede pedir tu si</em>; lo sencillo (registrar una factura, comentar una tarea) lo hace directo.</li>
        {tools.some((t) => t.confirm === 'two_phase' && !t.direct) && (
          <li>Las que siempre piden tu si llevan la etiqueta <em>pide tu si</em>: borrar un registro o facturar en Odoo, por ejemplo.</li>
        )}
      </List>

      <Sub>{dymmsa}: lo que consulta por modulo</Sub>
      <Block entries={app} />

      <Sub>{dymmsa}: lo que puede hacer ({appWrites.length} acciones)</Sub>
      <ul className="ml-4 list-disc space-y-1.5">
        {appWrites.map((tool) => (
          <li key={tool.name}>
            <span className="font-medium text-foreground">{tool.title}</span>
            <span className="text-muted-foreground"> &mdash; &ldquo;{tool.example}&rdquo; </span>
            <span className="text-muted-foreground">Limite: {tool.limits}</span>
          </li>
        ))}
      </ul>
      <Note>
        Todo lo demas es <strong>solo lectura</strong>. En particular <strong>nunca</strong> cambia cantidades de inventario, ni crea, edita o borra
        cotizaciones u ordenes: eso se hace en la app.
      </Note>

      <Sub>{odooName}: la facturacion oficial</Sub>
      <p className="text-muted-foreground">
        El asistente lee de Odoo facturas, pagos y sus complementos (REP), ventas, clientes, existencias del almacen de Odoo, el directorio de
        empleados y la flotilla. En Odoo <strong>nunca publica, timbra ni envia</strong> facturas y nunca entra a nomina ni salarios.
      </p>
      <Block entries={odoo} />
    </DocSection>
  )
}
