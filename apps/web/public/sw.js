// Service worker de Liquor Express: permite abrir la app y vender sin conexión.
// - Páginas: primero la red; si no hay señal, la última copia guardada.
// - Archivos de la app (_next/static): se guardan y se sirven desde el equipo.
// - Datos para vender (productos, presentaciones, tasa, caja, sesión): red y, sin señal, la última copia.
const CACHE = 'le-v1'
const API_GUARDABLES = ['/api/productos', '/api/presentaciones', '/api/tasa', '/api/caja/actual', '/api/auth/me', '/api/categorias', '/api/ventas/hoy']

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const guardar = (req, res) => {
  if (res && res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)) }
  return res
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => guardar(req, res))))
    return
  }

  const esApi = API_GUARDABLES.includes(url.pathname)
  if (req.mode === 'navigate' || esApi) {
    e.respondWith(
      fetch(req).then((res) => guardar(req, res)).catch(() =>
        caches.match(req).then((r) => {
          if (r) return r
          if (req.mode === 'navigate') return caches.match('/ventas').then((v) => v || Response.error())
          return new Response(JSON.stringify({ error: 'Sin conexión' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        }),
      ),
    )
  }
})
