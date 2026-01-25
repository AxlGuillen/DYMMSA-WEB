'use client'

import { useState } from 'react'
import { useQuotesHistory } from '@/hooks/useQuotes'
import { Button } from '@/components/ui/button'
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
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  FileText,
  TrendingUp,
  CheckCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from 'lucide-react'

export default function QuotesRecordPage() {
  const [page, setPage] = useState(1)
  const pageSize = 10

  const { data, isLoading, isError } = useQuotesHistory({ page, pageSize })

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getMatchPercentage = (found: number, requested: number) => {
    if (requested === 0) return 0
    return Math.round((found / requested) * 100)
  }

  const getMatchColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-100 text-green-800'
    if (percentage >= 50) return 'bg-yellow-100 text-yellow-800'
    return 'bg-red-100 text-red-800'
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">Error al cargar el historial</p>
      </div>
    )
  }

  const stats = data?.stats
  const overallMatchRate =
    stats && stats.totalEtmsRequested > 0
      ? Math.round((stats.totalEtmsFound / stats.totalEtmsRequested) * 100)
      : 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Historial de Cotizaciones
        </h2>
        <p className="text-muted-foreground">
          Registro de todas las cotizaciones generadas y descargadas
        </p>
      </div>

      {/* Estadisticas */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Total Cotizaciones
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{stats?.totalQuotes || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">ETMs Solicitados</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {stats?.totalEtmsRequested.toLocaleString() || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">ETMs Encontrados</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold text-green-600">
                {stats?.totalEtmsFound.toLocaleString() || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">
              Tasa de Coincidencia
            </CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{overallMatchRate}%</span>
                <Badge
                  variant="outline"
                  className={getMatchColor(overallMatchRate)}
                >
                  {overallMatchRate >= 80
                    ? 'Excelente'
                    : overallMatchRate >= 50
                      ? 'Regular'
                      : 'Bajo'}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabla de historial */}
      <Card>
        <CardHeader>
          <CardTitle>Cotizaciones Recientes</CardTitle>
          <CardDescription>
            Listado de cotizaciones generadas ordenadas por fecha
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data?.data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-lg font-medium">No hay cotizaciones aun</p>
              <p className="text-muted-foreground">
                Las cotizaciones descargadas apareceran aqui
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Archivo</TableHead>
                      <TableHead className="text-center">Solicitados</TableHead>
                      <TableHead className="text-center">Encontrados</TableHead>
                      <TableHead className="text-center">Coincidencia</TableHead>
                      <TableHead>Fecha</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.data.map((quote) => {
                      const matchPct = getMatchPercentage(
                        quote.total_found,
                        quote.total_requested
                      )
                      return (
                        <TableRow key={quote.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="max-w-[200px] truncate">
                                {quote.filename}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            {quote.total_requested}
                          </TableCell>
                          <TableCell className="text-center">
                            {quote.total_found}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={getMatchColor(matchPct)}
                            >
                              {matchPct}%
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Calendar className="h-4 w-4" />
                              {formatDate(quote.created_at)}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Paginacion */}
              {data && data.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Pagina {data.page} de {data.totalPages} ({data.count} total)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= data.totalPages}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
