'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface Merchant {
  id: string;
  name: string;
  vertical: string;
}

// Merchant switcher: the multi-tenant platform serves many merchants, but everything the
// dashboard renders is scoped to exactly one at a time, carried as a `?merchant=` query
// param on every page/link so a page refresh or shared URL keeps the same scope.
export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentMerchant = searchParams.get('merchant');
  const [merchants, setMerchants] = useState<Merchant[]>([]);

  useEffect(() => {
    fetch('/api/merchants')
      .then((r) => r.json())
      .then((json) => setMerchants(json.merchants ?? []));
  }, []);

  const withMerchant = useCallback(
    (path: string) => {
      const qs = currentMerchant ? `?merchant=${currentMerchant}` : '';
      return `${path}${qs}`;
    },
    [currentMerchant]
  );

  function onMerchantChange(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('merchant', id);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <nav className="border-b border-machina-border">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-6">
        <span className="font-semibold text-machina-accent">Machina</span>
        <span className="text-xs text-machina-muted uppercase tracking-wide hidden md:inline">
          Multi-tenant Product Intelligence Gateway
        </span>
        <select
          value={currentMerchant ?? (merchants[0]?.id ?? '')}
          onChange={(e) => onMerchantChange(e.target.value)}
          className="bg-machina-panel border border-machina-border rounded px-2 py-1 text-xs text-machina-text"
        >
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} — {m.name} ({m.vertical})
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-4 text-sm">
          <Link href={withMerchant('/')} className="hover:text-machina-accent">Dashboard</Link>
          <Link href={withMerchant('/approval')} className="hover:text-machina-accent">Approval</Link>
          <Link href={withMerchant('/report')} className="hover:text-machina-accent">Report</Link>
        </div>
      </div>
    </nav>
  );
}
