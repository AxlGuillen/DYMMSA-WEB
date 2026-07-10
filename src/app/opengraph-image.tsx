import { ImageResponse } from 'next/og'

// Tarjeta de preview (Open Graph) para links compartidos en Slack/WhatsApp/etc.
// Se genera como PNG 1200×630 — WhatsApp no renderiza WebP, así que la tarjeta
// se dibuja con tipografía + colores de marca (rojo URREA sobre base oscura,
// igual que el login) en vez de embeber el logo .webp.
export const runtime = 'edge'
export const alt = 'DYMMSA — Sistema de Cotizaciones e Inventario'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: '#0b0b0d',
          backgroundImage:
            'radial-gradient(circle at 15% 0%, rgba(220,38,38,0.35), transparent 45%), radial-gradient(circle at 100% 100%, rgba(159,18,57,0.30), transparent 40%)',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Etiqueta superior */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            color: '#f87171',
            fontSize: '26px',
            fontWeight: 600,
            letterSpacing: '4px',
          }}
        >
          <div style={{ width: '48px', height: '6px', background: '#dc2626', borderRadius: '3px' }} />
          SISTEMA DE COTIZACIONES E INVENTARIO
        </div>

        {/* Wordmark */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: '190px', fontWeight: 800, color: '#ffffff', letterSpacing: '-4px', lineHeight: 1 }}>
            DYMMSA
          </div>
          <div style={{ display: 'flex', marginTop: '24px', fontSize: '38px', color: '#d4d4d8', fontWeight: 400 }}>
            Distribuidor autorizado de herramientas URREA
          </div>
        </div>

        {/* Pie */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            color: '#a1a1aa',
            fontSize: '30px',
          }}
        >
          <div style={{ width: '14px', height: '14px', background: '#dc2626', borderRadius: '50%' }} />
          Morelia, México
        </div>
      </div>
    ),
    { ...size },
  )
}
