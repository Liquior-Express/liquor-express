export default function Home() {
  return (
    <main className="landing">
      <div className="eyebrow">JCA Soft · Kaizen</div>
      <h1>Liquor<b>·</b>Express</h1>
      <div className="divider" />
      <p className="sub">
        Sistema de administración — Leticia, Amazonas. Proyecto en construcción (Sprint 1).
      </p>

      <div className="stack">
        <span className="pill">Frontend <b>Next.js</b></span>
        <span className="pill">Backend <b>Node/Express</b></span>
        <span className="pill">Base de datos <b>Supabase</b></span>
        <span className="pill">Despliegue <b>Railway</b></span>
      </div>

      <div className="status">
        <h3>Estado del proyecto</h3>
        <ul>
          <li><span className="dot ok" /> <span><b>Base técnica</b> — monorepo web + api, esquema de BD listo</span></li>
          <li><span className="dot ok" /> <span><b>Autenticación y seguridad</b> — login + roles + RLS</span></li>
          <li><span className="dot next" /> <span><b>Inventario</b> — siguiente</span></li>
        </ul>
      </div>

      <a className="pill" href="/login" style={{ marginTop: 24, color: 'var(--amber-bright)', borderColor: 'var(--line-strong)' }}>
        Ingresar al sistema →
      </a>

      <div className="foot">JCA Soft — Soluciones que impulsan tu negocio</div>
    </main>
  )
}
