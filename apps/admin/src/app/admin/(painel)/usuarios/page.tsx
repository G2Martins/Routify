import { Cabecalho, Cartao, ErroConsulta, Selo, Tabela } from '@/components/ui';
import { exigirAdmin } from '@/lib/auth';
import { fmtData, fmtInt } from '@/lib/formato';

type Usuario = {
  id: string;
  email: string;
  nome: string | null;
  criado_em: string;
  ultimo_login: string | null;
  papel: string;
  rotas: number;
};

export default async function UsuariosPage() {
  const { sb } = await exigirAdmin();
  const { data, error } = await sb.rpc('admin_usuarios');
  const usuarios = (data ?? []) as Usuario[];

  return (
    <>
      <Cabecalho
        titulo="Usuários"
        sobre="Contas cadastradas. O papel de administrador vem de app_metadata, que só o banco (service_role) grava — ninguém se promove pelo app."
      />
      <ErroConsulta erro={error} />
      <Cartao>
        <Tabela cabecalho={['Nome', 'E-mail', 'Papel', 'Cadastro', 'Último login', 'Rotas']}>
          {usuarios.map((u) => (
            <tr key={u.id}>
              <td className="font-medium">{u.nome ?? '—'}</td>
              <td className="num text-xs">{u.email}</td>
              <td>{u.papel === 'admin' ? <Selo tom="ok">admin</Selo> : <Selo tom="neutro">usuário</Selo>}</td>
              <td className="num text-xs">{fmtData(u.criado_em)}</td>
              <td className="num text-xs">{fmtData(u.ultimo_login)}</td>
              <td className="num">{fmtInt(u.rotas)}</td>
            </tr>
          ))}
        </Tabela>
      </Cartao>
    </>
  );
}
