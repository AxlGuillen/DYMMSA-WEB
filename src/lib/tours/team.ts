import type { OverviewStep } from '@/lib/tours'

/** Team overview (#120): what each column decides elsewhere in the app. */
export const TEAM_TOUR: OverviewStep[] = [
  {
    selector: '[data-tour="team-header"]',
    title: 'Quién es quién',
    description:
      'Un perfil por persona con sesión en la app. Lo que se captura aquí decide qué ve cada quien en <b>Horas</b> y cómo se cruza el reporte del checador con los usuarios.',
    side: 'bottom',
  },
  {
    selector: '[data-tour="team-table"]',
    title: 'Rol, id del checador y jornada',
    description:
      '<b>Administrador</b> ve a todo el equipo, importa el reporte y corrige checadas; <b>Miembro</b> solo ve lo suyo. El <b>id del checador</b> es el número entre paréntesis en el reporte semanal (vacío = no checa). La <b>jornada</b> (tiempo completo 8 h o medio tiempo 4 h) es la referencia que dibujan las gráficas de Horas. Edita con el lápiz; siempre debe quedar al menos un administrador.',
  },
]
