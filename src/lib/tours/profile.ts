import type { OverviewStep } from '@/lib/tours'

/** Mi perfil overview (#122): what each person owns and what stays with the admin. */
export const PROFILE_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="profile-photo"]',
    title: 'Tu foto',
    description:
      'Aparece en el menú lateral, en Equipo y en Mi semana. Se recorta sola en cuadro al centro y se guarda sin la ubicación que traen las fotos del celular. Sin foto se usan tus iniciales.',
    side: 'right',
  },
  {
    selector: '[data-tour="profile-details"]',
    title: 'Tu nombre y tu NSS',
    description:
      'Los editas tú. El <b>NSS</b> se valida con su dígito verificador y se muestra oculto hasta que tocas el ojo; en <b>modo discreto</b> no se puede revelar. Solo lo ven tú y los administradores, y el asistente te lo da si se lo pides.',
  },
  {
    selector: '[data-tour="profile-account"]',
    title: 'Lo que administra el equipo',
    description:
      'Correo, rol, jornada e id del checador son de solo lectura: los cambia un administrador desde <b>Equipo</b>.',
  },
]
