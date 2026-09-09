'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { FileUploader } from '@/components/quoter/FileUploader'
import { AlertTriangle, CheckCircle } from '@/components/icons'
import { useImportTimeEntries, useTimeImports } from '@/hooks/useTimeEntries'
import { useDateFormat } from '@/hooks/useDateFormat'
import { formatAbsolute } from '@/lib/format'
import type { TimeImportResult } from '@/types/database'

/** Upload the NGTeco weekly report and read back what happened. */
export function TimeImportPanel() {
  const [result, setResult] = useState<TimeImportResult | null>(null)
  const importReport = useImportTimeEntries()
  const { data: imports } = useTimeImports()
  const formatDate = useDateFormat()

  const handleFile = async (file: File) => {
    try {
      const res = await importReport.mutateAsync(file)
      setResult(res)
      if (res.inserted + res.updated === 0) {
        toast.warning(
          res.skipped_edited > 0
            ? `No entró ninguna checada: las ${res.skipped_edited} del archivo ya estaban corregidas a mano`
            : 'No entró ninguna checada: revisa los no mapeados y los avisos',
        )
      } else {
        toast.success(`Reporte del ${formatDate(res.period.start)} importado`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo importar')
    }
  }

  return (
    <div className="space-y-6">
      <FileUploader
        onFileSelected={handleFile}
        isLoading={importReport.isPending}
        hint="El reporte semanal del checador (NGTimereport-*.xls). Volver a subirlo no duplica."
      />

      {result && (
        <Card data-testid="import-result">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle className="size-4 text-green-600" />
              Semana del {formatDate(result.period.start)} al {formatDate(result.period.end)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Insertadas</dt>
                <dd className="text-2xl font-semibold tabular-nums">{result.inserted}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Actualizadas</dt>
                <dd className="text-2xl font-semibold tabular-nums">{result.updated}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Saltadas por edición</dt>
                <dd className="text-2xl font-semibold tabular-nums">{result.skipped_edited}</dd>
              </div>
            </dl>

            {result.unmapped.length > 0 && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="size-4 text-amber-600" />
                  Empleados sin usuario asignado (no se importaron)
                </p>
                <ul className="mt-2 list-inside list-disc">
                  {result.unmapped.map((u) => (
                    <li key={`${u.clockId}-${u.name}`}>
                      {u.name} <Badge variant="outline">checador {u.clockId}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-muted-foreground">
                  Asigna el id del checador en <Link href="/dashboard/hours/team" className="underline">Equipo</Link> y vuelve a subir el archivo.
                </p>
              </div>
            )}

            {result.warnings.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  {result.warnings.length} aviso{result.warnings.length !== 1 ? 's' : ''} del archivo
                </summary>
                <ul className="mt-2 list-inside list-disc text-muted-foreground">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cargas anteriores</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!imports?.length ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Aún no se ha importado ningún reporte.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Semana</TableHead>
                  <TableHead>Archivo</TableHead>
                  <TableHead className="text-right">Insertadas</TableHead>
                  <TableHead className="text-right">Actualizadas</TableHead>
                  <TableHead className="text-right">Saltadas</TableHead>
                  <TableHead>Cargado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.map((imp) => (
                  <TableRow key={imp.id}>
                    <TableCell>{formatDate(imp.period_start)} – {formatDate(imp.period_end)}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground">{imp.file_name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{imp.inserted}</TableCell>
                    <TableCell className="text-right tabular-nums">{imp.updated}</TableCell>
                    <TableCell className="text-right tabular-nums">{imp.skipped_edited}</TableCell>
                    <TableCell className="text-muted-foreground">{formatAbsolute(imp.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
