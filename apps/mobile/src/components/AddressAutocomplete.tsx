/**
 * Autocomplete de lugares. A API faz a fusão (GET /search/places: malha local →
 * TomTom → Nominatim); aqui só consome.
 *
 * - Foco com o campo vazio: destinos recentes do usuário (route_history, RLS por dono).
 * - Digitando (≥ 2): debounce de 250 ms, requisição anterior cancelada, skeleton,
 *   trecho digitado destacado (segmentos de <Text>, nunca HTML).
 * - Teclado na web: ↑/↓ movem, Enter escolhe, Esc fecha.
 * - Analytics (LGPD): só fonte, posição e contagens. Nunca o texto nem coordenadas.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase, RouteHistoryRow } from '../lib/supabase';
import { API_URL, apiHeaders, enviarEvento } from '../lib/api';
import { Selo, Skeleton, useMenosMovimento } from './ui';
import Icon from './Icon';

export interface PlaceSuggestion {
  label: string;
  sublabel: string;
  lat: number;
  lon: number;
  source: 'malha' | 'tomtom' | 'nominatim' | 'recente';
  /** Categoria em português vinda da API (Shopping, Universidade, Via, Endereço…). */
  categoria?: string | null;
  id_ponto?: number;
}

const MIN_CHARS = 2; // mesmo min_length da API
const DEBOUNCE_MS = 250;
const BLUR_MS = 180; // dá tempo do clique numa linha registrar antes de fechar
const LIMITE = 6; // cabe na lista sem rolagem (sem scrollIntoView no teclado)
const MAX_RECENTES = 5;
const NATIVO = Platform.OS !== 'web';

// Estilos que só existem no DOM (RN-web): transição de 160 ms e sem outline do navegador.
const TRANSICAO_WEB = Platform.OS === 'web'
  ? ({ transitionProperty: 'background-color, border-color, box-shadow', transitionDuration: '160ms' } as ViewStyle)
  : null;
const SEM_OUTLINE_WEB = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

// Ícone por categoria (o selo mostra a categoria; o provedor da busca não aparece).
const ICONE_CATEGORIA: Record<string, string> = {
  Shopping: 'ion:bag-handle-outline',
  Aeroporto: 'ion:airplane-outline',
  Universidade: 'ion:school-outline',
  Escola: 'ion:school-outline',
  Hospital: 'ion:medkit-outline',
  'Estação': 'ion:train-outline',
  Parada: 'ion:bus-outline',
  'Estádio': 'ion:football-outline',
  'Órgão público': 'ion:business-outline',
  Parque: 'ion:leaf-outline',
  Restaurante: 'ion:restaurant-outline',
  'Café': 'ion:cafe-outline',
  Loja: 'ion:storefront-outline',
  Posto: 'mdi:gas-station-outline',
  'Farmácia': 'ion:medical-outline',
  Hotel: 'ion:bed-outline',
  Via: 'mdi:road-variant',
  'Endereço': 'ion:home-outline',
};
// Marcos ganham o destaque azul (o que a pessoa costuma querer dizer).
const MARCOS = new Set(['Shopping', 'Aeroporto', 'Universidade', 'Escola', 'Hospital', 'Estação', 'Estádio', 'Órgão público', 'Parque']);

const semAcento = (s: string) =>
  (typeof s.normalize === 'function' ? s.normalize('NFD') : s).replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Minúsculas e sem acento, guardando de qual índice do original veio cada caractere. */
function dobrar(s: string): { txt: string; idx: number[] } {
  let txt = '';
  const idx: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const d = semAcento(s[i]);
    txt += d;
    for (let j = 0; j < d.length; j++) idx.push(i);
  }
  return { txt, idx };
}

