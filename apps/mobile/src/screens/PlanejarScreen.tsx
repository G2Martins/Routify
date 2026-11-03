/**
 * Planejar saída: a LIA prevê quanto o MESMO trajeto leva em cada horário de partida (POST /route/horarios)
 * e aponta o mais rápido. É previsão pelo histórico de cada hora, sem trânsito ao vivo (a API não chama a TomTom).
 *
 * Gráfico de barras em View puro (sem biblioteca): a saída mais rápida em destaque, as outras em cinza. Cada
 * linha traz a hora e os minutos, então a lista é também a tabela do gráfico (leitor de tela inclusive).
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useDesktopLayout } from '../lib/responsive';
import { postApi } from '../lib/api';
import { ganhoMin, Horario, Horarios, hhmm, mensagemDeErro, minutos, resumoMelhor } from '../lib/planejar';
import AddressAutocomplete, { PlaceSuggestion } from '../components/AddressAutocomplete';
import Button from '../components/Button';
import Icon from '../components/Icon';
import { Cartao, Container, Skeleton, Surgir, TituloPagina } from '../components/ui';

const LARGURAS_ESQUELETO = [72, 84, 64, 90, 78, 86, 68, 80];

export default function PlanejarScreen() {
  const { theme } = useTheme();
  const c = theme.colors;
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();

  const [origemText, setOrigemText] = useState('');
  const [destinoText, setDestinoText] = useState('');
  const [origem, setOrigem] = useState<PlaceSuggestion | null>(null);
  const [destino, setDestino] = useState<PlaceSuggestion | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Horarios | null>(null);

  const planejar = async () => {
    if (!origem || !destino || carregando) return;
    setErro(null);
    setCarregando(true);
    try {
      const { status, dados } = await postApi<Horarios>('/route/horarios', {
        origem: { lat: origem.lat, lon: origem.lon },
        destino: { lat: destino.lat, lon: destino.lon },
      });
      if (status === 200 && dados?.horarios?.length) setResultado(dados);
      else setErro(mensagemDeErro(status, dados));
    } catch {
      setErro('Não deu para falar com a API. Verifique a conexão e tente de novo.');
    } finally {
      setCarregando(false);
    }
  };

  // Outro ponto = outro trajeto: o gráfico anterior deixa de valer.
  const trocarOrigem = (p: PlaceSuggestion | null) => {
    setOrigem(p);
    setResultado(null);
  };
  const trocarDestino = (p: PlaceSuggestion | null) => {
    setDestino(p);
    setResultado(null);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ paddingTop: desktop ? 32 : insets.top + 16, paddingBottom: 100 }}
      keyboardShouldPersistTaps="handled"
    >
      <Container>
        <Surgir>
          <TituloPagina titulo="Planejar saída" sub="A LIA prevê quanto o mesmo trajeto leva em cada horário de partida." />
        </Surgir>

        {/* zIndex: a lista de sugestões abre por cima do gráfico. */}
        <Surgir ordem={1} style={{ marginTop: 24, zIndex: 2 }}>
          <Cartao padding={16}>
            <View style={[styles.campos, desktop && styles.camposLinha]}>
              <View style={[desktop && styles.campoLinha, { zIndex: 2 }]}>
                <AddressAutocomplete
                  placeholder="De onde você sai?"
                  value={origemText}
                  onChangeText={(v: string) => {
                    setOrigemText(v);
                    if (origem) trocarOrigem(null);
                  }}
                  onSelect={(p: PlaceSuggestion) => {
                    trocarOrigem(p);
                    setOrigemText(p.label);
                  }}
                  perto={destino}
                  zIndex={2}
                />
              </View>
              <View style={[desktop && styles.campoLinha, { zIndex: 1 }]}>
                <AddressAutocomplete
                  placeholder="Para onde você vai?"
                  value={destinoText}
                  onChangeText={(v: string) => {
                    setDestinoText(v);
                    if (destino) trocarDestino(null);
                  }}
                  onSelect={(p: PlaceSuggestion) => {
                    trocarDestino(p);
                    setDestinoText(p.label);
                  }}
                  perto={origem}
                  zIndex={1}
                />
              </View>
              <Button
                label={carregando ? 'Planejando…' : 'Planejar'}
                icon="ion:alarm-outline"
                size={desktop ? 'md' : 'lg'}
                fullWidth={!desktop}
                loading={carregando}
                disabled={!origem || !destino}
                onPress={planejar}
                style={desktop ? { alignSelf: 'center' } : undefined}
              />
            </View>

            {erro ? (
              <View
                accessibilityRole="alert"
                style={[styles.erro, { backgroundColor: c.surfaceAlt, borderColor: c.border, borderLeftColor: c.danger }]}
              >
                <Icon name="ion:alert-circle-outline" size={16} color={c.danger} />
                <Text style={[theme.typography.caption, { flex: 1, color: c.text }]}>{erro}</Text>
                <Pressable onPress={() => setErro(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar aviso">
                  <Icon name="ion:close" size={16} color={c.textMuted} />
                </Pressable>
              </View>
            ) : null}
          </Cartao>
        </Surgir>

        {resultado ? (
          <Surgir ordem={2} style={{ marginTop: 16 }}>
            {/* Recalculando: o gráfico anterior fica esmaecido no lugar, sem pulo de layout. */}
            <View style={{ opacity: carregando ? 0.5 : 1 }}>
              <Resultado r={resultado} />
            </View>
          </Surgir>
        ) : carregando ? (
          <Surgir ordem={2} style={{ marginTop: 16 }}>
            <Esqueleto />
          </Surgir>
        ) : null}
      </Container>
    </ScrollView>
  );
}

