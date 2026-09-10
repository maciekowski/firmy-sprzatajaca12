/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Podgląd w sandboxie działa na zewnętrznym hoście (https) — pozwalamy na to w trybie dev.
  allowedDevOrigins: ['*.e2b.app', '*.arena.ai', '*.arena.ai:443', 'localhost:3000'],
  serverExternalPackages: ['pdfkit', 'nodemailer', 'stripe'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
    /**
     * Włącza przerwania autoryzacyjne Next.js: forbidden() → 403 (strona
     * src/app/forbidden.tsx) oraz unauthorized() → 401. Bez tego brak
     * uprawnień kończył się błędem 500 zamiast poprawną odpowiedzią 403.
     */
    authInterrupts: true,
  },
};

export default nextConfig;
