import { EstresseCenarios } from '@/components/graficos';
import { Cartao, Tabela } from '@/components/ui';
import { fmtDec, fmtDia, num, rotuloVersao } from '@/lib/formato';
import type { EstresseLia22 } from '@/lib/tipos';

// Rótulo do eixo e o que muda na entrada, conforme ml/context_stress_test.py. Cenário novo cai no próprio id.
const CENARIOS: Record<string, { curto: string; muda: string }> = {
  fresco: { curto: 'Fresco', muda: 'Como no treino: leitura da via e dos vizinhos recentes.' },
  sem_vizinhos: { curto: 'Sem vizinhos', muda: 'Via lida agora, nenhum vizinho nos últimos 60 min.' },
  chuva_zero: { curto: 'Chuva = 0', muda: 'Open-Meteo fora do ar: a API manda chuva 0.' },
  chuva_nan: { curto: 'Chuva ausente', muda: 'Chuva como NaN (mostra por que a API manda 0).' },
  tudo_velho: { curto: 'Tudo velho', muda: 'Fora do corredor: recência = perfil de 24 h, sem vizinhos.' },
  tudo_velho_chuva_nan: { curto: 'Velho + sem chuva', muda: 'Tudo velho e chuva ausente.' },
};

const sinal = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtDec(Math.abs(v))} s`;

/** Estresse treino × produção (ml/artifacts/lia_2.2_estresse.json): duas versões com a entrada degradada. */
export function Estresse({ e, ativo }: { e: EstresseLia22; ativo: string | null }) {
  const cenarios = Object.entries(e.cenarios ?? {});
  const versoes = Object.keys(cenarios[0]?.[1] ?? {});
  if (!cenarios.length || versoes.length < 2) return null;
  // A primeira versão é a base; a última, a que se testa contra ela.
  const [base, nova] = [versoes[0], versoes[versoes.length - 1]];
  const nome = (v: string) => `${rotuloVersao(v)}${v === ativo ? ' (ativa)' : ''}`;
  const linhas = cenarios.map(([id, c]) => ({
    id,
    curto: CENARIOS[id]?.curto ?? id,
    muda: CENARIOS[id]?.muda ?? '',
    base: c[base],
    nova: c[nova],
    delta: num(c[nova]?.rmse_seg) !== null && num(c[base]?.rmse_seg) !== null ? (c[nova].rmse_seg - c[base].rmse_seg) : null,
  }));
  const perde = linhas.filter((l) => l.delta !== null && l.delta > 0);

  return (
    <Cartao
      titulo={`Estresse treino × produção · ${rotuloVersao(base)} × ${rotuloVersao(nova)}`}
      className="mb-5"
      atraso={380}
      siglas={['RMSE', 'MAE', 'fold']}
      nota={
        <>
          Fold {e.fold} do TimeSeriesSplit ({fmtDia(e.val_periodo?.[0])} a {fmtDia(e.val_periodo?.[1])}), mesmos hiperparâmetros; só a entrada da
          validação muda. No dataset, {fmtDec(e.pct_linhas_sem_vizinho_recente)}% das linhas não têm vizinho recente e {fmtDec(e.pct_linhas_com_chuva)}% têm
          chuva.{' '}
          {perde.length
            ? `${rotuloVersao(nova)} perde para ${rotuloVersao(base)} em: ${perde
                .map((l) => `${l.curto.toLowerCase()} (${sinal(l.delta as number)})`)
                .join('; ')}. Δ = RMSE de ${rotuloVersao(nova)} − RMSE de ${rotuloVersao(base)}; positivo = pior.`
            : `${rotuloVersao(nova)} não perde para ${rotuloVersao(base)} em nenhum cenário.`}
        </>
      }
    >
      <EstresseCenarios
        dados={linhas.map((l) => ({ cenario: l.curto, base: l.base?.rmse_seg ?? 0, nova: l.nova?.rmse_seg ?? 0 }))}
        nomeBase={nome(base)}
        nomeNova={nome(nova)}
      />
      <div className="mt-5">
        <Tabela cabecalho={['Cenário', 'O que muda na entrada', `RMSE ${nome(base)}`, `RMSE ${nome(nova)}`, 'Δ RMSE', `MAE ${nome(base)}`, `MAE ${nome(nova)}`]}>
          {linhas.map((l) => (
            <tr key={l.id}>
              <td className="font-medium">{l.curto}</td>
              <td className="max-w-64 text-xs text-muted-foreground">{l.muda}</td>
              <td className="num">{fmtDec(l.base?.rmse_seg)} s</td>
              <td className="num">{fmtDec(l.nova?.rmse_seg)} s</td>
              <td className={`num ${l.delta !== null && l.delta > 0 ? 'font-medium text-alerta' : ''}`}>{l.delta === null ? 'n/d' : sinal(l.delta)}</td>
              <td className="num">{fmtDec(l.base?.mae_seg)} s</td>
              <td className="num">{fmtDec(l.nova?.mae_seg)} s</td>
            </tr>
          ))}
        </Tabela>
      </div>
    </Cartao>
  );
}
