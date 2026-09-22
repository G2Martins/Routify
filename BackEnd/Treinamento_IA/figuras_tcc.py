"""
Figuras do texto final do TCC — recomendações do orientador (set/2026).

Lê só artefatos versionados em models/*.json (número da tese vem de artefato,
nunca digitado à mão) e grava SVG (texto) + PNG (slides) em Docs/figuras/:

  fig1_erro_versoes            MAE e RMSE (s) da LIA 1.0 → 2.0 → 2.1 × baseline histórico
  fig2_calibracao_transfer     confiança do Knowledge Transfer × distância (isotônica)
  fig3_benchmark_lstm_xgboost  RMSE por fold e tempo de treino: XGBoost, +recência, LSTM
  fig4_erro_congestionamento   RMSE geral × subconjunto congestionado (razão < 0,95)

Uso (a partir de BackEnd/Treinamento_IA): python figuras_tcc.py
"""
import json
import os

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(AQUI, 'models')
SAIDA = os.path.normpath(os.path.join(AQUI, '..', '..', 'Docs', 'figuras'))

# Paleta de referência da skill dataviz, validada (validate_palette.js) sobre
# fundo branco: azul/laranja/água passam CVD e visão normal. Água fica abaixo
# de 3:1 de contraste, então sempre sai com rótulo direto.
AZUL, LARANJA, AGUA = '#2a78d6', '#eb6834', '#1baf7a'
CINZA = '#b5b3ab'  # contexto: destaca uma série, o resto em cinza
TINTA, TINTA_2, TINTA_MUDA = '#0b0b0b', '#52514e', '#898781'
GRADE, EIXO, FUNDO = '#e1e0d9', '#c3c2b7', '#ffffff'

plt.rcParams.update({
    'font.family': ['Segoe UI', 'DejaVu Sans'],
    'font.size': 10,
    'axes.edgecolor': EIXO, 'axes.labelcolor': TINTA_2, 'axes.titlecolor': TINTA,
    'axes.spines.top': False, 'axes.spines.right': False,
    'axes.grid': True, 'axes.grid.axis': 'y', 'grid.color': GRADE, 'grid.linewidth': 0.6,
    'axes.axisbelow': True,
    'xtick.color': EIXO, 'ytick.color': EIXO,
    'xtick.labelcolor': TINTA_2, 'ytick.labelcolor': TINTA_2,
    'figure.facecolor': FUNDO, 'axes.facecolor': FUNDO,
    'legend.frameon': False, 'svg.fonttype': 'none',
    'hatch.color': TINTA_MUDA, 'hatch.linewidth': 0.6,
})


def _json(nome):
    with open(os.path.join(MODELS, nome), encoding='utf-8') as f:
        return json.load(f)


def _br(valor, casas=1):
    """12.34 → '12,3' (decimal pt-BR)."""
    return f'{valor:.{casas}f}'.replace('.', ',')


def _ganho(valor, base):
    pct = (valor - base) / base * 100
    return f"{'+' if pct > 0 else '−'}{_br(abs(pct))}%"


# Fundo do próprio texto: linha de referência que passa atrás não corta o rótulo.
CAIXA = {'facecolor': FUNDO, 'edgecolor': 'none', 'pad': 0.8}


def _nota(fig, texto):
    fig.text(0.01, -0.02, texto, fontsize=7.5, color=TINTA_MUDA, va='top', ha='left')


def _salvar(fig, nome):
    os.makedirs(SAIDA, exist_ok=True)
    for ext in ('svg', 'png'):
        fig.savefig(os.path.join(SAIDA, f'{nome}.{ext}'), dpi=200, bbox_inches='tight')
    plt.close(fig)
    print(f'  Docs/figuras/{nome}.svg|png')


def _separar(valores, folga):
    """Posições y dos rótulos diretos com espaçamento mínimo `folga`, preservando a ordem."""
    ordem = sorted(range(len(valores)), key=lambda i: valores[i])
    pos = list(valores)
    for anterior, atual in zip(ordem, ordem[1:]):
        pos[atual] = max(pos[atual], pos[anterior] + folga)
    return pos


