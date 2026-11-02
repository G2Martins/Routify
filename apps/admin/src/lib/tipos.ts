export type Saude = {
  status: string;
  modelo_ativo: string;
  cv_rmse_seg: number | null;
  total_amostras_treino: number | null;
  tomtom: {
    ativo: boolean;
    chaves: number;
    disponiveis: { fluxo: number; incidentes: number; busca: number; rota: number };
  };
  vias_monitoradas: number | null;
  supabase_configurado: boolean;
  recencia: { vias: number; mais_recente: string | null };
};

export type ResumoUso = {
  janela_dias: number;
  requisicoes: number;
  erros_5xx: number;
  latencia_p95_ms: number | null;
  rotas: number;
  rotas_degradadas: number;
  usuarios_ativos: number;
  usuarios_total: number;
  eventos: number;
  serie_diaria: { dia: string; rotas: number; usuarios: number }[];
  por_hora: { hora: number; rotas: number }[];
  por_endpoint: { rota: string; n: number; erros: number; p95_ms: number | null }[];
  eventos_por_tipo: Record<string, number>;
};

export type LiaTreino = {
  versao: string;
  registrado_em: string;
  validacao: 'temporal' | 'nao_temporal';
  fonte: string;
  mae_seg: number | string | null;
  mae_seg_std: number | string | null;
  rmse_seg: number | string | null;
  rmse_seg_std: number | string | null;
  baseline_mae_seg: number | string | null;
  baseline_rmse_seg: number | string | null;
  rmse_congestionado_seg: number | string | null;
  baseline_rmse_congestionado_seg: number | string | null;
  total_amostras: number | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  detalhes: Record<string, unknown>;
};

export type Calibracao = {
  metodologia: { n_pares_totais: number; dist_max_m: number };
  curva_erro_distancia_bins: { faixa_m: string; centro_m: number; n_pares: number; erro_medio: number; confianca_calibrada: number }[];
  curva_isotonica_grade_10m: { distancias_m: number[]; confiancas: number[] };
};

type ModeloBench = {
  rmse_seg_media: number;
  mae_seg_media: number;
  tempo_treino_s_media: number;
  rmse_seg_std: number;
  tempo_treino_s_std: number;
  folds: { rmse_seg: number; mae_seg: number; tempo_treino_s: number }[];
};

export type Benchmark = {
  xgboost: ModeloBench;
  xgboost_com_recencia: ModeloBench;
  lstm: ModeloBench;
  n_parametros_lstm: number;
  conclusao: string;
};

export type Qualidade = {
  resumo: {
    linhas: number;
    inicio: string;
    fim: string;
    nulos: number;
    acima_da_livre: number;
    velocidade_zero: number;
    baixa_confianca: number;
    vias_com_dado: number;
    calculado_em: string;
  };
  duplicatas: number;
  vias_monitoradas: number;
  vias_sem_dado: number;
  amostras_por_via: { min: number; mediana: number; max: number };
  vias_menos_amostradas: { id_ponto: number; nome_via: string | null; n: number; ultima: string | null }[];
  cobertura_hora_dia: { dia_semana: number; hora: number; n: number }[];
  tamanho_tabelas_bytes: Record<string, number>;
};

/* ---------- Ações do ADM (migration 20260923020000_admin_actions) ---------- */

export type Usuario = {
  id: string;
  email: string;
  nome: string | null;
  criado_em: string;
  ultimo_login: string | null;
  papel: string;
  rotas: number;
  /** banned_until vigente (migration 20260923020000). Ausente = versão antiga da RPC. */
  bloqueado?: boolean;
};

export type ChaveConfig = 'tomtom_ativo' | 'referencia_tomtom_ativa' | 'modo_so_lia' | 'tomtom_orcamento_min' | 'tomtom_chaves_pausadas';

export type LinhaConfig = { chave: string; valor: unknown; atualizado_em: string; atualizado_por: string | null };

