'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  LogOut,
  Home,
  Database,
  GitCompare,
  ChevronDown,
  Warehouse,
  ShoppingCart,
  Menu,
} from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

const mainLinks = [
  { href: '/dashboard', label: 'Inicio', icon: Home, exact: true },
  { href: '/dashboard/inventory', label: 'Inventario', icon: Warehouse },
  { href: '/dashboard/orders', label: 'Ordenes', icon: ShoppingCart },
]

const etmUrreaLinks = [
  { href: '/dashboard/db', label: 'Base de datos', icon: Database },
  { href: '/dashboard/quoter', label: 'Matcher', icon: GitCompare },
]

export function Navbar() {
  const { user, signOut } = useAuth()
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isEtmUrreaActive = etmUrreaLinks.some((link) =>
    pathname.startsWith(link.href)
  )

  const isLinkActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/dymmsa.webp"
              alt="DYMMSA"
              width={320}
              height={160}
              className="h-12 w-auto"
              priority
            />
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {mainLinks.map((link) => {
              const Icon = link.icon
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent',
                    isLinkActive(link.href, link.exact) && 'bg-accent'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              )
            })}

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

        {/* Desktop User Menu */}
        <div className="hidden md:flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesion
          </Button>
        </div>

        {/* Mobile Menu Button */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="h-6 w-6" />
              <span className="sr-only">Abrir menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-2 mt-6 p-4">
              {/* Main Links */}
              {mainLinks.map((link) => {
                const Icon = link.icon
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={closeMobileMenu}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors hover:bg-accent',
                      isLinkActive(link.href, link.exact) && 'bg-accent'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {link.label}
                  </Link>
                )
              })}

              {/* ETM - URREA Section */}
              <div className="mt-4 pt-4 border-t">
                <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  ETM - URREA
                </p>
                {etmUrreaLinks.map((link) => {
                  const Icon = link.icon
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={closeMobileMenu}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors hover:bg-accent',
                        pathname.startsWith(link.href) && 'bg-accent'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {link.label}
                    </Link>
                  )
                })}
              </div>

              {/* User Section */}
              <div className="mt-4 pt-4 border-t flex flex-col gap-3">
                <div className="flex items-center justify-between px-3">
                  <span className="text-sm text-muted-foreground">Tema</span>
                  <ThemeToggle />
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    closeMobileMenu()
                    signOut()
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesion
                </Button>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
