import type { NextRequest } from 'next/server';
import { getMerchant, listMerchants, type Merchant } from '@machina/database';

// Multi-tenant dashboard: which merchant is "current" is carried via a `?merchant=` query
// param (set by the TopNav switcher), never a global default baked into the server. Falls
// back to the first merchant in the dataset only when nothing has been selected yet.
export function resolveMerchant(requestedId: string | null | undefined): Merchant {
  if (requestedId) {
    const merchant = getMerchant(requestedId);
    if (merchant) return merchant;
  }
  const merchants = listMerchants();
  if (merchants.length === 0) {
    throw new Error('No merchants seeded — run npm run db:seed first.');
  }
  return merchants[0];
}

// For API route handlers: read `?merchant=` off the request URL.
export function resolveMerchantFromRequest(req: NextRequest): Merchant {
  return resolveMerchant(req.nextUrl.searchParams.get('merchant'));
}
