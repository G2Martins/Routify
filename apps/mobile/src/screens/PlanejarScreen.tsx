/**
 * Planejar saída: o MESMO trajeto em várias horas de partida (POST /route/horarios), com o caminho num mapa pintado pelo
 * trânsito previsto da saída escolhida. É previsão pelo histórico de cada hora, sem trânsito ao vivo (não gasta TomTom).
 *
 * Abre numa janela útil (escolhaPadrao), nunca na madrugada. O pedido sai sozinho quando origem, destino, dia ou período
 * mudam; cada pedido é uma predição do grafo inteiro, então espera a pessoa parar de clicar e guarda as respostas.
 * Desktop: painel à esquerda, mapa à direita. Celular: o mapa só monta quando há resultado e fica fixo no topo, para a
 * pintura continuar à vista enquanto a pessoa percorre os horários.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// @ts-ignore: import por plataforma (MapComponent.web.tsx / .native.tsx), como no MapScreen
import MapComponent from '../components/MapComponent';
import AddressAutocomplete, { PlaceSuggestion } from '../components/AddressAutocomplete';
import BotaoRadares from '../components/BotaoRadares';
import Colunas, { Coluna } from '../components/Colunas';
import Icon from '../components/Icon';
import LegendaTransito from '../components/mapa/LegendaTransito';
import { BotaoIcone, Cartao, Container, Segmentado, Skeleton, Surgir, TituloPagina } from '../components/ui';
import { useTheme } from '../context/ThemeContext';
import { postApi } from '../lib/api';
import {
  escolhaPadrao,
  hhmm,
  Horarios,
  horarioImporta,
  janelaDe,
  mensagemDeErro,
  minutos,
  Periodo,
  PERIODOS,
  periodoValido,
  proximosDias,
  resumoMelhor,
} from '../lib/planejar';
import { useAlvo, useDesktopLayout } from '../lib/responsive';

const ESPERA_MS = 300; // pessoa trocando de dia e período: só o último clique vira pedido
const MARGEM_MAPA = { top: 40, left: 40, right: 72, bottom: 56 };
const ALTURAS_ESQUELETO = [46, 58, 72, 88, 96, 80, 64, 52, 48, 60, 74, 66];

export default function PlanejarScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const { height: alturaJanela } = useWindowDimensions();

  const [origemText, setOrigemText] = useState('');
  const [destinoText, setDestinoText] = useState('');
  const [origem, setOrigem] = useState<PlaceSuggestion | null>(null);
  const [destino, setDestino] = useState<PlaceSuggestion | null>(null);
  const [escolha, setEscolha] = useState(() => escolhaPadrao(new Date()));
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Horarios | null>(null);
  const [saida, setSaida] = useState(0);
  const [editando, setEditando] = useState(true);
  const [tentativa, setTentativa] = useState(0);

  const mapaRef = useRef<any>(null);
  const guardadas = useRef(new Map<string, Horarios>()); // ponytail: sem limite; a tela vive pouco e cada entrada é pequena
  const pedido = useRef(0);
  const linhaDesenhada = useRef('');

  const agora = new Date();
  const dias = useMemo(() => proximosDias(new Date()), []);

  useEffect(() => {
    if (!origem || !destino) return;
    const janela = janelaDe(escolha.dia, escolha.periodo, new Date());
    if (!janela) return;
    const corpo = { origem: { lat: origem.lat, lon: origem.lon }, destino: { lat: destino.lat, lon: destino.lon }, passo_min: 30, ...janela };
    const chave = JSON.stringify(corpo);
    const este = ++pedido.current;
    const aplicar = (r: Horarios) => {
      setResultado(r);
      setSaida(r.melhor);
      setEditando(false);
    };
    const pronta = guardadas.current.get(chave);
    setErro(null);
    if (pronta) {
      setCarregando(false);
      aplicar(pronta);
      return;
    }
    setCarregando(true);
    const t = setTimeout(async () => {
      try {
        const { status, dados } = await postApi<Horarios>('/route/horarios', corpo);
        if (este !== pedido.current) return;
        if (status === 200 && dados?.horarios?.length) {
          guardadas.current.set(chave, dados);
          aplicar(dados);
        } else setErro(mensagemDeErro(status, dados));
      } catch {
        if (este === pedido.current) setErro('Sem conexão com o servidor. Tente de novo.');
      } finally {
        if (este === pedido.current) setCarregando(false);
      }
    }, ESPERA_MS);
    return () => clearTimeout(t);
  }, [origem, destino, escolha, tentativa]);

  // Mesmo caminho: só troca a pintura, sem mexer na câmera. Caminho novo: desenha e enquadra.
  const horario = resultado?.horarios[saida];
  useEffect(() => {
    const linha = resultado?.polyline;
    if (!linha || linha.length < 2 || !origem || !destino) return;
    const assinatura = linha.join();
    if (assinatura === linhaDesenhada.current) {
      mapaRef.current?.atualizarTrafego?.(horario?.trafego ?? null);
    } else {
      linhaDesenhada.current = assinatura;
      mapaRef.current?.showRoute?.(linha, [origem.lat, origem.lon], [destino.lat, destino.lon], null, horario?.trafego ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado, saida]);

  // Outro ponto = outro trajeto: o resultado anterior deixa de valer.
  const limpar = () => {
    pedido.current++;
    setResultado(null);
    setCarregando(false);
    setEditando(true);
    linhaDesenhada.current = '';
    mapaRef.current?.clearRoute?.();
  };

  const trocarDia = (dia: string) => setEscolha((e) => ({ dia, periodo: periodoValido(dia, e.periodo, new Date()) }));

  const campos = (
    <View style={styles.campos}>
      <View style={{ zIndex: 2 }}>
        <AddressAutocomplete
          placeholder="De onde você sai?"
          value={origemText}
          onChangeText={(v: string) => {
            setOrigemText(v);
            if (origem) {
              setOrigem(null);
              limpar();
            }
          }}
          onSelect={(p: PlaceSuggestion) => {
            setOrigem(p);
            setOrigemText(p.label);
          }}
          perto={destino}
          zIndex={2}
        />
      </View>
      <View style={{ zIndex: 1 }}>
        <AddressAutocomplete
          placeholder="Para onde você vai?"
          value={destinoText}
          onChangeText={(v: string) => {
            setDestinoText(v);
            if (destino) {
              setDestino(null);
              limpar();
            }
          }}
          onSelect={(p: PlaceSuggestion) => {
            setDestino(p);
            setDestinoText(p.label);
          }}
          perto={origem}
          zIndex={1}
        />
      </View>
    </View>
  );

  const painel = (
    <>
      {/* Celular com resultado: o título sai para mapa e horários caberem juntos na tela. */}
      {desktop || !resultado ? (
        <View style={{ marginBottom: 20 }}>
          <TituloPagina titulo="Planejar saída" sub="O mesmo trajeto em vários horários." />
        </View>
      ) : null}

      {/* zIndex: a lista de sugestões abre por cima do que vem abaixo. */}
      <Surgir ordem={1} style={{ zIndex: 2 }}>
        <Cartao padding={12}>
          {!desktop && resultado && !editando ? (
            <Trajeto de={origemText} para={destinoText} onEditar={() => setEditando(true)} />
          ) : (
            campos
          )}
        </Cartao>
      </Surgir>

      <Surgir ordem={2} style={{ marginTop: 12, gap: 8, zIndex: 1 }}>
        <Dias dias={dias} valor={escolha.dia} onChange={trocarDia} />
        <Segmentado<Periodo>
          valor={escolha.periodo}
          onChange={(periodo) => setEscolha((e) => ({ ...e, periodo }))}
          opcoes={(Object.keys(PERIODOS) as Periodo[]).map((p) => ({
            valor: p,
            rotulo: PERIODOS[p].rotulo,
            desabilitado: !janelaDe(escolha.dia, p, agora),
          }))}
        />
      </Surgir>

      {erro ? (
        <View accessibilityRole="alert" style={[styles.erro, { backgroundColor: c.surfaceAlt, borderColor: c.border, borderLeftColor: c.danger }]}>
          <Icon name="ion:alert-circle-outline" size={16} color={c.danger} />
          <Text style={[theme.typography.caption, { flex: 1, color: c.text }]}>{erro}</Text>
          <Pressable onPress={() => setTentativa((t) => t + 1)} accessibilityRole="button" style={styles.tentar}>
            <Text style={[theme.typography.captionMd, { color: c.accent }]}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : null}

      {resultado && horario ? (
        // Recalculando: o resultado anterior fica esmaecido no lugar, sem pulo de layout.
        <View style={{ marginTop: 12, opacity: carregando ? 0.5 : 1 }}>
          <Resultado r={resultado} saida={saida} onSaida={setSaida} />
        </View>
      ) : carregando ? (
        <View style={{ marginTop: 12 }}>
          <Esqueleto />
        </View>
      ) : !erro ? (
        <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 16 }]}>Escolha origem e destino para comparar os horários.</Text>
      ) : null}
    </>
  );

  const mapa = (
    <>
      <MapComponent ref={mapaRef} margem={MARGEM_MAPA} />
      <View style={[styles.controlesMapa, { top: desktop ? 16 : insets.top + 12 }]}>
        <BotaoRadares mapa={mapaRef} />
      </View>
      <View style={styles.legenda}>
        <LegendaTransito />
      </View>
    </>
  );

  if (desktop) {
    return (
      <View style={[styles.lado, { backgroundColor: c.background }]}>
        <ScrollView style={styles.painelLado} contentContainerStyle={{ paddingTop: 32, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <Container>{painel}</Container>
        </ScrollView>
        <View style={{ flex: 1 }}>{mapa}</View>
      </View>
    );
  }

  // Celular: com teclado aberto a janela encolhe, e o mapa encolhe junto para o campo continuar à vista.
  const alturaMapa = Math.max(alturaJanela * 0.3, alturaJanela < 520 ? 120 : 200);
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {resultado ? <View style={{ height: alturaMapa + insets.top }}>{mapa}</View> : null}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: resultado ? 12 : insets.top + 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Container>{painel}</Container>
      </ScrollView>
    </View>
  );
}

