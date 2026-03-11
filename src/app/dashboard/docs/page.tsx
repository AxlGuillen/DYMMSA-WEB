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
  { id: 'flujo', label: 'Flujo del Sistema', icon: ArrowRight },
]

const flowSteps = [
  {
    number: 1,
    title: 'Subir Excel con ETMs',
    description:
      'Sube el archivo Excel del cliente con codigos ETM. El sistema genera una cotizacion automaticamente.',
  },
  {
    number: 2,
    title: 'Cliente aprueba productos',
    description:
      'El cliente marca las filas de los productos aprobados en color verde en el Excel.',
  },
  {
    number: 3,
    title: 'Subir Excel aprobado',
    description:
      'Sube el Excel con las filas verdes. El sistema detecta automaticamente los productos aprobados.',
  },
  {
    number: 4,
    title: 'Verificacion de stock y creacion de orden',
    description:
      'El sistema verifica el inventario de la tienda, aparta stock disponible y calcula lo que falta pedir a URREA.',
  },
  {
    number: 5,
    title: 'Descargar pedido URREA',
    description:
      'Se genera un Excel con los productos faltantes en formato URREA (model_code + quantity) para descargar.',
  },
  {
    number: 6,
    title: 'Enviar pedido a URREA',
    description:
      'Envia el archivo de pedido a URREA por WhatsApp (paso manual, fuera del sistema).',
  },
  {
    number: 7,
    title: 'Recibir productos y confirmar',
    description:
      'Cuando llegan los productos de URREA, confirma la recepcion editando cantidades recibidas en la orden.',
  },
  {
    number: 8,
    title: 'Completar orden',
    description:
      'Cambia el estado de la orden: pago pendiente, pagado, completado. El inventario se actualiza automaticamente.',
  },
]

export default function DocsPage() {
  return (
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
      <Card>
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

      {/* Section 1: Excel para Cotizar */}
      <Card id="cotizar">
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

      {/* Section 2: Cotizaciones y Flujo */}
      <Card id="cotizaciones">
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

      {/* Section 3: Excel Aprobado (Filas Verdes) */}
      <Card id="aprobado">
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

      {/* Section 3: Excel de Inventario */}
      <Card id="inventario">
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

      {/* Section 4: Flujo del Sistema */}
      <Card id="flujo">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Flujo Completo del Sistema
          </CardTitle>
          <CardDescription>
            Pasos del proceso desde la cotizacion hasta la entrega final.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {flowSteps.map((step, i) => (
              <div key={step.number}>
                <div className="flex gap-4">
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
                  <div className="pb-6">
                    <p className="font-medium leading-8">{step.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
