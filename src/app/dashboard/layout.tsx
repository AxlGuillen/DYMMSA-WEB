import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/layout/Navbar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="container mx-auto flex-1 px-4 py-8">
        {children}
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        <p>
          DYMMSA &copy; {new Date().getFullYear()} &mdash; Desarrollado por{' '}
          <a
            href="https://axl13.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Axl
          </a>
        </p>
      </footer>
    </div>
  )
}