export type ServicoTomTom = 'fluxo' | 'incidentes' | 'busca' | 'rota';

export type EstadoTomTom = {
  habilitado: boolean;
  orcamento_min: number;
  chamadas_ultimo_min: number;
  chaves: {
    id: string;
    pausada: boolean;
    chamadas: number;
    falhas: number;
    servicos: Record<ServicoTomTom, { livre: boolean; volta_em_s: number; strikes: number }>;
  }[];
  config: Record<string, unknown> | null;
};

export type TesteChave = { ok: boolean; status: number | null; motivo: string | null; latencia_ms: number | null };

export type NivelAviso = 'info' | 'alerta' | 'manutencao';

export type AvisoApp = {
  id: string;
  mensagem: string;
  nivel: NivelAviso;
  ativo: boolean;
  inicio: string;
  fim: string | null;
  criado_por: string | null;
  criado_em: string;
};

export type Auditoria = { id: number; criado_em: string; ator: string; acao: string; alvo: string | null; detalhes: Record<string, unknown> };

export type Feedback = {
  id: string;
  criado_em: string;
  tempo_previsto_seg: number | null;
  tempo_real_seg: number;
  tempo_rota_curta_seg: number | null;
  lia_cobertura_pct: number | string | null;
  rotas_diferentes: boolean | null;
  feedback_excluido: boolean;
  feedback_excluido_motivo: string | null;
};

export type AnalyticsUso = {
  janela_dias: number;
  funil: Record<string, { eventos: number; usuarios: number }>;
  busca_por_fonte: Record<string, number>;
  busca_sem_resultado: number;
  busca_posicao_media: number | string | null;
  plataformas: Record<string, number>;
  lia_vs_curta: {
    rotas: number;
    diferentes: number;
    ganho_medio_seg: number | string | null;
    cobertura_media_pct: number | string | null;
    degradadas: number;
    com_incidente: number;
  };
  hora_dia: { hora: number; dia: number; n: number }[];
  calor: { lat: number | string; lon: number | string; n: number }[];
};

/* ---------- LIA × provedores (migration 20261102000000_lia_vs_provedores) ---------- */

/** Erro contra a TomTom ao vivo: viés mediano e MAPE em %, e a fatia dentro de ±20%. Sem pares = null. */
/** admin_provedores_historicos: séries pareadas contra a TomTom ao vivo (migration 20261102010000). */
export type ProvedoresHistoricos = {
  janela_dias: number;
  series: Partial<
    Record<'lia' | 'tomtom_historico' | 'lia_x_tomtom_historico' | 'mapbox_tipico' | 'mapbox_ao_vivo', ErroContraTomTom>
  >;
};

export type ErroContraTomTom = {
  n: number;
  vies_mediano_pct: number | null;
  mape_pct: number | null;
  pct_ate_20: number | null;
};

export type ComparacaoProvedores = {
  janela_dias: number;
  rodadas: number;
  ultima_rodada: string | null;
  corredores: number;
  provedores: { provedor: string; com_transito: boolean; n_ok: number; n_falhas: number }[];
  /** traco_comum_pct: % da rota igual à da TomTom (até 40 m, nos dois sentidos), média da janela. */
  vs_tomtom: (ErroContraTomTom & { provedor: string; traco_comum_pct?: number | null })[];
  lia_mesmo_trajeto: ErroContraTomTom;
  por_hora: { provedor: string; hora: number; n: number; vies_mediano_pct: number | null }[];
  por_corredor: {
    corredor: string;
    provedor: string;
    n: number;
    tempo_medio_s: number | null;
    ref_medio_s: number | null;
    erro_medio_pct: number | null;
    traco_comum_pct?: number | null;
  }[];
  ultima: { corredor: string; provedor: string; tempo_s: number | null; distancia_km: number | null; erro: string | null }[];
  rotas_reais: ErroContraTomTom & {
    por_hora: { hora: number; n: number; vies_mediano_pct: number | null }[];
    amostras: { lia_s: number; tomtom_s: number; km: number | null; cobertura_pct: number | null; hora: number | null }[];
  };
};

