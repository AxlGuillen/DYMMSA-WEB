'use client'

import Link from 'next/link'
import {
  FileSpreadsheet,
  CheckCircle2,
  Warehouse,
  ArrowRight,
  ArrowDown,
  BookOpen,
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
              <strong>ETM</strong> (no importa mayusculas o minusculas).
            </p>
            <p>
              El sistema procesa <strong>todas las hojas</strong> del archivo y
              busca la columna ETM en cada una.
            </p>
            <p>
              Las demas columnas son opcionales. El sistema solo necesita los
              codigos ETM para buscar en la base de datos y generar la
              cotizacion.
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Ejemplo:</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ETM</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead>Cantidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-mono">ETM-12345</TableCell>
                  <TableCell>Llave combinada 1/2&quot;</TableCell>
                  <TableCell>10</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono">ETM-67890</TableCell>
                  <TableCell>Desarmador plano</TableCell>
                  <TableCell>5</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-mono">ETM-11111</TableCell>
                  <TableCell>Pinza de corte</TableCell>
                  <TableCell>3</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Excel Aprobado (Filas Verdes) */}
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
