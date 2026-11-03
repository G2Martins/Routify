import { Cabecalho } from '@/components/ui';
import { PainelStatus } from './PainelStatus';

export default function StatusPage() {
  return (
    <>
      <Cabecalho
        titulo="Status ao vivo"
        sobre="Banco, API da LIA na AWS, coleta, comparador, site e os provedores de que o Routify depende. Atualiza a cada 30 s com a aba aberta."
      />
      <PainelStatus />
    </>
  );
}
