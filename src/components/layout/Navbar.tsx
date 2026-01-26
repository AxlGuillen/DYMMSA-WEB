'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LogOut, Home, Database, GitCompare, ChevronDown, Warehouse } from 'lucide-react'
import { cn } from '@/lib/utils'

const etmUrreaLinks = [
  { href: '/dashboard/db', label: 'Base de datos', icon: Database },
  { href: '/dashboard/quoter', label: 'Matcher', icon: GitCompare },
]

export function Navbar() {
  const { user, signOut } = useAuth()
  const pathname = usePathname()

  const isEtmUrreaActive = etmUrreaLinks.some((link) =>
    pathname.startsWith(link.href)
  )

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <h1 className="text-xl font-bold">DYMMSA</h1>
          </Link>
          <nav className="flex items-center gap-1">
            {/* Inicio */}
            <Link
              href="/dashboard"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                pathname === '/dashboard' && 'bg-accent'
              )}
            >
              <Home className="h-4 w-4" />
              Inicio
            </Link>

            {/* Inventario */}
            <Link
              href="/dashboard/inventory"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                pathname.startsWith('/dashboard/inventory') && 'bg-accent'
              )}
            >
              <Warehouse className="h-4 w-4" />
              Inventario
            </Link>

            {/* ETM - URREA Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    isEtmUrreaActive && 'bg-accent'
                  )}
                >
                  ETM - URREA
                  <ChevronDown className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {etmUrreaLinks.map((link) => {
                  const Icon = link.icon
                  const isActive = pathname.startsWith(link.href)
                  return (
                    <DropdownMenuItem key={link.href} asChild>
                      <Link
                        href={link.href}
                        className={cn(
                          'flex items-center gap-2 cursor-pointer',
                          isActive && 'bg-accent'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {link.label}
                      </Link>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user?.email}</span>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesion
          </Button>
        </div>
      </div>
    </header>
  )
}