/** Parte `label` em trechos, marcando a 1ª ocorrência de `busca` (ignora acento e caixa). */
export function trechosDestacados(label: string, busca: string): { t: string; destaque: boolean }[] {
  const q = dobrar(busca.trim()).txt;
  const { txt, idx } = dobrar(label);
  const p = q ? txt.indexOf(q) : -1;
  if (p < 0) return [{ t: label, destaque: false }];
  const ini = idx[p];
  const fim = idx[p + q.length - 1] + 1;
  return [
    { t: label.slice(0, ini), destaque: false },
    { t: label.slice(ini, fim), destaque: true },
    { t: label.slice(fim), destaque: false },
  ].filter((x) => x.t);
}

function quando(iso: string): string {
  const d = new Date(iso);
  const dias = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return d.toLocaleDateString('pt-BR');
}

/** Linha da lista aparece rápido (≤ 160 ms); com menos movimento, direto. */
function Aparecer({ children, duracao }: { children: React.ReactNode; duracao: number }) {
  const { theme } = useTheme();
  const v = useRef(new Animated.Value(duracao ? 0 : 1)).current;
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: duracao, easing: theme.motion.easeOutExpo, useNativeDriver: NATIVO });
    anim.start();
    return () => anim.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={{ opacity: v }}>{children}</Animated.View>;
}

interface Props {
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (p: PlaceSuggestion) => void;
  zIndex?: number;
  /** Ajuste da lista suspensa (ex.: alargar além do campo). */
  listaStyle?: StyleProp<ViewStyle>;
  /** Onde a pessoa está indo/saindo: desempata lugares homônimos (ex.: dois "Park Shopping"). */
  perto?: { lat: number; lon: number } | null;
}

type Linha = Pick<RouteHistoryRow, 'destino_label' | 'destino_lat' | 'destino_lon' | 'created_at'>;

