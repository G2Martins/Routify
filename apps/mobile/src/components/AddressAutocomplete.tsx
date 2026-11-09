/**
 * Autocomplete de lugares. A API faz a fusão (GET /search/places: base local do DF → TomTom →
 * Nominatim); aqui só consome.
 *
 * - Foco com o campo vazio: destinos recentes do usuário (route_history, RLS por dono).
 * - Digitando (≥ 2): debounce de 250 ms, requisição anterior cancelada, skeleton, limite de 8 s,
 *   429 respeitado (Retry-After). A resposta fica 5 min na memória: apagar uma letra não vai à rede.
 *   Recentes que casam com o texto vêm antes. Trecho digitado destacado (segmentos de <Text>, nunca HTML).
 * - Teclado: ↑/↓ movem, Enter escolhe (se a lista na tela ainda é da letra anterior, espera a resposta),
 *   Esc fecha. A tecla "buscar" do teclado do celular escolhe também.
 * - Web: padrão combobox/listbox (leitor de tela anuncia a opção ativa e quantas sugestões há) e o
 *   histórico de digitação do navegador não cobre a lista.
 * - Analytics (LGPD): só fonte, posição e contagens. Nunca o texto nem coordenadas.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
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
import { useFonteCampo } from '../lib/responsive';
import { Selo, Skeleton, useMenosMovimento } from './ui';
import Icon from './Icon';
import { aplicarConferencia, combinar, palavras, PlaceSuggestion, RecenteConferido, rotuloParaSalvar, semAcento } from '../lib/sugestoes';

export type { PlaceSuggestion } from '../lib/sugestoes';

const MIN_CHARS = 2; // mesmo min_length da API
const MAX_CHARS = 120; // mesmo max_length da API: acima disso a API responde 422
const DEBOUNCE_MS = 250;
const BLUR_MS = 180; // dá tempo do clique numa linha registrar antes de fechar
const TIMEOUT_MS = 8000; // sem resposta nesse prazo = erro com "Tentar de novo" (antes ficava no skeleton)
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 60;
const LIMITE = 6; // cabe na lista sem rolagem (sem scrollIntoView no teclado)
const MAX_RECENTES = 5;
const MAX_RECENTES_DIGITANDO = 2;
const NATIVO = Platform.OS !== 'web';
const WEB = Platform.OS === 'web';
// Mesma caixa que a API aceita em lat/lon (fora dela é 422, e o campo mostraria "não deu para buscar").
const DF = { latMin: -16.6, latMax: -15.0, lonMin: -48.8, lonMax: -46.8 };

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
  'Região': 'ion:map-outline',
};
// Marcos ganham o destaque azul (o que a pessoa costuma querer dizer).
const MARCOS = new Set(['Shopping', 'Aeroporto', 'Universidade', 'Escola', 'Hospital', 'Estação', 'Estádio', 'Órgão público', 'Parque', 'Região']);

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

/**
 * Parte `label` em trechos, marcando o que foi digitado (ignora acento e caixa): a frase inteira
 * quando ela aparece junta; senão cada termo ("hospital base" destaca as duas palavras).
 */
export function trechosDestacados(label: string, busca: string): { t: string; destaque: boolean }[] {
  const q = dobrar(busca.trim()).txt;
  const { txt, idx } = dobrar(label);
  const achar = (termos: string[]) => {
    const faixas: [number, number][] = [];
    for (const t of termos) {
      const p = t ? txt.indexOf(t) : -1;
      if (p >= 0) faixas.push([idx[p], idx[p + t.length - 1] + 1]);
    }
    return faixas.sort((a, b) => a[0] - b[0]);
  };
  let faixas = achar([q]);
  if (!faixas.length) faixas = achar(q.split(/\s+/));
  const partes: { t: string; destaque: boolean }[] = [];
  let pos = 0;
  for (const [ini, fim] of faixas) {
    if (ini < pos) continue; // termos que se sobrepõem: o primeiro vale
    partes.push({ t: label.slice(pos, ini), destaque: false }, { t: label.slice(ini, fim), destaque: true });
    pos = fim;
  }
  partes.push({ t: label.slice(pos), destaque: false });
  const out = partes.filter((x) => x.t);
  return out.length ? out : [{ t: label, destaque: false }];
}

