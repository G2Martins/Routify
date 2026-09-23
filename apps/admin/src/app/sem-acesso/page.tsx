import { Sair } from './Sair';

export default function SemAcessoPage() {
  return (
    <main className="fundo-mapa grid min-h-dvh place-items-center px-4">
      <div className="surgir max-w-md rounded-xl border border-border bg-card p-8">
        <p className="font-display text-4xl leading-none">Sem acesso</p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Sua conta não tem o papel de administrador. O papel é concedido no banco (app_metadata) por quem administra o
          projeto; depois da promoção, saia e entre de novo para o token trazer o papel novo.
        </p>
        <Sair />
      </div>
    </main>
  );
}