def fig1_erro_versoes():
    v10 = _json('lia_1.0_supabase_metadata.json')
    bench = _json('benchmark_lstm_vs_xgboost.json')['xgboost']
    cv = _json('lia_2.1_metadata.json')['cv']
    # (rótulo, MAE, desvio MAE, RMSE, desvio RMSE, comparável) — chave JSON de cada número:
    versoes = [
        ('LIA 1.0*', v10['cv_mae_medio_seg'], None,               # lia_1.0_supabase_metadata.json
         v10['cv_rmse_medio_seg'], v10.get('cv_rmse_std_seg'), False),
        ('LIA 2.0†', bench['mae_seg_media'], bench['mae_seg_std'],  # benchmark_…json › xgboost
         bench['rmse_seg_media'], bench['rmse_seg_std'], True),
        ('LIA 2.1', cv['modelo_mae_seg'], cv['modelo_mae_seg_std'],  # lia_2.1_metadata.json › cv
         cv['modelo_rmse_seg'], cv['modelo_rmse_seg_std'], True),
    ]
    paineis = [('MAE (s)', 1, 2, cv['baseline_mae_seg']), ('RMSE (s)', 3, 4, cv['baseline_rmse_seg'])]

    fig, eixos = plt.subplots(1, 2, figsize=(9.5, 4.6), sharey=True)
    for ax, (titulo, i_val, i_dp, base) in zip(eixos, paineis):
        for x, v in enumerate(versoes):
            valor, desvio, comparavel = v[i_val], v[i_dp], v[5]
            cor = AZUL if v[0] == 'LIA 2.1' else CINZA
            if comparavel:
                ax.bar(x, valor, width=0.6, color=cor, edgecolor=FUNDO, linewidth=1.5)
            else:  # hachura = não comparável (também sobrevive à impressão P&B)
                ax.bar(x, valor, width=0.6, color=FUNDO, edgecolor=TINTA_MUDA, hatch='///', linewidth=0.9)
            if desvio:
                ax.errorbar(x, valor, yerr=desvio, color=TINTA_2, capsize=3, linewidth=0.9)
            rotulo = f'{_br(valor)} s' + (f'\n{_ganho(valor, base)} vs. baseline' if comparavel else '')
            ax.text(x, valor + (desvio or 0) + 2.5, rotulo, ha='center', va='bottom', fontsize=8.5,
                    color=TINTA, bbox=CAIXA, zorder=5)
        ax.axhline(base, color=TINTA_2, linestyle=(0, (4, 3)), linewidth=1.1)
        ax.set_xticks(range(len(versoes)), [v[0] for v in versoes])
        ax.set_title(f'{titulo} — baseline {_br(base)} s', loc='left', fontsize=10.5)
        ax.set_xlim(-0.6, len(versoes) - 0.4)
    eixos[0].set_ylabel('erro na validação cruzada (s)')
    eixos[0].set_ylim(0, max(v[3] + (v[4] or 0) for v in versoes) * 1.28)
    fig.legend(handles=[Line2D([], [], color=TINTA_2, linestyle=(0, (4, 3)), linewidth=1.1,
                               label='baseline histórico (perfil via × hora × dia)')],
               loc='upper right', fontsize=8.5)
    fig.suptitle('Erro de validação por versão da LIA', x=0.01, ha='left', fontsize=12, color=TINTA)
    _nota(fig, '* LIA 1.0: validação cruzada não temporal e alvo em segundos por trecho — não comparável com as demais.\n'
               '† LIA 2.0: XGBoost sem recência no benchmark LSTM × XGBoost (mesmos cortes temporais; re-rodar o CV antes do número final).\n'
               'Barras de erro: desvio padrão entre os 5 folds temporais. Fonte: BackEnd/Treinamento_IA/models/*.json.')
    _salvar(fig, 'fig1_erro_versoes')


