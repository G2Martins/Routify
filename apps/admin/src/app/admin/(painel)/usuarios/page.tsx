import { Cabecalho, Cartao, ErroConsulta } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import type { Usuario } from '@/lib/tipos';
import { TabelaUsuarios } from './TabelaUsuarios';

export default async function UsuariosPage() {
  const { sb, user } = await exigirAdmin();
  const lista = await sb.rpc('admin_usuarios');
  const usuarios = (lista.data ?? []) as Usuario[];
  // `bloqueado` vem do banco (banned_until vigente), não do painel.
  const bloqueados = usuarios.filter((u) => u.bloqueado).map((u) => u.id);

  return (
    <>
      <Cabecalho
        titulo="Usuários"
        sobre="Contas cadastradas e ações de administração. O papel de administrador vem de app_metadata, que só o banco grava — ninguém se promove pelo app. Toda ação é auditada."
      />
      <div className="space-y-5">
        <ErroConsulta erro={lista.error} acoes />
        <Cartao nota="Na própria conta, só a exportação fica liberada.">
          <TabelaUsuarios usuarios={usuarios} bloqueados={bloqueados} eu={user.id} />
        </Cartao>
      </div>
    </>
  );
}
