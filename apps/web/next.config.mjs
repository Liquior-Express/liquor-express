/** @type {import('next').NextConfig} */

// El API Express corre en el mismo servidor, en un puerto interno (API_PORT, por defecto 4000).
// Next redirige /api/* hacia ese puerto → front y back comparten dominio (un solo despliegue).
const API_PORT = process.env.API_PORT || 4000

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `http://127.0.0.1:${API_PORT}/api/:path*` },
    ]
  },
}

export default nextConfig
