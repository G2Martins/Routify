import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL ou EXPO_PUBLIC_SUPABASE_ANON_KEY ausentes. Verifique apps/mobile/.env'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

export interface ProfileRow {
  id: string;
  nome: string | null;
  avatar_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RouteHistoryRow {
  id: string;
  user_id: string;
  origem_label: string;
  destino_label: string;
  origem_lat?: number;
  origem_lon?: number;
  destino_lat?: number;
  destino_lon?: number;
  tempo_total_seg: number;
  distancia_km: number;
  via_principal: string | null;
  modelo_versao: string | null;
  created_at: string;
  // Validação da tese — supabase/migrations/20260907000000_thesis_validation.sql
  tempo_real_seg?: number | null;
  feedback_em?: string | null;
  tempo_rota_curta_seg?: number | null;
  rotas_diferentes?: boolean | null;
  hora_partida?: number | null;
  dia_semana?: number | null;
  lia_cobertura_pct?: number | null;
}
