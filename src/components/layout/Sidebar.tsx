'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { useMounted } from '@/hooks/useMounted'
import { useSidebarStore } from '@/stores/sidebarStore'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { DiscreteModeToggle } from '@/components/discrete-mode-toggle'
import { SoundToggle } from '@/components/sound-toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Home,
  Warehouse,
  FileText,
  ShoppingCart,
  Database,
  GitCompare,
  CircleHelp,
  Sparkles,
  Library,
  ClipboardList,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from '@/components/icons'
import { cn } from '@/lib/utils'

type LinkItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
}

const mainLinks: LinkItem[] = [
  { href: '/dashboard',            label: 'Inicio',       icon: Home,         exact: true },
  { href: '/dashboard/quotations', label: 'Cotizaciones', icon: FileText },
  { href: '/dashboard/orders',     label: 'Ordenes',      icon: ShoppingCart },
]

const etmUrreaLinks: LinkItem[] = [
  { href: '/dashboard/db',     label: 'Base de datos', icon: Database },
  { href: '/dashboard/quoter', label: 'Matcher',       icon: GitCompare },
]

const dymmsaLinks: LinkItem[] = [
  { href: '/dashboard/inventory', label: 'Inventario', icon: Warehouse },
]

const urreaLinks: LinkItem[] = [
  { href: '/dashboard/urrea/catalog', label: 'Catálogo', icon: Library },
]

const recursosLinks: LinkItem[] = [
  { href: '/dashboard/tasks',     label: 'Tareas',        icon: ClipboardList },
  { href: '/dashboard/changelog', label: 'Novedades',     icon: Sparkles },
  { href: '/dashboard/docs',      label: 'Documentacion', icon: CircleHelp },
]

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  collapsed,
  onClick,
}: LinkItem & { collapsed?: boolean; onClick?: () => void }) {
  const pathname = usePathname()
  const isActive = exact ? pathname === href : pathname.startsWith(href)

  const link = (
    <Link
      href={href}
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && label}
    </Link>
  )

  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

function NavSection({
  title,
  links,
  collapsed,
  onNavigate,
}: {
  title?: string
  links: LinkItem[]
  collapsed?: boolean
  onNavigate?: () => void
}) {
  return (
    <div className="space-y-1">
      {title &&
        (collapsed ? (
          <div className="mx-2 mb-1 border-t" />
        ) : (
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            {title}
          </p>
        ))}
      {links.map((link) => (
        <NavLink key={link.href} {...link} collapsed={collapsed} onClick={onNavigate} />
      ))}
    </div>
  )
}

function SidebarContent({
  collapsed = false,
  onNavigate,
  onToggleCollapse,
}: {
  collapsed?: boolean
  onNavigate?: () => void
  onToggleCollapse?: () => void
}) {
  const { user, signOut } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={200}>
    <div className="flex h-full flex-col">
      {/* Header: logo (expandido) + botón de colapso */}
      <div
        className={cn(
          'flex h-16 shrink-0 items-center border-b',
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        )}
      >
        {!collapsed && (
          <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 min-w-0">
            <Image
              src="/dymmsa.webp"
              alt="DYMMSA"
              width={320}
              height={160}
              className="h-10 w-auto"
              priority
            />
            <span className="text-base font-semibold tracking-tight">DYMMSA</span>
          </Link>
        )}
        {onToggleCollapse &&
          (collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  onClick={onToggleCollapse}
                  aria-label="Expandir menú"
                >
                  <PanelLeftOpen className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Expandir menú</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={onToggleCollapse}
              aria-label="Colapsar menú"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          ))}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-6">
          <NavSection links={mainLinks} collapsed={collapsed} onNavigate={onNavigate} />
          <NavSection title="ETM — Catálogo" links={etmUrreaLinks} collapsed={collapsed} onNavigate={onNavigate} />
          <NavSection title="DYMMSA" links={dymmsaLinks} collapsed={collapsed} onNavigate={onNavigate} />
          <NavSection title="URREA" links={urreaLinks} collapsed={collapsed} onNavigate={onNavigate} />
          <NavSection title="Recursos" links={recursosLinks} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t px-3 py-4 space-y-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <SoundToggle />
            <DiscreteModeToggle />
            <ThemeToggle />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-foreground"
                  onClick={() => setConfirmOpen(true)}
                  aria-label="Cerrar sesión"
                >
                  <LogOut className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Cerrar sesión</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg px-3 py-1.5">
              <span className="truncate text-xs text-muted-foreground max-w-[120px]">
                {user?.email}
              </span>
              <div className="flex items-center gap-1">
                <SoundToggle />
                <DiscreteModeToggle />
                <ThemeToggle />
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={() => setConfirmOpen(true)}
            >
              <LogOut className="mr-2 size-4" />
              Cerrar sesión
            </Button>
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cerrar sesión?</AlertDialogTitle>
            <AlertDialogDescription>
              Se cerrará tu sesión actual y tendrás que volver a iniciar sesión para acceder al sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>
              Cerrar sesión
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(false)
  const collapsed = useSidebarStore((s) => s.collapsed)
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed)

  // Animar el ancho solo tras la primera pintura (evita el "salto" al rehidratar localStorage).
  const mounted = useMounted()

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="size-5" />
              <span className="sr-only">Abrir menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navegacion</SheetTitle>
            </SheetHeader>
            {/* Móvil: siempre expandido */}
            <SidebarContent onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <Link href="/dashboard">
          <Image
            src="/dymmsa.webp"
            alt="DYMMSA"
            width={240}
            height={120}
            className="h-8 w-auto"
          />
        </Link>
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex fixed inset-y-0 left-0 z-40 flex-col border-r bg-card',
          mounted && 'transition-[width] duration-200 ease-in-out',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </aside>
    </>
  )
}
