'use client';

import { sairParaApp } from '@/components/Sidebar';

export function Sair() {
  return (
    <button
      type="button"
      onClick={sairParaApp}
      className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-cta transition-all duration-200 ease-out hover:brightness-110 active:scale-[0.98]"
    >
      Sair e entrar com outra conta
    </button>
  );
}