/* ---------- Análises de lia_analises (ml/publish_metrics.py) ---------- */

export type ErroSeg = { rmse_seg: number; mae_seg: number };

/** Erro por idade da última leitura da via (min): `cv_por_idade_recencia_min` e a ablação usam este formato. */
export type PorIdadeCV = Record<
  string,
  {
    modelo_rmse_seg: number;
    modelo_mae_seg: number;
    persistencia_rmse_seg: number;
    persistencia_mae_seg: number;
    baseline_rmse_seg: number;
    baseline_mae_seg: number;
    folds?: number;
  }
>;

export type FoldAblacao = {
  rmse_seg: number;
  mae_seg: number;
  baseline_rmse_seg?: number;
  persistencia_rmse_seg: number;
  persistencia_mae_seg: number;
  arvores?: number;
};

export type VarianteAblacao = {
  nome: string;
  receita: { oof: boolean; envelhecer: boolean; es_interno: boolean };
  segundos?: number;
  cv: Record<string, number | undefined>;
  por_idade: PorIdadeCV;
  folds: FoldAblacao[];
};

/** ml/artifacts/ablation_lia_2.3.json. `smoke` = execução de teste (150 mil linhas, 60 árvores). */
export type AblacaoLia23 = {
  gerado_em: string;
  smoke?: boolean;
  linhas: number;
  periodo: [string, string];
  variantes: VarianteAblacao[];
};

/** ml/artifacts/avaliacao_fora_do_tempo.json (ml/avaliar_fora_do_tempo.py): só leituras posteriores ao treino. */
export type AvaliacaoForaDoTempo = {
  gerado_em: string;
  desde: string;
  versoes: Record<
    string,
    {
      fim_do_treino: string;
      n_linhas: number;
      n_descartadas_recencia_antiga?: number;
      periodo?: [string, string];
      idade_mediana_leitura_min: number;
      fresca: { modelo: ErroSeg; persistencia: ErroSeg; perfil: ErroSeg };
      por_hora: { hora: number; n: number; modelo: ErroSeg; persistencia: ErroSeg }[];
      por_idade: Record<string, { n: number; modelo: ErroSeg; persistencia: ErroSeg }>;
    }
  >;
};

/** ml/artifacts/fase3_comparacao.csv publicado linha a linha (hora/dia_semana chegam como texto). */
export type Fase3Comparacao = {
  fonte: string;
  modelo: string;
  linhas: {
    timestamp: string | null;
    hora: string | number | null;
    dia_semana: string | number | null;
    par: string | null;
    lia_tempo_seg: number | null;
    lia_distancia_km: number | null;
    menor_dist_tempo_seg: number | null;
    tomtom_tempo_seg: number | null;
    tomtom_distancia_km: number | null;
    tomtom_atraso_transito_seg: number | null;
  }[];
};

/** ml/artifacts/cobertura_dataset.json (ml/dataset_coverage.py). */
export type CoberturaDataset = {
  gerado_em: string;
  periodo_inicio: string;
  periodo_fim: string;
  total_linhas: number;
  pontos_distintos: number;
  dias_com_coleta: number;
  n_dias_cheios: number;
  pct_linhas_em_dias_cheios: number;
  mediana_linhas_dia: number;
  hora_mais_coberta: number;
  pct_hora_mais_coberta: number;
  razao_fim_de_semana_vs_dia_util: number;
};

/** ml/artifacts/lia_2.2_estresse.json: cenário → versão → erro (treino × produção, fold 5). */
export type EstresseLia22 = {
  fold: number;
  val_periodo: [string, string];
  pct_linhas_sem_vizinho_recente: number;
  pct_linhas_com_chuva: number;
  cenarios: Record<string, Record<string, ErroSeg>>;
};
