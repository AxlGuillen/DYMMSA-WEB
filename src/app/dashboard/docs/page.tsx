'use client'

import Link from 'next/link'
import {
  FileSpreadsheet,
  CheckCircle2,
  Warehouse,
  ArrowRight,
  ArrowDown,
  BookOpen,
  ClipboardList,
  Send,
  Brain,
  Pencil,
  Plus,
  Trash2,
  ExternalLink,
  Package,
  Download,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const sections = [
  { id: 'cotizar', label: 'Excel para Cotizar', icon: FileSpreadsheet },
  { id: 'cotizaciones', label: 'Cotizaciones y Flujo', icon: ClipboardList },
  { id: 'aprobado', label: 'Excel Aprobado (Verdes)', icon: CheckCircle2 },
  { id: 'inventario', label: 'Excel de Inventario', icon: Warehouse },
  { id: 'ordenes', label: 'Detalle de Orden', icon: Package },
  { id: 'flujo', label: 'Flujo del Sistema', icon: ArrowRight },
]

type VariantColor = 'green' | 'amber' | 'red' | 'blue'

type FlowVariant = {
  label: string
  description: string
  color: VariantColor
  endsFlow?: boolean
}

type FlowStep = {
  number: number
  title: string
  description: string
  variants?: FlowVariant[]
}

const variantBorderBg: Record<VariantColor, string> = {
  green: 'border-l-2 border-l-green-400 bg-green-50 dark:border-l-green-700 dark:bg-green-950/20',
  amber: 'border-l-2 border-l-amber-400 bg-amber-50 dark:border-l-amber-700 dark:bg-amber-950/20',
  red:   'border-l-2 border-l-red-400 bg-red-50 dark:border-l-red-700 dark:bg-red-950/20',
  blue:  'border-l-2 border-l-blue-400 bg-blue-50 dark:border-l-blue-700 dark:bg-blue-950/20',
}

const variantBadge: Record<VariantColor, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  red:   'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  blue:  'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
}

const flowSteps: FlowStep[] = [
  {
    number: 1,
    title: 'Crear la cotizacion',
    description: 'Ingresa los productos a cotizar desde el Cotizador.',
    variants: [
      {
        label: 'Subiendo Excel del cliente',
        description: 'Sube el Excel con ETMs. El sistema extrae y pre-rellena automaticamente todos los campos reconocidos.',
        color: 'blue',
      },
      {
        label: 'Manualmente',
        description: 'Agrega productos uno a uno con el modal de producto, sin necesitar un archivo.',
        color: 'blue',
      },
    ],
  },
  {
    number: 2,
    title: 'Revisar, editar y guardar',
    description: 'Ajusta la tabla (precios, cantidades, descripciones), agrega o elimina filas. Al guardar, la cotizacion queda en BD y el catalogo de productos se actualiza automaticamente con los datos ingresados.',
  },
  {
    number: 3,
    title: 'Enviar a aprobacion',
    description: 'El sistema genera un link unico (token) que puedes compartir con el cliente por WhatsApp o correo. La cotizacion pasa a estado En aprobacion.',
  },
  {
    number: 4,
    title: 'Respuesta del cliente',
    description: 'El cliente accede al link sin necesidad de cuenta y decide sobre cada producto de forma individual.',
    variants: [
      {
        label: 'Aprueba todos',
        description: 'Cotizacion pasa a Aprobada. Todos los productos estan disponibles para generar la orden.',
        color: 'green',
      },
      {
        label: 'Aprueba algunos (parcial)',
        description: 'Cotizacion pasa a Aprobada. Solo los productos marcados como aprobados entran a la orden; los rechazados se ignoran.',
        color: 'amber',
      },
      {
        label: 'Rechaza todos',
        description: 'Cotizacion marcada como Rechazada. No se genera orden. El flujo termina aqui.',
        color: 'red',
        endsFlow: true,
      },
    ],
  },
  {
    number: 5,
    title: 'Crear orden desde la cotizacion aprobada',
    description: 'El sistema verifica el inventario de la tienda por cada producto aprobado y calcula automaticamente cuanto hay que pedir a URREA.',
    variants: [
      {
        label: 'Stock completo',
        description: 'El producto esta disponible en tienda. quantity_to_order = 0; no se pide a URREA.',
        color: 'green',
      },
      {
        label: 'Stock parcial',
        description: 'Se aparta lo disponible en tienda y se calcula el faltante para pedirlo a URREA.',
        color: 'amber',
      },
      {
        label: 'Sin stock',
        description: 'Todo el producto debe pedirse a URREA. quantity_to_order = quantity_approved.',
        color: 'red',
      },
    ],
  },
  {
    number: 6,
    title: 'Pedido a URREA',
    description: 'Aplica unicamente si hay productos con quantity_to_order > 0.',
    variants: [
      {
        label: 'Hay faltantes URREA',
        description: 'Descarga el Excel en formato URREA (model_code + quantity) y envialo por WhatsApp. Solo se incluyen productos de marca URREA; otras marcas (Stanley, Truper...) quedan excluidas con una notificacion.',
        color: 'blue',
      },
      {
        label: 'Todo cubierto con stock',
        description: 'No hay productos que pedir a URREA. Este paso se omite y la orden avanza directamente a gestion de pago.',
        color: 'green',
      },
    ],
  },
  {
    number: 7,
    title: 'Recepcion de productos de URREA',
    description: 'Cuando llegan los productos, registra la cantidad recibida y el estado por cada item en el detalle de la orden.',
    variants: [
      {
        label: 'URREA surte todo',
        description: 'Marca cada item como supplied con la cantidad completa y confirma la recepcion.',
        color: 'green',
      },
      {
        label: 'URREA surte parcial',
        description: 'Registra la cantidad recibida por item. Los no surtidos se marcan como not_supplied para gestionarlos con el cliente.',
        color: 'amber',
      },
      {
        label: 'URREA no surte',
        description: 'Items marcados como not_supplied. Gestionar con el cliente si se consiguen de otra fuente o se cancela esa parte.',
        color: 'red',
      },
    ],
  },
  {
    number: 8,
    title: 'Confirmar recepcion',
    description: 'Al confirmar, el inventario de la tienda se actualiza automaticamente sumando las cantidades recibidas de URREA.',
  },
  {
    number: 9,
    title: 'Cierre de la orden',
    description: 'Avanza el estado de la orden hasta completarla o cancelarla.',
    variants: [
      {
        label: 'Completada',
        description: 'Recibido de URREA → Pago pendiente → Pagado → Completado. Cada transicion actualiza el estado en el sistema.',
        color: 'green',
      },
      {
        label: 'Cancelada',
        description: 'Si la orden se cancela en cualquier punto, el inventario apartado se restaura automaticamente.',
        color: 'red',
      },
    ],
  },
]

