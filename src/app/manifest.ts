import type { MetadataRoute } from 'next';

/** Manifest PWA — aplikacja instalowalna (ważne dla pracownika w terenie). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ServiceFlow — system dla firm usługowych',
    short_name: 'ServiceFlow',
    description: 'Zlecenia, grafik, wykonanie w terenie, faktury i płatności.',
    lang: 'pl',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f7f9',
    theme_color: '#1c5cf5',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
