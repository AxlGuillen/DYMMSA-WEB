import type { Metadata } from 'next'
import { ProfileView } from '@/components/profile/ProfileView'
import { TourButton } from '@/components/tours/TourButton'

export const metadata: Metadata = {
  title: 'Mi perfil | DYMMSA',
}

export default function ProfilePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Mi perfil</h1>
          <p className="text-muted-foreground">Tu nombre, tu foto y tu NSS. Lo demás lo administra el equipo.</p>
        </div>
        <TourButton tour="profile" />
      </div>
      <ProfileView />
    </div>
  )
}
