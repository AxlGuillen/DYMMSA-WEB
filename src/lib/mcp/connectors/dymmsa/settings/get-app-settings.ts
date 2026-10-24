import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getAppSettings } from '@/lib/mcp/tools/settings'

export const getAppSettingsTool = defineTool({
  connector: 'dymmsa',
  name: 'get_app_settings',
  kind: 'read',
  title: 'Configuración de la app',
  description:
    'Parámetros que usan los planificadores: umbrales del planificador de compra (dinero parado en MXN y % parado) y margen por corte en mm. Indica cuáles están guardados y cuáles corren con el default del código.',
  input: {},
  hints: dymmsaRead,
  docs: {
    module: 'Configuracion',
    title: 'Configuracion de la app',
    example: '¿Que umbrales tiene el planificador de compra?',
  },
  handler: (_input, { db }) => getAppSettings(db),
})
