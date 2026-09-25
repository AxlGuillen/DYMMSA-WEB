import { Brain } from '@/components/icons'
import { groupByModule, manifestFor, TOOL_MANIFEST, type ToolManifestEntry } from '@/lib/mcp/manifest'
import { DocSection, List, Note, Sub } from './shared'

function ToolRow({ tool }: { tool: ToolManifestEntry }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <span className="flex items-center gap-2 shrink-0">
        <span className="font-medium text-foreground">{tool.title}</span>
        {tool.kind === 'write' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">escribe</span>
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

/** Rendered from the manifest, never typed by hand: tests/mcp/manifest.test.ts keeps it in sync with server.ts. */
export function AssistantSection() {
  const app = manifestFor('app')
  const odoo = manifestFor('odoo')
  const writes = TOOL_MANIFEST.filter((t) => t.kind === 'write')

  return (
    <DocSection id="asistente" icon={Brain} title="Asistente (IA)" description={`Lo que puedes preguntarle o pedirle a Claude conectado a la plataforma: ${TOOL_MANIFEST.length} capacidades, ${app.length} de la app y ${odoo.length} de Odoo.`}>
      <Sub>Como se conecta</Sub>
      <List>
        <li>Desde Claude (web, movil o escritorio) se agrega el conector de DYMMSA y se inicia sesion <strong>con tu propia cuenta</strong> de la plataforma: el asistente ve exactamente lo que tu ves (un miembro no ve las horas de otros, por ejemplo).</li>
        <li>Cuando se publican capacidades nuevas hay que <strong>reconectar</strong> el conector para que aparezcan.</li>
        <li>Antes de cualquier accion que escriba, el asistente te dice que va a hacer y espera tu confirmacion; si un nombre coincide con varias cosas, pregunta cual.</li>
      </List>

      <Sub>Plataforma: lo que consulta por modulo</Sub>
      <Block entries={app} />

      <Sub>Plataforma: lo que puede hacer ({writes.length} acciones)</Sub>
      <ul className="ml-4 list-disc space-y-1.5">
        {writes.map((tool) => (
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

      <Sub>Odoo: la facturacion oficial (solo lectura)</Sub>
      <p className="text-muted-foreground">
        El asistente lee de Odoo facturas, pagos y sus complementos (REP), ventas, clientes, existencias del almacen de Odoo, el directorio de
        empleados y la flotilla. <strong>Nunca escribe</strong> en Odoo, nunca entra a nomina ni salarios, y no cruza sus datos con los de la
        app: las cotizaciones de aqui y las facturas de Odoo son mundos separados.
      </p>
      <Block entries={odoo} />
    </DocSection>
  )
}
