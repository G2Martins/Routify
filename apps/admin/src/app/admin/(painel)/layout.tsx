import { Sidebar } from '@/components/Sidebar';
import { exigirAdmin } from '@/lib/auth';

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { user } = await exigirAdmin();
  return (
    <div className="md:flex">
      <Sidebar email={user.email ?? ''} />
      <main className="fundo-mapa min-h-dvh flex-1 px-5 py-8 md:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