export default function AddressAutocomplete({ placeholder, value, onChangeText, onSelect, zIndex = 50, listaStyle, perto }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user } = useAuth();
  const reduzir = useMenosMovimento();

  const [focado, setFocado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<PlaceSuggestion[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [semResultado, setSemResultado] = useState(false);
  const [recentes, setRecentes] = useState<PlaceSuggestion[] | null>(null);
  const [ativo, setAtivo] = useState(-1);

  const inputRef = useRef<TextInput>(null);
  const timerBusca = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timerBlur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const ultimoSemResultado = useRef<string | null>(null); // fica só na memória, nunca é enviado

  useEffect(
    () => () => {
      clearTimeout(timerBusca.current);
      clearTimeout(timerBlur.current);
      abortRef.current?.abort();
    },
    []
  );

  const curto = value.trim().length < MIN_CHARS;
  const lista = curto ? recentes ?? [] : itens;
  const carregandoRecentes = curto && recentes === null && !!user;
  const mostrar =
    focado &&
    aberto &&
    (curto ? carregandoRecentes || lista.length > 0 : carregando || erro || semResultado || itens.length > 0);

  const carregarRecentes = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('route_history')
      .select('destino_label,destino_lat,destino_lon,created_at')
      // RLS já restringe ao dono; o filtro evita vazar destinos de outros se surgir policy mais ampla (ex.: admin).
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error || !data) {
      setRecentes((r) => r ?? []);
      return;
    }
    const vistos = new Set<string>();
    const out: PlaceSuggestion[] = [];
    for (const r of data as Linha[]) {
      const chave = r.destino_label?.trim().toLowerCase();
      if (!chave || vistos.has(chave) || typeof r.destino_lat !== 'number' || typeof r.destino_lon !== 'number') continue;
      vistos.add(chave);
      out.push({
        label: r.destino_label,
        sublabel: `Destino recente · ${quando(r.created_at)}`,
        lat: r.destino_lat,
        lon: r.destino_lon,
        source: 'recente',
      });
      if (out.length === MAX_RECENTES) break;
    }
    setRecentes(out);
  };

  const buscar = (texto: string) => {
    clearTimeout(timerBusca.current);
    abortRef.current?.abort();
    setAtivo(-1);
    setErro(false);
    setSemResultado(false);
    const q = texto.trim();
    if (q.length < MIN_CHARS) {
      setItens([]);
      setCarregando(false);
      return;
    }
    setCarregando(true); // mantém os itens anteriores na tela até a nova resposta
    timerBusca.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        // Viés com 3 casas (~110 m): basta para desempatar e não expõe a posição exata.
        const vies = perto ? `&lat=${perto.lat.toFixed(3)}&lon=${perto.lon.toFixed(3)}` : '';
        const res = await fetch(`${API_URL}/search/places?q=${encodeURIComponent(q)}&limit=${LIMITE}${vies}`, {
          headers: await apiHeaders(false),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PlaceSuggestion[] = await res.json();
        if (ctrl.signal.aborted) return;
        const validos = Array.isArray(data) ? data.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) : [];
        setItens(validos);
        setSemResultado(validos.length === 0);
        if (validos.length === 0 && ultimoSemResultado.current !== q) {
          ultimoSemResultado.current = q;
          enviarEvento('busca', { sem_resultado: true, n_caracteres: q.length });
        }
      } catch {
        if (ctrl.signal.aborted) return;
        setItens([]);
        setErro(true);
      } finally {
        if (!ctrl.signal.aborted) setCarregando(false);
      }
    }, DEBOUNCE_MS);
  };

  const escolher = (item: PlaceSuggestion, posicao: number) => {
    enviarEvento('busca', {
      fonte: item.source,
      posicao,
      n_resultados: lista.length,
      recente: item.source === 'recente',
    });
    clearTimeout(timerBusca.current);
    abortRef.current?.abort();
    setItens([]);
    setCarregando(false);
    setSemResultado(false);
    setAberto(false);
    setAtivo(-1);
    onSelect(item);
  };

  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const k = e.nativeEvent.key;
    if (k === 'Escape') {
      setAberto(false);
      return;
    }
    if (k === 'ArrowDown' && !aberto) {
      setAberto(true);
      return;
    }
    if (!mostrar || lista.length === 0) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); // não move o cursor do input
      setAtivo((a) => (k === 'ArrowDown' ? (a + 1) % lista.length : a <= 0 ? lista.length - 1 : a - 1));
    } else if (k === 'Enter') {
      e.preventDefault(); // no RN-web, evita o blur do submit
      const i = ativo >= 0 && ativo < lista.length ? ativo : 0;
      escolher(lista[i], i);
    }
  };

  const conteudo = () => {
    if (carregandoRecentes || (carregando && itens.length === 0 && !curto)) {
      return [0, 1, 2].map((i) => (
        <View key={i} style={styles.linha}>
          <Skeleton altura={32} largura={32} raio={8} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton altura={12} largura="62%" raio={4} />
            <Skeleton altura={10} largura="38%" raio={4} />
          </View>
        </View>
      ));
    }
    if (!curto && erro) {
      return (
        <View style={styles.estado} accessibilityRole="alert">
          <Icon name="ion:alert-circle-outline" size={18} color={c.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.captionMd, { color: c.text }]}>Não deu para buscar agora.</Text>
            <Text style={[theme.typography.caption, { color: c.textMuted }]}>Verifique a conexão e tente de novo.</Text>
          </View>
        </View>
      );
    }
    if (!curto && semResultado) {
      return (
        <View style={styles.estado}>
          <Icon name="ion:map-outline" size={18} color={c.textSubtle} />
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.captionMd, { color: c.text }]}>Nenhum lugar encontrado</Text>
            <Text style={[theme.typography.caption, { color: c.textMuted }]}>
              Tente o nome de uma via, quadra ou lugar (ex.: EPTG, SQS 308, Rodoviária).
            </Text>
          </View>
        </View>
      );
    }
    return (
      <>
        {curto ? (
          <Text style={[theme.typography.micro, styles.cabecalho, { color: c.textSubtle }]}>RECENTES</Text>
        ) : null}
        {lista.map((item, i) => {
          const recente = item.source === 'recente';
          const tag = recente ? undefined : item.categoria ?? undefined;
          const icone = recente ? 'ion:time-outline' : ICONE_CATEGORIA[item.categoria ?? ''] ?? 'ion:location-outline';
          const selecionado = i === ativo;
          const marca = !!tag && MARCOS.has(tag);
          return (
            <Aparecer key={`${item.source}:${item.lat},${item.lon}:${i}`} duracao={reduzir ? 0 : theme.motion.rapido}>
              <Pressable
                onPress={() => escolher(item, i)}
                onHoverIn={() => setAtivo(i)}
                accessibilityRole="button"
                accessibilityState={{ selected: selecionado }}
                accessibilityLabel={[item.label, item.sublabel, tag].filter(Boolean).join(', ')}
                style={({ pressed }) => [
                  styles.linha,
                  { backgroundColor: pressed ? c.surfaceMuted : selecionado ? c.surfaceAlt : 'transparent' },
                ]}
              >
                <View style={[styles.iconeCaixa, { backgroundColor: marca ? c.accentSoft : c.surfaceAlt }]}>
                  <Icon name={icone} size={16} color={marca ? c.accent : c.textMuted} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[theme.typography.bodyMd, { color: c.text, fontSize: 14, lineHeight: 20 }]} numberOfLines={1}>
                    {item.label
                      ? trechosDestacados(item.label, curto ? '' : value).map((s, k) => (
                          <Text key={k} style={s.destaque ? { color: c.accent, fontFamily: theme.fonts.sansBold } : null}>
                            {s.t}
                          </Text>
                        ))
                      : 'Sem nome'}
                  </Text>
                  {item.sublabel ? (
                    <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]} numberOfLines={1}>
                      {item.sublabel}
                    </Text>
                  ) : null}
                </View>
                {tag ? (
                  <View>
                    <Selo tom={marca ? 'marca' : 'neutro'}>{tag}</Selo>
                  </View>
                ) : null}
              </Pressable>
            </Aparecer>
          );
        })}
      </>
    );
  };

  return (
    <View style={{ position: 'relative', zIndex }}>
      <View
        style={[
          styles.campo,
          {
            backgroundColor: focado ? c.surface : c.surfaceAlt,
            borderColor: focado ? c.accent : c.surfaceAlt,
          },
          focado && { boxShadow: `0 0 0 3px ${c.ring}` },
          TRANSICAO_WEB,
        ]}
      >
        <TextInput
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          placeholderTextColor={c.textSubtle}
          accessibilityLabel={placeholder}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onChangeText={(v) => {
            onChangeText(v);
            setAberto(true);
            buscar(v);
            if (v.trim().length < MIN_CHARS && recentes === null) void carregarRecentes();
          }}
          onFocus={() => {
            clearTimeout(timerBlur.current);
            setFocado(true);
            setAberto(true);
            if (curto) void carregarRecentes();
          }}
          onBlur={() => {
            timerBlur.current = setTimeout(() => {
              setFocado(false);
              setAtivo(-1);
            }, BLUR_MS);
          }}
          onKeyPress={onKeyPress}
          style={[theme.typography.body, styles.input, { color: c.text }, SEM_OUTLINE_WEB]}
        />
        {value && focado ? (
          <Pressable
            onPress={() => {
              onChangeText('');
              buscar('');
              setAberto(true);
              if (recentes === null) void carregarRecentes();
              inputRef.current?.focus();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Limpar campo"
            style={styles.limpar}
          >
            <Icon name="ion:close" size={16} color={c.textSubtle} />
          </Pressable>
        ) : null}
      </View>

      {mostrar ? (
        <View
          accessibilityRole="list"
          style={[
            styles.lista,
            {
              backgroundColor: c.surface,
              borderColor: c.border,
              boxShadow: `0 12px 32px ${c.shadowMedium}, 0 0 0 1px ${c.shadowLight}`,
            },
            listaStyle,
          ]}
        >
          {conteudo()}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    paddingLeft: 12,
    paddingRight: 8,
  },
  input: { flex: 1, height: '100%', fontSize: 15 },
  limpar: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  lista: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 6,
    padding: 4,
    borderWidth: 1,
    borderRadius: 12,
    zIndex: 100,
  },
  cabecalho: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  iconeCaixa: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  estado: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
});
