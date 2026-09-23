"""
Cache da última observação real por via — sustenta a feature de recência
(razao_lag1, delta_min_lag1) da LIA 2.1.

Diferente dos perfis (agregados fixos, calculados no treino e carregados uma
vez do .pkl) e do grafo enriquecido (topologia, muda raramente), a recência
muda a cada ciclo de coleta (~8 min). Por isso este módulo NÃO é um valor fixo
carregado na subida do servidor — é um cache em memória com TTL curto,
atualizado sob demanda a cada requisição, sem bloquear o caminho comum.

Ver ml/features.py:add_recency_features() para a contraparte de
treino, e LIA_2.0_AUDITORIA_E_MUDANCAS.md seção 11 para a motivação: essa
feature, sozinha, fecha quase toda a diferença que um LSTM conseguiria com uma
arquitetura muito mais cara.
"""
import logging
import math
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

# Cobre com folga um ciclo de coleta (~8 min, 630 vias) sem precisar paginar.
LIMITE_LINHAS_BUSCA = 2000

# Não busca de novo a cada requisição — só quando o cache passa desta idade.
# Mantido abaixo do ciclo de coleta para nunca ficar mais de ~1 ciclo desatualizado.
TTL_SEGUNDOS = 5 * 60


def _agora_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


class RecenciaCache:
    """Última (razão, timestamp) observada por via.

    Não é thread-safe por desenho: FastAPI roda um único processo de evento por
    worker, e refrescar_se_necessario() não faz await no meio de uma leitura —
    não há janela para condição de corrida dentro do mesmo worker.
    """

    def __init__(self):
        self._dados: Dict[int, Tuple[float, datetime]] = {}
        self._ultima_busca: float = 0.0

    def _buscar(self, sb) -> None:
        # Marca a TENTATIVA, não o sucesso: com o Supabase fora do ar, cada
        # requisição re-tentava a busca (e pagava o timeout). Agora o TTL vale
        # também como backoff.
        self._ultima_busca = time.time()
        if sb is None:
            logging.warning(
                "RecenciaCache: sem cliente Supabase — cache permanece vazio/desatualizado"
            )
            return

        try:
            resp = (
                sb.table('historico_trafego')
                .select('id_ponto, velocidade_atual, velocidade_livre, data_hora_coleta')
                .order('id_coleta', desc=True)
                .limit(LIMITE_LINHAS_BUSCA)
                .execute()
            )
        except Exception as e:
            logging.warning(
                f"RecenciaCache: falha ao buscar do Supabase ({e}); mantendo cache anterior"
            )
            return

        novos: Dict[int, Tuple[float, datetime]] = {}
        for linha in resp.data or []:
            via = linha.get('id_ponto')
            # Já ordenado desc por id_coleta: a primeira ocorrência de cada via
            # é a mais recente — ignora as demais.
            if via is None or via in novos:
                continue

            vl, va, ts = (
                linha.get('velocidade_livre'),
                linha.get('velocidade_atual'),
                linha.get('data_hora_coleta'),
            )
            if not vl or not va or not ts:
                continue

            try:
                razao = min(max(float(va) / float(vl), 0.05), 1.0)
                timestamp = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
                if timestamp.tzinfo is None:
                    # A coluna é timestamptz (UTC), mas o PostgREST às vezes
                    # devolve a string sem 'Z' nem offset (confirmado em
                    # produção: '2026-07-20T00:33:24.384683', sem indicação de
                    # fuso). fromisoformat() then produz um datetime "naive",
                    # que quebra na subtração com _agora_utc() em get(). Trata
                    # explicitamente como UTC em vez de confiar na string.
                    timestamp = timestamp.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError, ZeroDivisionError):
                continue

            novos[via] = (razao, timestamp)

        if novos:
            self.mesclar(novos)
            logging.info(f"RecenciaCache: {len(novos)} vias lidas do banco")
        else:
            logging.warning(
                "RecenciaCache: busca não retornou nenhuma via válida; mantendo cache anterior"
            )

    def refrescar_se_necessario(self, sb) -> None:
        """Chamar no início de cada requisição que use recência. Custo desprezível
        quando o cache ainda está fresco (só compara um timestamp)."""
        if time.time() - self._ultima_busca > TTL_SEGUNDOS:
            self._buscar(sb)

    def mesclar(self, novos: Dict[int, Tuple[float, datetime]]) -> None:
        """Merge, não substituição: a leitura ao vivo da TomTom (registrar) é
        mais nova que o banco depois que a coleta contínua parou."""
        for via, (razao, timestamp) in novos.items():
            atual = self._dados.get(via)
            if atual is None or timestamp > atual[1]:
                self._dados[via] = (razao, timestamp)

    def registrar(self, id_ponto, razao: float) -> None:
        """Observação ao vivo (TomTom sob demanda) — vale como a mais recente."""
        self._dados[id_ponto] = (min(max(float(razao), 0.05), 1.0), _agora_utc())

    def resumo(self) -> Dict[str, object]:
        """Contagem e observação mais recente — para o /health e o painel ADM."""
        mais_recente = max((ts for _, ts in self._dados.values()), default=None)
        return {'vias': len(self._dados), 'mais_recente': mais_recente.isoformat() if mais_recente else None}

    def idade_min(self, id_ponto) -> Optional[float]:
        """Minutos desde a última observação da via, ou None se nunca vista."""
        entrada = self._dados.get(id_ponto)
        if entrada is None:
            return None
        return max((_agora_utc() - entrada[1]).total_seconds() / 60.0, 0.0)

    def get(self, id_ponto) -> Optional[Dict[str, float]]:
        """Devolve {'razao_lag1':.., 'delta_min_lag1':..} já no formato de
        feature (delta já em log1p), ou None se a via não está no cache — via
        nunca observada, ou fora da janela das últimas LIMITE_LINHAS_BUSCA
        linhas. `lia_inference.montar_features` trata None com o fallback
        conservador (perfil histórico + defasagem assumida de 24h).
        """
        entrada = self._dados.get(id_ponto)
        if entrada is None:
            return None

        razao, timestamp = entrada
        delta_min = max((_agora_utc() - timestamp).total_seconds() / 60.0, 0.0)
        return {
            'razao_lag1': razao,
            'delta_min_lag1': math.log1p(delta_min),
        }
