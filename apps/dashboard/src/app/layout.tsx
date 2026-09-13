import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TopNav } from '@/components/TopNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Machina — Merchant Dashboard',
  description: 'Multi-tenant product intelligence gateway: demand, catalogue gaps, evidence approval, validation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-machina-bg text-machina-text">
        <Suspense fallback={null}>
          <TopNav />
        </Suspense>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