function Resultado({ r }: { r: Horarios }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const max = Math.max(...r.horarios.map((h) => h.tempo_seg));
  const destaque = ganhoMin(r) >= 1; // diferença de segundos não elege "a melhor hora"
  return (
    <Cartao>
      <Text style={[theme.typography.h4, { color: c.text }]}>Tempo de viagem por horário de saída</Text>
      <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 2 }]}>
        {`Mesmo trajeto em todas as saídas · ${r.distancia_km.toFixed(1).replace('.', ',')} km`}
      </Text>

      <View style={[styles.resumo, { backgroundColor: c.accentSoft }]}>
        <Icon name="ion:alarm-outline" size={18} color={c.accent} />
        <Text
          aria-live="polite"
          accessibilityLiveRegion="polite"
          style={[theme.typography.bodyMd, { color: c.text, flex: 1, fontSize: 14, lineHeight: 20 }]}
        >
          {resumoMelhor(r)}
        </Text>
      </View>

      <View accessibilityRole="list" style={styles.lista}>
        {r.horarios.map((h, i) => (
          <Linha key={h.saida} h={h} max={max} melhor={destaque && i === r.melhor} />
        ))}
      </View>

      <Text style={[theme.typography.caption, { color: c.textSubtle, marginTop: 16, fontSize: 12 }]}>
        {`Previsão da LIA pelo histórico de cada horário, sem trânsito ao vivo. Sem trânsito nenhum, ~${minutos(r.tempo_livre_seg)} min. `}
        {`A LIA tem sensor por perto em ${Math.round(r.lia_cobertura_pct)}% do trajeto; no resto vale o trânsito que ela prevê para a cidade.`}
      </Text>
    </Cartao>
  );
}

/** Uma saída: hora · barra (comprimento ∝ tempo, a partir do zero) · minutos. */
function Linha({ h, max, melhor }: { h: Horario; max: number; melhor: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const min = minutos(h.tempo_seg);
  const texto = { color: melhor ? c.text : c.textMuted, fontFamily: melhor ? theme.fonts.monoBold : theme.fonts.mono };
  return (
    <View
      accessible
      accessibilityLabel={`Saindo às ${hhmm(h.saida)}: ${min} minutos${melhor ? ', o horário mais rápido' : ''}`}
      style={styles.linha}
    >
      <Text style={[styles.num, styles.hora, texto]}>{hhmm(h.saida)}</Text>
      <View style={styles.faixa}>
        <View
          style={[
            styles.barra,
            { width: `${Math.round((h.tempo_seg / max) * 100)}%`, backgroundColor: melhor ? c.accent : c.textSubtle },
          ]}
        />
      </View>
      <View style={styles.valor}>
        <Text style={[styles.num, texto]}>{`${min} min`}</Text>
        {melhor ? <Icon name="ion:checkmark-circle" size={14} color={c.accent} /> : <View style={styles.semIcone} />}
      </View>
    </View>
  );
}

function Esqueleto() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Calculando os horários">
      <Cartao>
        <Skeleton altura={16} largura="55%" />
        <View style={{ height: 16 }} />
        <Skeleton altura={44} />
        <View style={styles.lista}>
          {LARGURAS_ESQUELETO.map((w, i) => (
            <View key={i} style={styles.linha}>
              <Skeleton altura={12} largura={44} raio={4} />
              <View style={styles.faixa}>
                <Skeleton altura={12} largura={`${w}%`} raio={4} />
              </View>
            </View>
          ))}
        </View>
      </Cartao>
    </View>
  );
}

const styles = StyleSheet.create({
  campos: { gap: 8 },
  camposLinha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  campoLinha: { flex: 1 },
  erro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  resumo: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8 },
  lista: { marginTop: 16, gap: 6 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
  num: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  hora: { width: 44 },
  // Barra de 12 px a partir do zero, ponta arredondada e base reta.
  faixa: { flex: 1, justifyContent: 'center' },
  barra: { height: 12, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  valor: { width: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  semIcone: { width: 14 },
});
