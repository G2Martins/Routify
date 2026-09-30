import type { Metadata } from 'next';
import { Geist, Geist_Mono, Kalam } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const display = Kalam({ subsets: ['latin'], weight: '700', variable: '--font-kalam' });

export const metadata: Metadata = {
  title: 'Routify · Painel ADM',
  description: 'Observabilidade da plataforma Routify e acompanhamento da LIA.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Mesmo tema escolhido no app (cookie compartilhado). Sem cookie = segue o sistema.
  const tema = (await cookies()).get('routify-tema')?.value;
  const dataTema = tema === 'dark' ? 'escuro' : tema === 'light' ? 'claro' : undefined;
  return (
    <html lang="pt-BR" data-tema={dataTema} className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      {/* Extensões (ColorZilla, Grammarly) injetam atributos no body antes da hidratação. */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