export default function DocsPage() {
  return (
    <div className="docs-page-bg -mx-4 -my-8 px-4 py-8">
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <BookOpen className="h-8 w-8" />
          Documentacion
        </h1>
        <p className="mt-2 text-muted-foreground">
          Guia de formatos de Excel y flujo completo del sistema.
        </p>
      </div>

      {/* Quick index */}
      <div className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle>Indice rapido</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sections.map((section) => {
              const Icon = section.icon
              return (
                <Link
                  key={section.id}
                  href={`#${section.id}`}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {section.label}
                </Link>
              )
            })}
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Section 1: Excel para Cotizar */}
      <div id="cotizar" className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Formato Excel para Cotizar (Matcher)
          </CardTitle>
          <CardDescription>
            Formato del archivo Excel que sube el cliente para generar una
            cotizacion.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p>
              El archivo debe contener al menos una columna llamada{' '}
              <strong>ETM</strong> (no importa mayusculas o minusculas). El
              sistema procesa <strong>todas las hojas</strong> del archivo y
              busca esa columna en cada una.
            </p>
            <p>
              Ademas del ETM, el sistema reconoce columnas opcionales que{' '}
              <strong>pre-rellenan automaticamente la tabla del cotizador</strong>,
              reduciendo el trabajo manual. Si una columna no esta en el Excel o
              viene vacia, el campo queda en blanco para llenarlo a mano.
            </p>
          </div>

          <div className="space-y-2 text-sm">
            <p className="font-medium">Columnas reconocidas:</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Columna</TableHead>
                  <TableHead>Obligatoria</TableHead>
                  <TableHead>Descripcion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">ETM</code></TableCell>
                  <TableCell className="font-medium text-green-600 dark:text-green-400">Si</TableCell>
                  <TableCell>Codigo ETM del producto. Sin el no se puede procesar la fila.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">description</code></TableCell>
                  <TableCell className="text-muted-foreground">No</TableCell>
                  <TableCell>Descripcion del producto en ingles.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">description_es</code></TableCell>
                  <TableCell className="text-muted-foreground">No</TableCell>
                  <TableCell>Descripcion del producto en espanol.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">model_code</code></TableCell>
                  <TableCell className="text-muted-foreground">No</TableCell>
                  <TableCell>Codigo URREA del producto.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">quantity</code></TableCell>
                  <TableCell className="text-muted-foreground">No</TableCell>
                  <TableCell>Cantidad solicitada. Si no viene, se puede ingresar manualmente en la tabla.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">price</code></TableCell>
                  <TableCell className="text-muted-foreground">No</TableCell>
                  <TableCell>Precio unitario del producto.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell><code className="rounded bg-muted px-1">brand</code></TableCell>
                  <TableCell className="text-muted-foreground">No</TableCell>
                  <TableCell>Marca del producto (ej. URREA, Stanley, Truper).</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm space-y-1">
            <p className="font-medium">Como funciona el pre-relleno</p>
            <ol className="ml-4 list-decimal space-y-1 text-muted-foreground">
              <li>El sistema lee las columnas reconocidas del Excel y las carga en la tabla del cotizador.</li>
              <li>Por cada ETM, contrasta los datos del Excel con la base de datos interna. Si hay informacion en BD que falta en el Excel, la completa automaticamente.</li>
              <li>Los campos que no se pudieron rellenar quedan editables para captura manual.</li>
              <li>Cualquier columna del Excel que no este en la lista de arriba se ignora.</li>
            </ol>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Ejemplo con columnas opcionales:</p>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ETM</TableHead>
                    <TableHead>description_es</TableHead>
                    <TableHead>model_code</TableHead>
                    <TableHead>quantity</TableHead>
                    <TableHead>price</TableHead>
                    <TableHead>brand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-mono">ETM-12345</TableCell>
                    <TableCell>Llave combinada 1/2&quot;</TableCell>
                    <TableCell className="font-mono">1234A</TableCell>
                    <TableCell>10</TableCell>
                    <TableCell>$150.00</TableCell>
                    <TableCell>URREA</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono">ETM-67890</TableCell>
                    <TableCell>Desarmador plano</TableCell>
                    <TableCell className="font-mono">5678B</TableCell>
                    <TableCell>5</TableCell>
                    <TableCell>$85.00</TableCell>
                    <TableCell>Stanley</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono">ETM-11111</TableCell>
                    <TableCell className="text-muted-foreground italic">— (vacio)</TableCell>
                    <TableCell className="text-muted-foreground italic">— (vacio)</TableCell>
                    <TableCell>3</TableCell>
                    <TableCell className="text-muted-foreground italic">— (vacio)</TableCell>
                    <TableCell className="text-muted-foreground italic">— (vacio)</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              La tercera fila solo tiene ETM y quantity. El sistema buscara el resto de los datos en
              la base de datos; si no los encuentra, los campos quedaran en blanco para completarlos en el cotizador.
            </p>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Section 2: Cotizaciones y Flujo */}
      <div id="cotizaciones" className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Cotizaciones y Flujo
          </CardTitle>
          <CardDescription>
            Como crear, gestionar y aprobar cotizaciones, y que puedes hacer en cada etapa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Crear cotizacion */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base">Crear una cotizacion</p>
            <p className="text-muted-foreground">
              Desde el <strong>Cotizador</strong> puedes iniciar una nueva cotizacion de dos formas:
            </p>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>
                <strong>Subiendo el Excel del cliente</strong> — el sistema extrae los ETMs y columnas reconocidas
                y pre-rellena la tabla automaticamente (ver seccion anterior).
              </li>
              <li>
                <strong>Agregando productos manualmente</strong> — usa el boton &ldquo;Agregar producto&rdquo;
                para abrir el modal e ingresar los datos a mano, sin necesitar un Excel.
              </li>
            </ul>
            <p className="text-muted-foreground">
              La tabla es completamente editable: puedes modificar cualquier campo de cualquier fila (descripcion,
              modelo, precio, cantidad, marca) usando el modal de edicion por producto. El estado de la
              tabla se guarda localmente mientras trabajas, por lo que puedes recargar la pagina sin perder
              el avance.
            </p>
          </div>

          {/* Guardar */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              Guardar y auto-aprendizaje
            </p>
            <p className="text-muted-foreground">
              Al hacer clic en <strong>&ldquo;Guardar cotizacion&rdquo;</strong> ocurren dos cosas en paralelo:
            </p>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>
                Se crea el registro de cotizacion en la base de datos con todos sus productos (estado: <strong>Borrador</strong>).
              </li>
              <li>
                El sistema actualiza el catalogo de productos de forma automatica: si el ETM es nuevo lo inserta,
                y si ya existe pero los datos cambiaron (precio, marca, descripcion) los actualiza. Esto mantiene
                la base de datos siempre al dia sin trabajo manual.
              </li>
            </ul>
          </div>

          {/* Estados */}
          <div className="space-y-3 text-sm">
            <p className="font-medium text-base">Estados de una cotizacion</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border px-2.5 py-0.5 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-medium">Borrador</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="rounded-full border px-2.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-medium">En aprobacion</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="flex items-center gap-2">
                <span className="rounded-full border px-2.5 py-0.5 bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 font-medium">Aprobada</span>
                <span className="text-muted-foreground">/</span>
                <span className="rounded-full border px-2.5 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 font-medium">Rechazada</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="rounded-full border px-2.5 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 font-medium">Convertida a orden</span>
            </div>
            <div className="space-y-1 text-muted-foreground">
              <p><strong className="text-foreground">Borrador</strong> — cotizacion en construccion, aun no enviada al cliente.</p>
              <p><strong className="text-foreground">En aprobacion</strong> — se genero el link y se compartio con el cliente. Esperando su decision.</p>
              <p><strong className="text-foreground">Aprobada</strong> — el cliente aprobo al menos un producto. Lista para generar una orden.</p>
              <p><strong className="text-foreground">Rechazada</strong> — el cliente rechazo todos los productos.</p>
              <p><strong className="text-foreground">Convertida a orden</strong> — ya se genero la orden de venta a partir de esta cotizacion.</p>
            </div>
          </div>

          {/* Capacidades por estado */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base">Que puedes hacer en cada estado</p>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Accion</TableHead>
                    <TableHead className="text-center">Borrador</TableHead>
                    <TableHead className="text-center">En aprobacion</TableHead>
                    <TableHead className="text-center">Aprobada</TableHead>
                    <TableHead className="text-center">Rechazada</TableHead>
                    <TableHead className="text-center">Convertida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    {
                      action: 'Ver cotizacion y productos',
                      icon: null,
                      draft: true, approval: true, approved: true, rejected: true, converted: true,
                    },
                    {
                      action: 'Editar campos de un producto',
                      icon: <Pencil className="h-3.5 w-3.5 inline mr-1" />,
                      draft: true, approval: false, approved: true, rejected: false, converted: false,
                    },
                    {
                      action: 'Agregar producto',
                      icon: <Plus className="h-3.5 w-3.5 inline mr-1" />,
                      draft: true, approval: false, approved: true, rejected: false, converted: false,
                    },
                    {
                      action: 'Eliminar producto',
                      icon: <Trash2 className="h-3.5 w-3.5 inline mr-1" />,
                      draft: true, approval: false, approved: true, rejected: false, converted: false,
                    },
                    {
                      action: 'Enviar a aprobacion',
                      icon: <Send className="h-3.5 w-3.5 inline mr-1" />,
                      draft: true, approval: false, approved: false, rejected: false, converted: false,
                    },
                    {
                      action: 'Crear orden de venta',
                      icon: null,
                      draft: false, approval: false, approved: true, rejected: false, converted: false,
                    },
                    {
                      action: 'Ver orden vinculada',
                      icon: null,
                      draft: false, approval: false, approved: false, rejected: false, converted: true,
                    },
                  ].map((row) => (
                    <TableRow key={row.action}>
                      <TableCell className="text-sm">
                        {row.icon}{row.action}
                      </TableCell>
                      {([row.draft, row.approval, row.approved, row.rejected, row.converted] as boolean[]).map((val, i) => (
                        <TableCell key={i} className="text-center">
                          {val
                            ? <span className="text-green-600 dark:text-green-400 font-bold">✓</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Los productos agregados en estado <strong>Aprobada</strong> entran directamente con aprobacion interna
              (sin pasar por el cliente), util cuando DYMMSA necesita ajustar la cotizacion post-aprobacion.
            </p>
          </div>

          {/* Aprobacion por link */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
              Aprobacion por link
            </p>
            <p className="text-muted-foreground">
              Al enviar a aprobacion, el sistema genera un <strong>link unico</strong> (token) que puedes
              compartir con el cliente por WhatsApp, correo o cualquier medio. El cliente accede sin
              necesidad de crear una cuenta.
            </p>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>El cliente puede aprobar o rechazar <strong>cada producto de forma independiente</strong> (aprobacion parcial).</li>
              <li>Hay un boton de <strong>&ldquo;Aprobar todo&rdquo;</strong> para confirmar todos los productos de una vez.</li>
              <li>Una vez enviada la decision, la pagina muestra el estado actual y no permite re-aprobar.</li>
              <li>Tu ves en tiempo real que productos fueron aprobados y cuales rechazados desde el detalle de la cotizacion.</li>
            </ul>
          </div>

        </CardContent>
      </Card>
      </div>

      {/* Section 3: Excel Aprobado (Filas Verdes) */}
      <div id="aprobado" className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Formato Excel Aprobado (Filas Verdes)
          </CardTitle>
          <CardDescription>
            Formato del archivo con los productos aprobados por el cliente,
            marcados con fila verde.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p>
              <strong>Columnas requeridas:</strong>
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <code className="rounded bg-muted px-1">ETM</code> &mdash;
                Codigo ETM del producto
              </li>
              <li>
                <code className="rounded bg-muted px-1">description</code>{' '}
                &mdash; Descripcion en ingles
              </li>
              <li>
                <code className="rounded bg-muted px-1">description_es</code>{' '}
                &mdash; Descripcion en espanol
              </li>
              <li>
                <code className="rounded bg-muted px-1">model_code</code>{' '}
                &mdash; Codigo URREA del producto
              </li>
              <li>
                <code className="rounded bg-muted px-1">quantity</code> &mdash;
                Cantidad solicitada
              </li>
              <li>
                <code className="rounded bg-muted px-1">price</code> &mdash;
                Precio unitario
              </li>
              <li>
                <code className="rounded bg-muted px-1">brand</code> &mdash;
                Marca del producto (ej. <strong>URREA</strong>, Stanley, Truper).
                Solo los productos con marca <strong>URREA</strong> se incluyen
                en el pedido al proveedor.
              </li>
            </ul>
          </div>

          <div className="space-y-2 text-sm">
            <p>
              <strong>Productos aprobados:</strong> El cliente debe marcar{' '}
              <strong>toda la fila</strong> en color verde (fondo de celda).
            </p>
            <p>
              <strong>Tonos de verde aceptados:</strong>
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { color: '#00FF00', label: '#00FF00' },
                { color: '#00B050', label: '#00B050' },
                { color: '#92D050', label: '#92D050' },
                { color: '#C6E0B4', label: '#C6E0B4' },
              ].map((g) => (
                <div key={g.color} className="flex items-center gap-1.5">
                  <div
                    className="h-5 w-5 rounded border"
                    style={{ backgroundColor: g.color }}
                  />
                  <span className="font-mono text-xs">{g.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <p>El archivo puede tener <strong>multiples hojas</strong> (se procesan todas).</p>
            <p>Si hay una columna de imagenes, se ignora automaticamente.</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Ejemplo:</p>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ETM</TableHead>
                    <TableHead>description</TableHead>
                    <TableHead>description_es</TableHead>
                    <TableHead>model_code</TableHead>
                    <TableHead>quantity</TableHead>
                    <TableHead>price</TableHead>
                    <TableHead>brand</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-green-100 dark:bg-green-950/40">
                    <TableCell className="font-mono">ETM-12345</TableCell>
                    <TableCell>Combination wrench 1/2&quot;</TableCell>
                    <TableCell>Llave combinada 1/2&quot;</TableCell>
                    <TableCell className="font-mono">1234A</TableCell>
                    <TableCell>10</TableCell>
                    <TableCell>$150.00</TableCell>
                    <TableCell>URREA</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-mono">ETM-67890</TableCell>
                    <TableCell>Flat screwdriver</TableCell>
                    <TableCell>Desarmador plano</TableCell>
                    <TableCell className="font-mono">5678B</TableCell>
                    <TableCell>5</TableCell>
                    <TableCell>$85.00</TableCell>
                    <TableCell>Stanley</TableCell>
                  </TableRow>
                  <TableRow className="bg-green-100 dark:bg-green-950/40">
                    <TableCell className="font-mono">ETM-11111</TableCell>
                    <TableCell>Cutting pliers</TableCell>
                    <TableCell>Pinza de corte</TableCell>
                    <TableCell className="font-mono">9012C</TableCell>
                    <TableCell>3</TableCell>
                    <TableCell>$220.00</TableCell>
                    <TableCell>URREA</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Las filas en verde son los productos aprobados. La fila sin color se ignora.
              Al descargar el pedido URREA, solo se incluyen los productos con{' '}
              <strong>brand = URREA</strong> (en el ejemplo, ETM-67890 de Stanley se
              excluye del pedido al proveedor).
            </p>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Section 3: Excel de Inventario */}
      <div id="inventario" className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Formato Excel de Inventario
          </CardTitle>
          <CardDescription>
            Formato del archivo para importar inventario de la tienda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p>
              <strong>Columnas requeridas:</strong>
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <code className="rounded bg-muted px-1">model_code</code>{' '}
                &mdash; Codigo URREA del producto
              </li>
              <li>
                <code className="rounded bg-muted px-1">quantity</code> &mdash;
                Cantidad en existencia
              </li>
            </ul>
          </div>

          <div className="space-y-2 text-sm">
            <p>
              Si el archivo viene en formato URREA (reporte de inventario), el
              sistema salta las primeras <strong>13 filas</strong> automaticamente
              (<code className="rounded bg-muted px-1">skiprows=13</code>).
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Ejemplo:</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>model_code</TableHead>
                  <TableHead>quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono">1234A</TableCell>
                  <TableCell>25</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono">5678B</TableCell>
                  <TableCell>12</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono">9012C</TableCell>
                  <TableCell>8</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Section 5: Detalle de Orden */}
      <div id="ordenes" className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Detalle de Orden
          </CardTitle>
          <CardDescription>
            Todo lo que puedes ver y hacer desde la pagina de detalle de una orden de venta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Overview */}
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              La pagina de detalle agrupa toda la informacion y acciones de una orden desde que se genera
              hasta su cierre. El nivel de edicion disponible depende del estado actual de la orden.
            </p>
          </div>

          {/* Encabezado y acciones globales */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base">Encabezado y acciones globales</p>
            <p className="text-muted-foreground">El encabezado muestra el nombre del cliente, ID de orden, fecha de creacion y el estado actual. Desde ahi puedes:</p>
            <ul className="ml-4 list-disc space-y-1.5 text-muted-foreground">
              <li>
                <strong className="text-foreground">Cambiar estado</strong> — dropdown con los 5 estados activos.
                Disponible en cualquier estado excepto <em>Cancelado</em>.
              </li>
              <li>
                <strong className="text-foreground">Descargar Pedido URREA</strong>{' '}
                <span className="inline-flex items-center gap-1">(<Download className="h-3 w-3" /></span>) — aparece unicamente cuando
                hay productos con cantidad a pedir &gt; 0. Genera un Excel con{' '}
                <code className="rounded bg-muted px-1">model_code</code> +{' '}
                <code className="rounded bg-muted px-1">quantity</code> solo para items de marca{' '}
                <strong>URREA</strong>. Los de otras marcas se excluyen con una notificacion.
              </li>
              <li>
                <strong className="text-foreground">Cancelar Orden</strong> — disponible mientras la orden no este
                Completada ni Cancelada. Al confirmar, <strong>restaura automaticamente el inventario</strong> apartado
                al cancelar.
              </li>
            </ul>
          </div>

          {/* Resumen */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base">Resumen (4 tarjetas)</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarjeta</TableHead>
                  <TableHead>Que muestra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Productos</TableCell>
                  <TableCell className="text-muted-foreground">Total de items distintos en la orden.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-blue-600 dark:text-blue-400">En Stock</TableCell>
                  <TableCell className="text-muted-foreground">Suma de <code className="rounded bg-muted px-1">quantity_in_stock</code> — unidades apartadas del inventario de tienda al crear la orden.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-orange-600 dark:text-orange-400">A Pedir URREA</TableCell>
                  <TableCell className="text-muted-foreground">Suma de <code className="rounded bg-muted px-1">quantity_to_order</code> — unidades que hay que pedir al proveedor.</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-green-600 dark:text-green-400">Total</TableCell>
                  <TableCell className="text-muted-foreground">Monto total de la orden. Se recalcula al confirmar recepcion (excluye items no surtidos).</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Tabla de productos */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base">Columnas de la tabla de productos</p>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Columna</TableHead>
                    <TableHead>Editable</TableHead>
                    <TableHead>Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { col: 'ETM', editable: 'No', note: 'Codigo ETM del producto.' },
                    { col: 'Model Code', editable: 'No', note: 'Codigo URREA.' },
                    { col: 'Marca', editable: 'No', note: 'Brand del producto.' },
                    { col: 'Descripcion', editable: 'No', note: 'Descripcion del producto.' },
                    { col: 'Aprobados', editable: 'No', note: 'Cantidad que el cliente aprobo. Fijo desde la cotizacion.' },
                    { col: 'En Stock (azul)', editable: 'No', note: 'Unidades apartadas del inventario de tienda al crear la orden.' },
                    { col: 'A Pedir (naranja)', editable: 'No', note: 'Unidades a solicitar a URREA. En Stock + A Pedir = Aprobados.' },
                    { col: 'Recibidos', editable: 'Si*', note: 'Editable solo si el item tiene A Pedir > 0 y la orden esta abierta. Se ingresa cuanto llego de URREA.' },
                    { col: 'Estado URREA', editable: 'Si*', note: 'Editable en las mismas condiciones que Recibidos. Opciones: Pendiente / Surtido / No surtido. Si A Pedir = 0, muestra "En stock" (fijo).' },
                    { col: 'Tiempo de Entrega', editable: 'Si**', note: 'Editable en cualquier item mientras la orden este abierta. Opciones: Inmediato / 2-3 dias / 3-5 dias / 1 semana / 2 semanas / Indefinido.' },
                    { col: 'Precio', editable: 'Si**', note: 'Editable inline con el icono lapiz. Guardar con Enter o con el boton de confirmacion. Recalcula el total de la orden.' },
                    { col: 'Total fila', editable: 'No', note: 'Calculado: (En Stock + Recibidos si no es No surtido) × Precio.' },
                  ].map((row) => (
                    <TableRow key={row.col}>
                      <TableCell className="font-medium whitespace-nowrap">{row.col}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.editable === 'No'
                          ? <span className="text-muted-foreground/60">—</span>
                          : <span className="text-green-600 dark:text-green-400 font-medium">{row.editable}</span>
                        }
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{row.note}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>*</strong> Solo cuando la orden no esta Completada ni Cancelada, y el item tiene{' '}
              <code className="rounded bg-muted px-1">quantity_to_order &gt; 0</code>.{' '}
              <strong>**</strong> Solo cuando la orden no esta Completada ni Cancelada.
            </p>
          </div>

          {/* Acciones por producto */}
          <div className="space-y-3 text-sm">
            <p className="font-medium text-base">Acciones sobre productos individuales</p>
            <p className="text-muted-foreground text-xs mb-1">Disponibles solo cuando la orden no esta Completada ni Cancelada.</p>
            <div className="space-y-3">
              <div className="rounded-md border px-4 py-3 space-y-1">
                <p className="font-medium flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Agregar producto</p>
                <p className="text-xs text-muted-foreground">
                  Abre un dialogo para ingresar ETM, codigo de modelo, descripcion, marca, precio y cantidad.
                  El sistema verifica el inventario de tienda y calcula automaticamente cuanto va a stock y cuanto
                  hay que pedir a URREA. El inventario se deduce de inmediato.
                </p>
              </div>
              <div className="rounded-md border px-4 py-3 space-y-1">
                <p className="font-medium flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> Editar precio</p>
                <p className="text-xs text-muted-foreground">
                  Icono lapiz en la columna Acciones de cada fila. Abre un input inline; confirmar con Enter
                  o el boton de check, cancelar con Escape o la X. Al guardar, el{' '}
                  <code className="rounded bg-muted px-1">total_amount</code> de la orden se recalcula automaticamente.
                </p>
              </div>
              <div className="rounded-md border px-4 py-3 space-y-1">
                <p className="font-medium flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> Eliminar producto</p>
                <p className="text-xs text-muted-foreground">
                  Icono papelera con dialogo de confirmacion. Al eliminar, la cantidad que estaba apartada en stock
                  (<code className="rounded bg-muted px-1">quantity_in_stock</code> del item) se devuelve automaticamente
                  al inventario de la tienda.
                </p>
              </div>
            </div>
          </div>

          {/* Confirmar recepcion */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              Confirmar Recepcion
            </p>
            <p className="text-muted-foreground">
              El boton <strong>&ldquo;Confirmar Recepcion&rdquo;</strong> aparece automaticamente en cuanto editas
              la cantidad recibida o el estado URREA de cualquier item. Al confirmar ocurre lo siguiente:
            </p>
            <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
              <li>La <strong>cantidad recibida</strong> de cada item se suma al inventario de tienda.</li>
              <li>El <strong>estado URREA</strong> de cada item se actualiza (Surtido / No surtido / Pendiente).</li>
              <li>El <strong>total de la orden</strong> se recalcula excluyendo los items marcados como No surtido.</li>
            </ul>
          </div>

          {/* Estados */}
          <div className="space-y-3 text-sm">
            <p className="font-medium text-base">Estados de la orden</p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border px-2.5 py-0.5 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300 font-medium">Pendiente URREA</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="rounded-full border px-2.5 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-medium">Recibido URREA</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="rounded-full border px-2.5 py-0.5 bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300 font-medium">Pendiente Pago</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="rounded-full border px-2.5 py-0.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 font-medium">Pagado</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="rounded-full border px-2.5 py-0.5 bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300 font-medium">Completado</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Desde cualquier estado activo (excepto Completado) tambien se puede pasar a{' '}
              <span className="rounded-full border px-2 py-0.5 bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 font-medium text-xs">Cancelado</span>{' '}
              usando el boton de cancelar, lo que restaura el inventario apartado.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
                  <TableHead>Que indica</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { status: 'Pendiente URREA', color: 'text-yellow-700 dark:text-yellow-300', desc: 'Orden creada. Se genero el Excel de pedido pero aun no se han recibido productos de URREA.' },
                  { status: 'Recibido URREA', color: 'text-blue-700 dark:text-blue-300', desc: 'Los productos de URREA llegaron. Se registro la recepcion y el inventario ya fue actualizado.' },
                  { status: 'Pendiente Pago', color: 'text-orange-700 dark:text-orange-300', desc: 'Los productos estan listos para entrega. Se espera el pago del cliente.' },
                  { status: 'Pagado', color: 'text-emerald-700 dark:text-emerald-300', desc: 'El cliente realizo el pago. Pendiente de confirmar la entrega fisica.' },
                  { status: 'Completado', color: 'text-green-700 dark:text-green-300', desc: 'Entrega confirmada. La orden esta cerrada y ya no permite modificaciones.' },
                  { status: 'Cancelado', color: 'text-red-700 dark:text-red-300', desc: 'Orden cancelada. El inventario apartado fue restaurado automaticamente.' },
                ].map((row) => (
                  <TableRow key={row.status}>
                    <TableCell className={`font-medium whitespace-nowrap ${row.color}`}>{row.status}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{row.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Capacidades por estado */}
          <div className="space-y-2 text-sm">
            <p className="font-medium text-base">Que puedes hacer en cada estado</p>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Accion</TableHead>
                    <TableHead className="text-center whitespace-nowrap">Pend. URREA</TableHead>
                    <TableHead className="text-center whitespace-nowrap">Recibido URREA</TableHead>
                    <TableHead className="text-center whitespace-nowrap">Pend. Pago</TableHead>
                    <TableHead className="text-center">Pagado</TableHead>
                    <TableHead className="text-center">Completado</TableHead>
                    <TableHead className="text-center">Cancelado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { action: 'Ver detalle de la orden', vals: [true, true, true, true, true, true] },
                    { action: 'Cambiar estado', vals: [true, true, true, true, false, false] },
                    { action: 'Descargar Excel URREA', vals: [true, true, true, true, true, true] },
                    { action: 'Cancelar orden', vals: [true, true, true, true, false, false] },
                    { action: 'Agregar producto', vals: [true, true, true, true, false, false] },
                    { action: 'Editar precio', vals: [true, true, true, true, false, false] },
                    { action: 'Eliminar producto', vals: [true, true, true, true, false, false] },
                    { action: 'Editar cantidad recibida / estado URREA', vals: [true, true, true, true, false, false] },
                    { action: 'Confirmar recepcion', vals: [true, true, true, true, false, false] },
                    { action: 'Editar tiempo de entrega', vals: [true, true, true, true, false, false] },
                  ].map((row) => (
                    <TableRow key={row.action}>
                      <TableCell className="text-sm whitespace-nowrap">{row.action}</TableCell>
                      {row.vals.map((v, i) => (
                        <TableCell key={i} className="text-center">
                          {v
                            ? <span className="text-green-600 dark:text-green-400 font-bold">✓</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              La descarga del Excel URREA siempre esta disponible, pero el boton solo aparece si hay
              items con cantidad a pedir &gt; 0.
            </p>
          </div>

        </CardContent>
      </Card>
      </div>

      {/* Section 6: Flujo del Sistema */}
      <div id="flujo" className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Flujo Completo del Sistema
          </CardTitle>
          <CardDescription>
            Pasos del proceso desde la cotizacion hasta la entrega final, con todas las variantes posibles en cada etapa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {flowSteps.map((step, i) => (
              <div key={step.number}>
                <div className="flex gap-4">
                  {/* Step number + connector */}
                  <div className="flex flex-col items-center">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
                      {step.number}
                    </div>
                    {i < flowSteps.length - 1 && (
                      <div className="flex flex-1 items-center py-1">
                        <ArrowDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Step content */}
                  <div className="pb-6 flex-1 min-w-0">
                    <p className="font-medium leading-8">{step.title}</p>
                    <p className="text-sm text-muted-foreground mb-2">
                      {step.description}
                    </p>

                    {/* Variants */}
                    {step.variants && (
                      <div className="space-y-2">
                        {step.variants.map((v) => (
                          <div
                            key={v.label}
                            className={`rounded-md pl-3 pr-3 py-2 ${variantBorderBg[v.color]}`}
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-0.5">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantBadge[v.color]}`}>
                                {v.label}
                              </span>
                              {v.endsFlow && (
                                <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                  — flujo termina aqui
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{v.description}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
    </div>
  )
}
