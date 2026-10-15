/** Building blocks shared by the docs sections (#118): same card frame and note style as the original page. */

import type { ComponentType, ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function DocSection({ id, icon: Icon, title, description, action, children }: {
  id: string
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  /** Next to the title, e.g. the section's "Ver tutorial" (ADR-038). */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div id={id} className="login-card-border">
      <Card className="docs-card-inner border-0">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Icon className="size-5" />
            {title}
            {action && <span className="ml-auto">{action}</span>}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">{children}</CardContent>
      </Card>
    </div>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md border bg-muted/40 px-4 py-3 text-muted-foreground">{children}</div>
}

export function Sub({ children }: { children: ReactNode }) {
  return <p className="font-medium text-base">{children}</p>
}

export const List = ({ children }: { children: ReactNode }) => (
  <ul className="ml-4 list-disc space-y-1.5 text-muted-foreground">{children}</ul>
)
