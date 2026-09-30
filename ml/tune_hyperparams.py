"""
Otimização Bayesiana de hiperparâmetros do XGBoost — via Optuna.

Origem: item pendente desde o TCC 1 (artigo, seção 5.4 "Otimização de
Hiperparâmetros e Autocomplete") — os valores em train.py (XGB_PARAMS) sempre
foram escolhidos manualmente, nunca otimizados sistematicamente.

METODOLOGIA
-----------
Reaproveita evaluate_cv() de train.py sem modificá-la: mesmo TimeSeriesSplit
temporal (5 folds), mesmos perfis históricos recalculados DENTRO de cada fold
(sem vazamento). A busca bayesiana varia só os hiperparâmetros do XGBoost —
a metodologia de avaliação é idêntica à do treino de produção, o que torna o
resultado diretamente comparável ao baseline documentado.

Usa Optuna (TPE sampler) com poda por mediana (MedianPruner): descarta cedo
trials com folds iniciais claramente piores que a mediana dos anteriores, em
vez de rodar os 5 folds completos para configurações já ruins — cada fold
completo pode levar minutos, então isso economiza tempo real de busca.

O primeiro trial testa os hiperparâmetros ATUAIS de train.py (via
enqueue_trial) — ancora a busca num ponto já validado em vez de partir de
configurações aleatórias, e garante que o baseline documentado é sempre um
dos pontos avaliados sob exatamente as mesmas condições dos demais trials.

Uso: python tune_hyperparams.py [--n-trials 30] [--cpu] [--skip-silver]
"""
import os
import sys
import json
import logging
import argparse
import time

import optuna

sys.path.insert(0, os.path.dirname(__file__))
import silver
import features as feat
import train

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
optuna.logging.set_verbosity(optuna.logging.WARNING)  # log próprio abaixo, evita duplicidade

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'artifacts')
OUT_JSON = os.path.join(MODELS_DIR, 'hiperparametros_otimizados.json')

# Métrica na mesma unidade do alvo de treino (razão de congestionamento), não
# em segundos — otimizar em segundos privilegiaria vias de maior comprimento
# desproporcionalmente, o que não é o que o modelo é treinado para prever.
METRICA_ALVO = 'modelo_rmse_razao'

# Ganho mínimo pra recomendar trocar os hiperparâmetros de produção. Abaixo
# disso, o ruído entre folds pode explicar a diferença — mesmo princípio já
# aplicado nesta pesquisa (seção 15 da auditoria): não adotar uma correção
# sem uma melhora clara o bastante para justificá-la.
GANHO_MINIMO_PCT = 2.0


def build_search_space(trial: optuna.Trial, base_params: dict) -> dict:
    params = dict(base_params)
    params.update({
        'n_estimators': trial.suggest_int('n_estimators', 200, 1000, step=50),
        'max_depth': trial.suggest_int('max_depth', 3, 10),
        'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
        'subsample': trial.suggest_float('subsample', 0.5, 1.0),
        'colsample_bytree': trial.suggest_float('colsample_bytree', 0.5, 1.0),
        'min_child_weight': trial.suggest_int('min_child_weight', 1, 30),
        'reg_alpha': trial.suggest_float('reg_alpha', 1e-3, 10.0, log=True),
        'reg_lambda': trial.suggest_float('reg_lambda', 1e-3, 10.0, log=True),
    })
    return params


def make_objective(df, base_params):
    def objective(trial: optuna.Trial) -> float:
        params = build_search_space(trial, base_params)
        t0 = time.time()
        resumo = train.evaluate_cv(df, params)
        dur = time.time() - t0
        valor = resumo[METRICA_ALVO]
        logging.info(f"Trial {trial.number}: {METRICA_ALVO}={valor:.5f} ({dur:.0f}s)")
        return valor
    return objective


