'use client';

import { createBrowserClient } from '@supabase/ssr';
import { OPCOES_COOKIE } from './cookie';

export function clienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    { cookieOptions: OPCOES_COOKIE },
  );
}
