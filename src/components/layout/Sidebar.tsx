'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { DiscreteModeToggle } from '@/components/discrete-mode-toggle'
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
  LogOut,
  Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const mainLinks = [
  { href: '/dashboard',            label: 'Inicio',       icon: Home,         exact: true },
  { href: '/dashboard/inventory',  label: 'Inventario',   icon: Warehouse },
  { href: '/dashboard/quotations', label: 'Cotizaciones', icon: FileText },
  { href: '/dashboard/orders',     label: 'Ordenes',      icon: ShoppingCart },
]

const etmUrreaLinks = [
  { href: '/dashboard/db',     label: 'Base de datos', icon: Database },
  { href: '/dashboard/quoter', label: 'Matcher',       icon: GitCompare },
]

function NavLink({
  href,
  label,
  icon: Icon,
  exact,
  onClick,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  exact?: boolean
  onClick?: () => void
}) {
  const pathname = usePathname()
  const isActive = exact ? pathname === href : pathname.startsWith(href)

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </Link>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center border-b px-4">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2">
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
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-6">
          <div className="space-y-1">
            {mainLinks.map((link) => (
              <NavLink key={link.href} {...link} onClick={onNavigate} />
            ))}
          </div>

          <div className="space-y-1">
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              ETM — Catálogo
            </p>
            {etmUrreaLinks.map((link) => (
              <NavLink key={link.href} {...link} onClick={onNavigate} />
            ))}
          </div>

          <div className="space-y-1">
            <NavLink
              href="/dashboard/docs"
              label="Documentacion"
              icon={CircleHelp}
              onClick={onNavigate}
            />
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t px-3 py-4 space-y-2">
        <div className="flex items-center justify-between rounded-lg px-3 py-1.5">
          <span className="truncate text-xs text-muted-foreground max-w-[120px]">
            {user?.email}
          </span>
          <div className="flex items-center gap-1">
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
          <LogOut className="mr-2 h-4 w-4" />
          Cerrar sesión
        </Button>
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
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b bg-background px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Abrir menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Navegacion</SheetTitle>
            </SheetHeader>
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
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-64 flex-col border-r bg-card">
        <SidebarContent />
      </aside>
    </>
  )
}