/** Trajeto recolhido no celular: uma linha, para sobrar tela para o mapa e os horários. */
function Trajeto({ de, para, onEditar }: { de: string; para: string; onEditar: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const alvo = useAlvo();
  return (
    <Pressable onPress={onEditar} accessibilityRole="button" accessibilityLabel={`Trajeto de ${de} para ${para}. Editar`} style={[styles.trajeto, { minHeight: alvo }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[theme.typography.captionMd, { color: c.text }]}>{de}</Text>
        <Text numberOfLines={1} style={[theme.typography.captionMd, { color: c.text }]}>{para}</Text>
      </View>
      <Text style={[theme.typography.captionMd, { color: c.accent }]}>Editar</Text>
    </Pressable>
  );
}

/** Hoje, amanhã e os próximos dias, rolando na horizontal dentro do próprio trilho. */
function Dias({ dias, valor, onChange }: { dias: { chave: string; rotulo: string }[]; valor: string; onChange: (d: string) => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const alvo = useAlvo();
  const desktop = useDesktopLayout();
  // Mouse não rola na horizontal: no desktop os dias quebram linha; no toque, um trilho só para gastar menos altura.
  const Trilho = desktop ? View : ScrollView;
  const trilho = desktop ? { style: styles.diasQuebra } : { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: styles.dias };
  return (
    <Trilho {...(trilho as object)} accessibilityRole="tablist" accessibilityLabel="Dia da saída">
      {dias.map((d) => {
        const ativo = d.chave === valor;
        return (
          <Pressable
            key={d.chave}
            onPress={() => onChange(d.chave)}
            accessibilityRole="tab"
            aria-selected={ativo}
            style={[styles.dia, { minHeight: alvo, backgroundColor: ativo ? c.accentSoft : c.surfaceAlt, borderColor: ativo ? c.accent : c.border }]}
          >
            <Text style={[theme.typography.captionMd, { color: ativo ? c.text : c.textMuted }]}>{d.rotulo}</Text>
          </Pressable>
        );
      })}
    </Trilho>
  );
}

function Resultado({ r, saida, onSaida }: { r: Horarios; saida: number; onSaida: (i: number) => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const importa = horarioImporta(r);
  const melhor = r.horarios[r.melhor];
  const escolhido = r.horarios[saida];
  const max = Math.max(...r.horarios.map((h) => h.tempo_seg));
  const nota = 'Mesmo caminho em todos os horários. Previsão pelo histórico, sem trânsito ao vivo.';

  if (!importa) {
    return (
      <Cartao padding={16}>
        <View style={styles.tantoFaz}>
          <Icon name="ion:checkmark-circle" size={18} color={c.success} />
          <Text aria-live="polite" accessibilityLiveRegion="polite" style={[theme.typography.bodyMd, { color: c.text, flex: 1 }]}>
            {resumoMelhor(r)}
          </Text>
        </View>
        <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 8, fontSize: 12 }]}>{nota}</Text>
      </Cartao>
    );
  }

  const colunas: Coluna[] = r.horarios.map((h, i) => {
    const mostra = i === saida || i === r.melhor;
    return {
      chave: h.saida,
      valor: h.tempo_seg,
      base: Math.min(r.tempo_livre_seg, h.tempo_seg),
      rotuloTopo: mostra ? String(minutos(h.tempo_seg)) : undefined,
      a11y: `Saindo às ${hhmm(h.saida)}: ${minutos(h.tempo_seg)} minutos${i === r.melhor ? ', o horário mais rápido' : ''}`,
    };
  });

  return (
    <Cartao padding={16}>
      <Text style={[theme.typography.eyebrow, { color: c.textMuted }]}>Melhor saída</Text>
      <View style={styles.manchete} aria-live="polite" accessibilityLiveRegion="polite">
        <Text style={[theme.typography.num, { color: c.text }]}>{hhmm(melhor.saida)}</Text>
        <Text style={[theme.typography.bodyMd, { color: c.textMuted }]}>{`${minutos(melhor.tempo_seg)} min de viagem`}</Text>
      </View>
      <Text style={[theme.typography.caption, { color: c.textMuted }]}>{resumoMelhor(r)}</Text>

      <View style={{ marginTop: 16 }}>
        <Colunas
          colunas={colunas}
          max={max}
          selecionada={saida}
          destaque={r.melhor}
          onSelecionar={onSaida}
          rotulo="Tempo de viagem por horário de saída"
          marcaCada={Math.ceil(r.horarios.length / 4)}
          marca={(i) => hhmm(r.horarios[i].saida)}
          altura={100}
        />
      </View>

      {/* As setas têm 44 px: o jeito preciso de trocar de saída quando a coluna é fina demais para o dedo. */}
      <View style={styles.passo}>
        <BotaoIcone icone="ion:chevron-back" rotulo="Saída anterior" tamanho={20} onPress={() => onSaida(Math.max(0, saida - 1))} style={{ margin: 0 }} />
        <Text style={[theme.typography.bodyMd, { color: c.text, flex: 1, textAlign: 'center' }]} aria-live="polite">
          {`Saindo às ${hhmm(escolhido.saida)}: ${minutos(escolhido.tempo_seg)} min`}
        </Text>
        <BotaoIcone icone="ion:chevron-forward" rotulo="Próxima saída" tamanho={20} onPress={() => onSaida(Math.min(r.horarios.length - 1, saida + 1))} style={{ margin: 0 }} />
      </View>

      <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 4, fontSize: 12 }]}>
        {`Base da coluna: ${minutos(r.tempo_livre_seg)} min sem trânsito. ${nota}`}
      </Text>
    </Cartao>
  );
}

function Esqueleto() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Calculando os horários">
      <Cartao padding={16}>
        <Skeleton altura={12} largura="30%" />
        <View style={{ height: 10 }} />
        <Skeleton altura={28} largura="55%" />
        <View style={styles.esqueletoColunas}>
          {ALTURAS_ESQUELETO.map((a, i) => (
            <View key={i} style={{ flex: 1 }}>
              <Skeleton altura={a} raio={4} />
            </View>
          ))}
        </View>
      </Cartao>
    </View>
  );
}

const styles = StyleSheet.create({
  lado: { flex: 1, flexDirection: 'row' },
  painelLado: { width: 460, flexGrow: 0, flexShrink: 0 },
  controlesMapa: { position: 'absolute', right: 12, zIndex: 20, gap: 8 },
  legenda: { position: 'absolute', left: 12, bottom: 12, zIndex: 20 },
  campos: { gap: 8 },
  trajeto: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dias: { gap: 8 },
  diasQuebra: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dia: { paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  erro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingLeft: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  tentar: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  tantoFaz: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  manchete: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10, marginTop: 4 },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  esqueletoColunas: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginTop: 20, height: 100 },
});