def fig2_calibracao_transfer():
    c = _json('calibracao_transfer.json')
    grade, bins, met = c['curva_isotonica_grade_10m'], c['curva_erro_distancia_bins'], c['metodologia']
    antiga = list(c['constante_antiga'].values())  # [<200 m, 200–500 m, ≥500 m]
    dmax = met['dist_max_m']

    fig, ax = plt.subplots(figsize=(8.5, 4.6))
    ax.plot([0, 200, 200, 500, 500, dmax], [antiga[0], antiga[0], antiga[1], antiga[1], antiga[2], antiga[2]],
            color=LARANJA, linestyle=(0, (5, 3)), linewidth=1.6, label='escala antiga (fixa, sem base estatística)')
    ax.scatter([b['centro_m'] for b in bins], [b['confianca_calibrada'] for b in bins], s=40, color=CINZA,
               edgecolor=FUNDO, linewidth=1.2, zorder=3, label='confiança do erro médio de cada faixa')
    ax.plot(grade['distancias_m'], grade['confiancas'], color=AZUL, linewidth=2.0, zorder=4,
            label='curva calibrada (regressão isotônica)')

    g = dict(zip(grade['distancias_m'], grade['confiancas']))
    for d in (100, 200, 400, 500):
        ax.plot(d, g[d], 'o', color=AZUL, markersize=6, markeredgecolor=FUNDO, markeredgewidth=1.2, zorder=5)
        ax.annotate(_br(g[d], 3), (d, g[d]), xytext=(16 if d == 500 else 0, -15), textcoords='offset points',
                    ha='center', fontsize=8, color=TINTA, bbox=CAIXA, zorder=6)
    ax.axvline(500, color=TINTA_MUDA, linestyle=':', linewidth=1)
    ax.text(510, 1.03, 'raio do transfer (500 m)', fontsize=8.5, color=TINTA_2, va='bottom')

    ax.set(xlim=(0, dmax), ylim=(-0.03, 1.1),
           xlabel='distância até a via monitorada de referência (m)', ylabel='confiança do transfer')
    ax.grid(axis='x', visible=False)
    ax.legend(loc='upper right', fontsize=8.5, bbox_to_anchor=(1.0, 0.93))
    n_pares = f"{met['n_pares_totais']:,}".replace(',', '.')
    ax.set_title(f'Knowledge Transfer: confiança × distância ({n_pares} pares de vias monitoradas)',
                 loc='left', fontsize=11)
    _nota(fig, 'Confiança = (teto − erro) / (teto − piso), limitada a [0, 1]: piso = dispersão interna média de uma via; '
               'teto = erro do fallback global.\nCurva: IsotonicRegression não crescente sobre a confiança de cada par (já recortada); '
               'pontos: confiança do erro médio da faixa. A média de valores\nrecortados fica acima do recorte da média — '
               'por isso a curva passa acima dos pontos além de ~600 m (fora do raio usado pela API). '
               'Fonte: models/calibracao_transfer.json.')
    _salvar(fig, 'fig2_calibracao_transfer')


