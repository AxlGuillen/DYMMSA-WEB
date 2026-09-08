import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { isSafeNext } from '@/lib/safe-next'

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

  // /oauth/consent is protected on purpose: consent without a session means nothing (ADR-023).
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/oauth')) {
    if (!user) {
      const url = request.nextUrl.clone()
      // Keep the query: without authorization_id, consent forgets what it was authorizing.
      const target = `${pathname}${request.nextUrl.search}`
      url.pathname = '/login'
      url.search = '' // clone() carries the original query; it duplicates unless cleared
      url.searchParams.set('next', target)
      return NextResponse.redirect(url)
    }
  }

  // Honors ?next= for relative routes only (open-redirect guard): a logged-in user
  // landing on /login?next=/oauth/consent must reach consent, not /dashboard.
  if (pathname === '/login') {
    if (user) {
      const next = request.nextUrl.searchParams.get('next')
      const url = request.nextUrl.clone()
      url.search = ''
      // Rejects `//` and `/\`: browsers normalize the backslash, so `/\evil.com`
      // would become protocol-relative `//evil.com` — a different origin.
      if (isSafeNext(next)) {
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
    // /api/mcp, /.well-known/* and health authenticate in their own handler:
    // a /login redirect would kill the discovery 401 (ADR-023).
    '/((?!_next/static|_next/image|favicon.ico|\\.well-known|api/mcp|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
