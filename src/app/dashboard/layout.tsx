import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { SidebarOffset } from '@/components/layout/SidebarOffset'
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
      <SidebarOffset>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
        <Footer />
      </SidebarOffset>
    </div>
  )
}