def fig3_benchmark_lstm_xgboost():
    b = _json('benchmark_lstm_vs_xgboost.json')
    modelos = [  # cor segue o modelo em todas as figuras (azul = modelo de produção)
        ('xgboost_com_recencia', 'XGBoost + recência (LIA 2.1)', AZUL),
        ('xgboost', 'XGBoost sem recência (LIA 2.0)', LARANJA),
        ('lstm', 'LSTM', AGUA),
    ]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10.5, 4.4), gridspec_kw={'width_ratios': [2.1, 1]})

    folds = list(range(1, len(b['xgboost']['folds']) + 1))
    finais = [b[k]['folds'][-1]['rmse_seg'] for k, _, _ in modelos]
    for (chave, nome, cor), y_rotulo in zip(modelos, _separar(finais, 2.6)):
        rmse = [f['rmse_seg'] for f in b[chave]['folds']]
        a1.plot(folds, rmse, color=cor, linewidth=2, marker='o', markersize=6,
                markeredgecolor=FUNDO, markeredgewidth=1.2,
                label=f"{nome} — média {_br(b[chave]['rmse_seg_media'])} s")
        a1.text(folds[-1] + 0.12, y_rotulo, nome.split(' (')[0], va='center', fontsize=8.5, color=TINTA)
    a1.set(xticks=folds, xlim=(0.8, folds[-1] + 1.35), xlabel='fold temporal (TimeSeriesSplit, passado → futuro)',
           ylabel='RMSE (s)')
    a1.set_title('RMSE por fold', loc='left', fontsize=10.5)
    a1.legend(loc='upper right', fontsize=8)

    for y, (chave, nome, cor) in enumerate(modelos):
        media, dp = b[chave]['tempo_treino_s_media'], b[chave]['tempo_treino_s_std']
        a2.barh(y, media, xerr=dp, height=0.42, color=cor, edgecolor=FUNDO, linewidth=1.5,
                error_kw={'ecolor': TINTA_2, 'elinewidth': 0.9, 'capsize': 3})
        a2.text(media + dp + 0.3, y, f'{_br(media)} s', va='center', fontsize=8.5, color=TINTA)
        # nome acima da barra: rótulo de eixo longo invadiria o painel da esquerda
        a2.text(0, y - 0.3, nome.split(' (')[0], va='bottom', fontsize=8.5, color=TINTA_2)
    a2.set_yticks([])
    a2.set_ylim(len(modelos) - 0.45, -0.9)  # invertido, com folga pro nome da 1ª barra
    a2.grid(axis='y', visible=False)
    a2.grid(axis='x', visible=True)
    a2.set_xlim(0, max(b[k]['tempo_treino_s_media'] + b[k]['tempo_treino_s_std'] for k, _, _ in modelos) * 1.3)
    a2.set_title('tempo de treino por fold (s)', loc='left', fontsize=10.5)

    fig.suptitle('Benchmark LSTM × XGBoost (alvo: razão de congestionamento)', x=0.01, ha='left',
                 fontsize=12, color=TINTA)
    _nota(fig, 'Mesmos cortes temporais para os três modelos; erro convertido para segundos pelo comprimento real do trecho. '
               'Tempos medidos na mesma máquina.\nFonte: models/benchmark_lstm_vs_xgboost.json.')
    _salvar(fig, 'fig3_benchmark_lstm_xgboost')


def fig4_erro_congestionamento():
    meta = _json('lia_2.1_metadata.json')
    cv = meta['cv']
    grupos = ['todas as observações',
              f"trechos congestionados\n(razão < 0,95 — {_br(meta['pct_congestionado'])}% das amostras)"]
    series = [
        ('baseline histórico', [cv['baseline_rmse_seg'], cv['baseline_rmse_seg_congestionado']], CINZA),
        ('LIA 2.1', [cv['modelo_rmse_seg'], cv['modelo_rmse_seg_congestionado']], AZUL),
    ]
    fig, ax = plt.subplots(figsize=(7.5, 4.4))
    largura = 0.34
    for s, (nome, valores, cor) in enumerate(series):
        for g, valor in enumerate(valores):
            x = g + (s - 0.5) * largura
            ax.bar(x, valor, width=largura, color=cor, edgecolor=FUNDO, linewidth=1.5,
                   label=nome if g == 0 else None)
            rotulo = f'{_br(valor)} s'
            if nome == 'LIA 2.1':
                rotulo += f'\n{_ganho(valor, series[0][1][g])}'
            ax.text(x, valor + 2, rotulo, ha='center', va='bottom', fontsize=8.5, color=TINTA)
    ax.set_xticks(range(len(grupos)), grupos)
    ax.set_ylabel('RMSE na validação cruzada (s)')
    ax.set_ylim(0, max(cv['baseline_rmse_seg_congestionado'], cv['modelo_rmse_seg_congestionado']) * 1.3)
    ax.legend(loc='upper left', fontsize=8.5)
    ax.set_title('LIA 2.1: erro geral × erro no congestionamento', loc='left', fontsize=11)
    _nota(fig, 'O ganho sobre o baseline se mantém no congestionamento, mas o erro absoluto mais que dobra — '
               'limitação discutida no texto.\nFonte: models/lia_2.1_metadata.json › cv.')
    _salvar(fig, 'fig4_erro_congestionamento')


if __name__ == '__main__':
    print('Gerando figuras do TCC:')
    fig1_erro_versoes()
    fig2_calibracao_transfer()
    fig3_benchmark_lstm_xgboost()
    fig4_erro_congestionamento()
