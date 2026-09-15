// Portada pública: presenta el sistema y lleva al ingreso. Sin detalles técnicos,
// porque la ve cualquiera que abra la dirección.
const MODULOS = [
  { nombre: 'Ventas rápidas y caja', detalle: 'cobro en pesos, reales, Nequi, Bold y PIX, con cuadre por jornada' },
  { nombre: 'Inventario y compras', detalle: 'existencias, presentaciones, vencimientos y proveedores' },
  { nombre: 'Gastos y caja menor', detalle: 'el dinero del día a día y el flujo de caja' },
  { nombre: 'Reportes', detalle: 'ganancia neta, más vendidos, productos por pedir y POLA' },
]

export default function Home() {
  return (
    <main className="landing">
      <div className="eyebrow">JCA Soft · Kaizen</div>
      <h1>Liquor<b>·</b>Express</h1>
      <div className="divider" />
      <p className="sub">Sistema de administración de la licorera — Leticia, Amazonas.</p>

      <div className="status">
        <h3>Lo que maneja el sistema</h3>
        <ul>
          {MODULOS.map((m) => (
            <li key={m.nombre}><span className="dot ok" /> <span><b>{m.nombre}</b> — {m.detalle}</span></li>
          ))}
          <li><span className="dot next" /> <span><b>Facturación electrónica DIAN</b> — próximamente</span></li>
        </ul>
      </div>

      <a className="pill" href="/login" style={{ marginTop: 24, color: 'var(--amber-bright)', borderColor: 'var(--line-strong)' }}>
        Ingresar al sistema →
      </a>

      <div className="foot">JCA Soft — Soluciones que impulsan tu negocio</div>
    </main>
  )
}
