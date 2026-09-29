import type { Metadata } from 'next'
import { ProfileView } from '@/components/profile/ProfileView'

export const metadata: Metadata = {
  title: 'Mi perfil | DYMMSA',
}

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Mi perfil</h1>
        <p className="text-muted-foreground">Tu nombre, tu foto y tu NSS. Lo demás lo administra el equipo.</p>
      </div>
      <ProfileView />
    </div>
  )
}
