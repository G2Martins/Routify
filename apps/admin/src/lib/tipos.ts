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
