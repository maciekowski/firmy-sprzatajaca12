import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaRegister } from '@/components/pwa-register';

export const metadata: Metadata = {
  title: {
    default: 'ServiceFlow — system operacyjny dla firm usługowych',
    template: '%s | ServiceFlow',
  },
  description:
    'Od pierwszego zapytania klienta, przez wycenę i grafik ekipy, aż po wykonanie zlecenia, fakturę i płatność.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1c5cf5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
