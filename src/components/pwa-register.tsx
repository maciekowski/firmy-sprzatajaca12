'use client';

import { useEffect } from 'react';

/**
 * Rejestracja Service Workera (tylko na buildzie produkcyjnym).
 * W trybie deweloperskim wyłączona — nie chcemy serwować starej wersji zasobów.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // brak SW nie może zepsuć aplikacji (np. przeglądarka bez wsparcia)
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
