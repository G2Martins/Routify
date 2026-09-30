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