def run(n_trials: int, use_gpu: bool, skip_silver: bool) -> dict:
    os.makedirs(MODELS_DIR, exist_ok=True)

    base_params = dict(train.XGB_PARAMS)
    if use_gpu and train.check_gpu_availability(force_cpu=False):
        base_params['device'] = 'cuda'
    else:
        base_params.pop('device', None)

    if skip_silver:
        logging.info("=== Silver reaproveitado (--skip-silver) ===")
    else:
        logging.info("=== Atualizando Silver ===")
        silver.run()

    logging.info("=== Preparando features ===")
    df, _ = feat.run(version='lia_2.0')

    logging.info("")
    logging.info("=== Baseline (hiperparâmetros atuais de train.py) ===")
    resumo_baseline = train.evaluate_cv(df, base_params)
    baseline_valor = resumo_baseline[METRICA_ALVO]
    logging.info(f"Baseline {METRICA_ALVO} = {baseline_valor:.5f}")

    logging.info("")
    logging.info(f"=== Busca bayesiana — {n_trials} trials ===")
    sampler = optuna.samplers.TPESampler(seed=42)
    pruner = optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=0)
    study = optuna.create_study(direction='minimize', sampler=sampler, pruner=pruner)

    study.enqueue_trial({
        'n_estimators': base_params['n_estimators'],
        'max_depth': base_params['max_depth'],
        'learning_rate': base_params['learning_rate'],
        'subsample': base_params['subsample'],
        'colsample_bytree': base_params['colsample_bytree'],
        'min_child_weight': base_params['min_child_weight'],
        'reg_alpha': base_params['reg_alpha'],
        'reg_lambda': base_params['reg_lambda'],
    })

    study.optimize(make_objective(df, base_params), n_trials=n_trials)

    melhor = study.best_trial
    ganho = baseline_valor - melhor.value
    ganho_pct = (ganho / baseline_valor * 100) if baseline_valor else 0.0
    recomendar_troca = ganho_pct > GANHO_MINIMO_PCT

    logging.info("")
    logging.info("=== Resultado ===")
    logging.info(f"Baseline (train.py atual): {METRICA_ALVO} = {baseline_valor:.5f}")
    logging.info(f"Melhor trial (#{melhor.number}): {METRICA_ALVO} = {melhor.value:.5f}")
    logging.info(f"Ganho: {ganho:+.5f} ({ganho_pct:+.1f}%)")
    logging.info(f"Melhores hiperparâmetros: {melhor.params}")
    if recomendar_troca:
        logging.info(f"→ Ganho acima de {GANHO_MINIMO_PCT}% — recomenda-se adotar em train.py")
    else:
        logging.info(
            f"→ Ganho abaixo de {GANHO_MINIMO_PCT}% — os hiperparâmetros manuais atuais "
            f"já estavam próximos do ótimo nesta busca; manter como estão"
        )

    resultado = {
        'metodologia': (
            'Optuna (TPE sampler) com poda por mediana, reaproveitando evaluate_cv() '
            'de train.py sem modificações — mesma validação cruzada temporal '
            '(TimeSeriesSplit, 5 folds, perfis recalculados por fold). Só os '
            'hiperparâmetros do XGBoost variam entre trials.'
        ),
        'metrica_otimizada': METRICA_ALVO,
        'n_trials': n_trials,
        'ganho_minimo_para_adocao_pct': GANHO_MINIMO_PCT,
        'baseline_params': {k: v for k, v in base_params.items() if k != 'device'},
        'baseline_metrica': baseline_valor,
        'melhor_trial': melhor.number,
        'melhor_params': melhor.params,
        'melhor_metrica': melhor.value,
        'ganho_absoluto': ganho,
        'ganho_percentual': ganho_pct,
        'recomendacao': (
            'Adotar os hiperparâmetros otimizados em train.py'
            if recomendar_troca else
            'Manter os hiperparâmetros manuais atuais — ganho da busca bayesiana '
            'não foi grande o suficiente para justificar a troca'
        ),
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    logging.info(f"Resultado salvo em {OUT_JSON}")

    return resultado


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Otimização bayesiana de hiperparâmetros (Optuna)')
    parser.add_argument('--n-trials', type=int, default=30)
    parser.add_argument('--cpu', action='store_true', help='Força CPU')
    parser.add_argument('--skip-silver', action='store_true', help='Reaproveita o Silver existente')
    args = parser.parse_args()

    t0 = time.time()
    logging.info("=" * 70)
    logging.info("ROUTIFY — OTIMIZAÇÃO BAYESIANA DE HIPERPARÂMETROS (XGBoost + Optuna)")
    logging.info("=" * 70)

    run(n_trials=args.n_trials, use_gpu=not args.cpu, skip_silver=args.skip_silver)

    logging.info("=" * 70)
    logging.info(f"Concluído em {time.time() - t0:.1f}s")
    logging.info("=" * 70)
