import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { Footer } from '@/components/layout/Footer'

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
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      {/* Offset: sidebar width on desktop, top bar height on mobile */}
      <div className="flex flex-1 flex-col min-w-0 pt-14 md:pt-0 md:pl-64">
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  )
}
