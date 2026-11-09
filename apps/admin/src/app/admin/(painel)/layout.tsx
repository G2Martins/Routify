import { Suspense } from 'react';
import { BarraProgresso } from '@/components/BarraProgresso';
import { Sidebar } from '@/components/Sidebar';
import { exigirAdmin } from '@/lib/auth';

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { user } = await exigirAdmin();
  return (
    <div className="md:flex">
      <Suspense fallback={null}>
        <BarraProgresso />
      </Suspense>
      <Sidebar email={user.email ?? ''} />
      <main className="fundo-mapa min-h-dvh min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
