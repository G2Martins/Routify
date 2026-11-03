# Deploy 24/7 do coletor

**Última revisão:** 2026-11-02

Desde 2026-11-01 o coletor roda **na mesma EC2 da API** (custo zero): mesmo `.env` e
`tomtom_keys.json`, serviço systemd `routify-collector`. O passo a passo completo, com o
contexto da cota e da memória, está em [docs/core/deploy.md §1.1](../../../docs/core/deploy.md).

| Arquivo | Pra quê |
|---|---|
| `instalar-ec2.sh` | cria o venv mínimo, instala a unidade e sobe o serviço (idempotente, roda como root) |
| `routify-collector.service` | unidade systemd: usuário `routify`, `MemoryMax=300M`, hardening, `COLETOR_FASE3=0` |
| `requirements-ec2.txt` | só `requests`, `python-dotenv`, `schedule`, `supabase` |
| `routify-comparador.service` + `.timer` | comparador LIA × provedores: uma rodada às 03:00, 07:30, 08:30, 12:30, 15:00, 17:30, 18:30 e 22:00 (Brasília) |
| `routify-rotina.service` | rotina de validação (`scripts/rotina_validacao.py`): dispara ao fim de cada rodada do comparador, usuário dinâmico só com leitura do journal, saída em `/var/lib/routify-rotina` |
| `routify-ab.service` + `.timer` | A/B no mesmo instante nos picos de dia útil (`scripts/ab_ec2.sh`): braço B temporário na porta 8001, teto de 1,1 GB, para sozinho em `AB_ATE` |
| `requirements-vm.txt` | pilha completa (coletor + Fase 3 + API) para uma VM própria com ≥ 4 GB |

## Na EC2

```bash
# código já extraído em /opt/routify e config/{.env,tomtom_keys.json} já copiados (deploy.md §1)
sudo bash /opt/routify/services/collector/deploy/instalar-ec2.sh
journalctl -u routify-collector -f
```

Comparador: depois que a migration `20261102000000_lia_vs_provedores.sql` criar a tabela,
`sudo COMPARADOR=1 bash /opt/routify/services/collector/deploy/instalar-ec2.sh` liga o timer
(`systemctl list-timers routify-comparador.timer`; log em `journalctl -u routify-comparador`). A rotina de
validação vem junto (sem timer próprio): `sudo cat /var/lib/routify-rotina/relatorio.md`. O A/B dos picos liga com
`AB=1` (`sudo AB=1 bash …/instalar-ec2.sh`); resultados em `/var/lib/routify-ab/`.

Esperado no log: `Cadência: 1 ciclo a cada 43 min — 39 chaves × 20000/mês, 630 pontos, reserva de 15% pra API`
e, uns 6 min depois, `Salvando lote de 6xx registros`. Parar: `sudo systemctl disable --now routify-collector`.

## Variáveis de ambiente

| Variável | Efeito | Padrão |
|---|---|---|
| `COLETOR_INTERVALO_MIN` | força a cadência (min) | calculado pela cota (`intervalo_minutos`) |
| `COLETOR_COTA_MENSAL_CHAVE` | cota mensal de Flow por chave | `20000` (docs.tomtom.com/pricing) |
| `COLETOR_RESERVA_API` | fatia do pool reservada pra API sob demanda | `0.15` |
| `COLETOR_FASE3` | `1` agenda a Fase 3 (07/12/18/22 h, grafo + modelo, ~1,4 GB) | `0` |
| `TOMTOM_KEYS_FILE` | arquivo de chaves (um subconjunto, se quiser separar do pool da API) | `config/tomtom_keys.json` |

A cadência sai de `chaves × cota × (1 − reserva) / 31 dias / pontos`: com 39 chaves e 630 pontos dá 43 min
(~21 mil chamadas/dia). O teste `tests/test_rotacao.py::test_intervalo_nunca_estoura_o_orcamento` garante que o
consumo diário nunca passa do orçamento.

## Alternativa: VM própria com a Fase 3 ligada

A Fase 3 (`ml/external_validation.py`) carrega o grafo de 38 km e o modelo a cada rodada (~1,4 GB de pico) e
não cabe ao lado da API numa t3.small. Para rodá-la 24/7 é preciso uma VM com ≥ 4 GB:

- **Oracle Cloud Always Free** (Ampere A1, até 4 OCPU / 24 GB, sem prazo): tentativa de 2026-09 não concluída por
  `Out of host capacity` (falta de capacidade do provedor, não erro de configuração). Tentar outro
  *Availability Domain*/região ou outro horário.
- Na VM: `sudo timedatectl set-timezone America/Sao_Paulo` (os horários da Fase 3 são do fuso do processo),
  `git clone` do repositório inteiro (a Fase 3 importa `ml/` e `apps/api/`), `.env` e `tomtom_keys.json` por `scp`,
  venv com `pip install -r deploy/requirements-vm.txt` (**primeiro**: em ARM64 confirme que numpy/pandas/scipy/
  scikit-learn/xgboost têm wheel `aarch64` nas versões fixadas — são as que serializaram os pickles).
- Unidade: copie `routify-collector.service`, ajuste `WorkingDirectory`/`ExecStart` para o clone, tire o
  `MemoryMax` e troque `COLETOR_FASE3=0` por `1`.
- Egress não é preocupação: o coletor faz ~21 mil chamadas pequenas por dia.
