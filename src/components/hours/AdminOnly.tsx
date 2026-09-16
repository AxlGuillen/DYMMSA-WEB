'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfile } from '@/hooks/useProfile'

/** Client-side gate for admin pages; the API answers 403 regardless (ADR-026). */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useProfile()
  if (isLoading) return <Skeleton className="h-40 w-full" />
  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Esta sección es solo para administradores.
        </CardContent>
      </Card>
    )
  }
  return <>{children}</>
}