// Respostas da API por (texto, viés): module-level, então origem e destino dividem. Só memória.
const cacheBusca = new Map<string, { t: number; itens: PlaceSuggestion[] }>();
function lerCache(chave: string): PlaceSuggestion[] | null {
  const e = cacheBusca.get(chave);
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL_MS) {
    cacheBusca.delete(chave);
    return null;
  }
  return e.itens;
}
function gravarCache(chave: string, itens: PlaceSuggestion[]) {
  cacheBusca.delete(chave); // reinsere no fim: a mais antiga é sempre a primeira do Map
  cacheBusca.set(chave, { t: Date.now(), itens });
  if (cacheBusca.size > CACHE_MAX) cacheBusca.delete(cacheBusca.keys().next().value as string);
}

/** Viés com 3 casas (~110 m): basta para desempatar e não expõe a posição exata. Vazio se fora do DF. */
function viesDe(perto?: { lat: number; lon: number } | null): string {
  if (!perto) return '';
  const lat = Number(perto.lat.toFixed(3));
  const lon = Number(perto.lon.toFixed(3));
  const dentro = lat >= DF.latMin && lat <= DF.latMax && lon >= DF.lonMin && lon <= DF.lonMax;
  return dentro ? `&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}` : '';
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
type TipoErro = 'rede' | 'limite';

export default function AddressAutocomplete({ placeholder, value, onChangeText, onSelect, zIndex = 50, listaStyle, perto }: Props) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { user } = useAuth();
  const reduzir = useMenosMovimento();
  const fonteCampo = useFonteCampo();
  const uid = useId();
  const listaId = `${uid}-lista`;
  const opcaoId = (i: number) => `${uid}-op-${i}`;

  const [focado, setFocado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<PlaceSuggestion[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<TipoErro | null>(null);
  const [semResultado, setSemResultado] = useState(false);
  const [recentes, setRecentes] = useState<PlaceSuggestion[] | null>(null);
  const [ativo, setAtivo] = useState(-1);

  const inputRef = useRef<TextInput>(null);
  const timerBusca = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const timerBlur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const ultimoSemResultado = useRef<string | null>(null); // fica só na memória, nunca é enviado
  const bloqueadoAte = useRef(0); // 429: até quando não adianta tentar
  const enterPendente = useRef(false); // Enter enquanto a lista ainda é da letra anterior
  const escolhidoEm = useRef(0); // Enter e "buscar" do teclado chegam juntos em alguns aparelhos
  // Refs com o valor mais novo: a resposta da API chega num callback criado renders atrás.
  const onSelectRef = useRef(onSelect);
  const recentesRef = useRef(recentes);
  const valueRef = useRef(value);
  onSelectRef.current = onSelect;
  recentesRef.current = recentes;
  valueRef.current = value;

  useEffect(
    () => () => {
      clearTimeout(timerBusca.current);
      clearTimeout(timerBlur.current);
      abortRef.current?.abort();
    },
    []
  );

  const curto = value.trim().length < MIN_CHARS;
  const lista = curto ? recentes ?? [] : combinar(value, recentes, itens, LIMITE, MAX_RECENTES_DIGITANDO);
  const carregandoRecentes = curto && recentes === null && !!user;
  const mostrar =
    focado &&
    aberto &&
    // Digitando: só há lista quando uma busca está em curso ou deu resposta (refocar um campo já
    // preenchido não reabre nada; os recentes que casam só se juntam a uma busca de verdade).
    (curto ? carregandoRecentes || lista.length > 0 : carregando || !!erro || semResultado || itens.length > 0);
  const anuncio = !mostrar
    ? ''
    : lista.length === 0 && erro
      ? 'Não deu para buscar agora.'
      : lista.length === 0 && semResultado
        ? 'Nenhum lugar encontrado.'
        : !carregando && lista.length > 0
          ? `${lista.length} ${lista.length === 1 ? 'sugestão' : 'sugestões'}. Use as setas para cima e para baixo.`
          : '';

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
    // Confere na API antes de mostrar (RA de cada um; nome de marco salvo no lugar errado volta ao marco). Sem
    // resposta em 2,5 s, segue com o salvo. Fora da caixa do DF não vai (a API recusaria o lote inteiro).
    const noDF = (r: PlaceSuggestion) => r.lat >= -16.6 && r.lat <= -15.0 && r.lon >= -48.8 && r.lon <= -46.8;
    const enviados = out.filter(noDF);
    let conferidos: RecenteConferido[] = [];
    if (enviados.length) {
      try {
        const r = await fetch(`${API_URL}/search/recentes`, {
          method: 'POST',
          headers: await apiHeaders(),
          body: JSON.stringify({ recentes: enviados.map(({ label, lat, lon }) => ({ label: label.slice(0, 300), lat, lon })) }),
          signal: AbortSignal.timeout(2500),
        });
        if (r.ok) conferidos = await r.json();
      } catch {
        // API fora: recentes como estão
      }
    }
    setRecentes(aplicarConferencia(out, out.map((r) => conferidos[enviados.indexOf(r)])));
  };

  const buscar = (texto: string, imediato = false) => {
    clearTimeout(timerBusca.current);
    abortRef.current?.abort();
    enterPendente.current = false;
    setAtivo(-1);
    setErro(null);
    setSemResultado(false);
    const q = texto.trim().slice(0, MAX_CHARS);
    if (q.length < MIN_CHARS) {
      setItens([]);
      setCarregando(false);
      return;
    }
    const vies = viesDe(perto);
    const chave = `${palavras(q).join(' ')}|${vies}`;
    const guardado = lerCache(chave);
    if (guardado) {
      setItens(guardado);
      setSemResultado(guardado.length === 0);
      setCarregando(false);
      return;
    }
    setCarregando(true); // mantém os itens anteriores na tela até a nova resposta
    timerBusca.current = setTimeout(async () => {
      if (Date.now() < bloqueadoAte.current) {
        setItens([]);
        setErro('limite');
        setCarregando(false);
        return;
      }
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let expirou = false;
      const prazo = setTimeout(() => {
        expirou = true;
        ctrl.abort();
      }, TIMEOUT_MS);
      let tipo: TipoErro = 'rede';
      try {
        const res = await fetch(`${API_URL}/search/places?q=${encodeURIComponent(q)}&limit=${LIMITE}${vies}`, {
          headers: await apiHeaders(false),
          signal: ctrl.signal,
        });
        if (res.status === 429) {
          const s = Number(res.headers.get('Retry-After'));
          bloqueadoAte.current = Date.now() + (Number.isFinite(s) && s > 0 ? Math.min(s, 60) : 10) * 1000;
          tipo = 'limite';
          throw new Error('HTTP 429');
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: PlaceSuggestion[] = await res.json();
        if (ctrl.signal.aborted) return;
        const validos = Array.isArray(data) ? data.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) : [];
        gravarCache(chave, validos);
        setItens(validos);
        setSemResultado(validos.length === 0);
        if (validos.length === 0 && ultimoSemResultado.current !== q) {
          ultimoSemResultado.current = q;
          enviarEvento('busca', { sem_resultado: true, n_caracteres: q.length });
        }
        if (enterPendente.current) {
          // Enter foi apertado antes desta resposta: escolhe o 1º da lista nova, não o da letra anterior.
          enterPendente.current = false;
          const nova = combinar(valueRef.current, recentesRef.current, validos, LIMITE, MAX_RECENTES_DIGITANDO);
          if (nova.length) escolher(nova[0], 0, nova.length);
        }
      } catch {
        if (ctrl.signal.aborted && !expirou) return; // outra tecla já cancelou esta
        setItens([]);
        setErro(tipo);
      } finally {
        clearTimeout(prazo);
        if (!ctrl.signal.aborted || expirou) setCarregando(false);
      }
    }, imediato ? 0 : DEBOUNCE_MS);
  };

  const escolher = (item: PlaceSuggestion, posicao: number, total: number = lista.length) => {
    escolhidoEm.current = Date.now();
    enviarEvento('busca', {
      fonte: item.source,
      posicao,
      n_resultados: total,
      recente: item.source === 'recente',
    });
    clearTimeout(timerBusca.current);
    abortRef.current?.abort();
    enterPendente.current = false;
    setItens([]);
    setCarregando(false);
    setErro(null);
    setSemResultado(false);
    setAberto(false);
    setAtivo(-1);
    onSelectRef.current({ ...item, label: rotuloParaSalvar(item, lista) });
  };

  /** Enter (teclado) e "buscar" (teclado do celular). */
  const confirmar = () => {
    if (Date.now() - escolhidoEm.current < 400) return;
    if (!curto && carregando) {
      enterPendente.current = true; // a lista na tela é da letra anterior: espera a resposta
      return;
    }
    if (!mostrar || lista.length === 0) return;
    const i = ativo >= 0 && ativo < lista.length ? ativo : 0;
    escolher(lista[i], i);
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
    if (k === 'Enter') {
      e.preventDefault(); // no RN-web, evita o blur do submit
      confirmar();
      return;
    }
    if (!mostrar || lista.length === 0) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); // não move o cursor do input
      setAtivo((a) => (k === 'ArrowDown' ? (a + 1) % lista.length : a <= 0 ? lista.length - 1 : a - 1));
    }
  };

  // Atributos que só o DOM entende (combobox/listbox). Fora da web ficam de fora: no nativo o
  // papel "button" por linha já funciona e o RN não mapeia "option" em todas as plataformas.
  const ariaCampo = WEB
    ? ({
        'aria-autocomplete': 'list',
        'aria-haspopup': 'listbox',
        'aria-controls': listaId,
        'aria-activedescendant': mostrar && ativo >= 0 && ativo < lista.length ? opcaoId(ativo) : undefined,
      } as object)
    : {};
  // listbox só quando há opções; erro, "nenhum lugar" e skeleton são avisos, não opções
  const semOpcoes = carregandoRecentes || (!curto && lista.length === 0 && (carregando || !!erro || semResultado));
  const ariaLista = WEB ? ({ nativeID: listaId, ...(semOpcoes ? null : { role: 'listbox' }) } as object) : {};
  const ariaOpcao = (i: number, selecionada: boolean) =>
    // tabIndex -1 (o RN-web ignora focusable:false): o foco fica no campo, como no combobox; Tab sai do campo em vez de cair na 1ª linha
    WEB ? ({ role: 'option', 'aria-selected': selecionada, nativeID: opcaoId(i), tabIndex: -1 } as object) : {};

  const conteudo = () => {
    if (carregandoRecentes || (carregando && lista.length === 0 && !curto)) {
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
    if (!curto && erro && lista.length === 0) {
      const limite = erro === 'limite';
      return (
        <View style={styles.estado} accessibilityRole="alert">
          <Icon name="ion:alert-circle-outline" size={18} color={c.warning} />
          <View style={{ flex: 1 }}>
            <Text style={[theme.typography.captionMd, { color: c.text }]}>
              {limite ? 'Muitas buscas seguidas.' : 'Não deu para buscar agora.'}
            </Text>
            <Text style={[theme.typography.caption, { color: c.textMuted }]}>
              {limite ? 'Aguarde alguns segundos e continue digitando.' : 'Verifique a conexão e tente de novo.'}
            </Text>
            {limite ? null : (
              <Pressable
                onPress={() => buscar(value, true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Tentar buscar de novo"
                style={styles.tentar}
              >
                <Text style={[theme.typography.captionMd, { color: c.accent }]}>Tentar de novo</Text>
              </Pressable>
            )}
          </View>
        </View>
      );
    }
    if (!curto && semResultado && lista.length === 0) {
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
                accessibilityRole={WEB ? undefined : 'button'}
                aria-selected={selecionado}
                accessibilityLabel={[item.label, item.sublabel, tag].filter(Boolean).join(', ')}
                {...ariaOpcao(i, selecionado)}
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
          role="combobox"
          aria-expanded={mostrar}
          {...ariaCampo}
          autoCapitalize="words"
          autoComplete="off"
          autoCorrect={false}
          spellCheck={false}
          maxLength={MAX_CHARS}
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
          onSubmitEditing={confirmar}
          style={[theme.typography.body, styles.input, { color: c.text, fontSize: fonteCampo }, SEM_OUTLINE_WEB]}
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
            accessibilityRole="button"
            accessibilityLabel="Limpar campo"
            style={styles.limpar}
          >
            <Icon name="ion:close" size={16} color={c.textSubtle} />
          </Pressable>
        ) : null}
      </View>

      {/* Só para leitor de tela: quantas sugestões há / nenhum resultado / erro. */}
      <Text aria-live="polite" accessibilityLiveRegion="polite" style={styles.soLeitor}>
        {anuncio}
      </Text>

      {mostrar ? (
        <View
          accessibilityRole="list"
          {...ariaLista}
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
  },
  // 44 de alvo por cima da borda de 1 px do campo.
  input: { flex: 1, minWidth: 0, height: 44, marginVertical: -1 },
  limpar: { width: 44, height: 44, marginVertical: -1, alignItems: 'center', justifyContent: 'center' },
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
    minHeight: 48,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  iconeCaixa: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  estado: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12 },
  tentar: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  soLeitor: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
