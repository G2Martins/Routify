import { Arquitetura } from '@/components/Arquitetura';
import { Cabecalho } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';

export default async function ArquiteturaPage() {
  const { sb } = await exigirAdmin();
  // Sonda leve: se a RPC admin responde, banco + RLS + papel admin estão de pé.
  const { error } = await sb.rpc('admin_resumo_uso', { dias: 1 });

  return (
    <>
      <Cabecalho
        titulo="Arquitetura viva"
        sobre="Os fluxos da plataforma com o status de cada componente em tempo real. Escolha um fluxo para destacá-lo."
      />
      <Arquitetura supabaseOk={!error} />
    </>
  );
}
