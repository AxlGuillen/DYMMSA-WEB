import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Rutas protegidas → login. /oauth/consent entra aquí a propósito (el
  // consentimiento OAuth sin sesión no significa nada, ADR-023).
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/oauth')) {
    if (!user) {
      const url = request.nextUrl.clone()
      // Conservar la query es vital para /oauth/consent: sin el
      // authorization_id, el usuario vuelve del login a una pantalla que ya no
      // sabe qué estaba autorizando.
      const target = `${pathname}${request.nextUrl.search}`
      url.pathname = '/login'
      url.search = '' // clone() arrastra la query original; sin limpiarla se duplica
      url.searchParams.set('next', target)
      return NextResponse.redirect(url)
    }
  }

  // Auth routes - redirect if already authenticated. Honra ?next= (solo rutas
  // relativas — guard de open-redirect): un usuario con sesión que cae en
  // /login?next=/oauth/consent?... debe llegar al consentimiento, no a /dashboard.
  if (pathname === '/login') {
    if (user) {
      const next = request.nextUrl.searchParams.get('next')
      const url = request.nextUrl.clone()
      url.search = ''
      if (next?.startsWith('/') && !next.startsWith('//')) {
        const [nextPath, ...rest] = next.split('?')
        url.pathname = nextPath
        if (rest.length) url.search = `?${rest.join('?')}`
      } else {
        url.pathname = '/dashboard'
      }
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Excluye estáticos, el transporte MCP, los documentos de discovery OAuth
    // (/.well-known/*) y el health público: esos autentican en su propio handler
    // (o son públicos por diseño), y un redirect a /login reemplazaría el 401
    // con resource_metadata que los clientes MCP necesitan para descubrir el
    // authorization server (ADR-023). /oauth/consent SÍ queda dentro.
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known|api/mcp|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
