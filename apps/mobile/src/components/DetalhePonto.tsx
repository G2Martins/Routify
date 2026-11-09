/**
 * Um ponto monitorado (GET /trafego/ponto/{id}): visão geral em cima e, logo abaixo, o histórico do nosso banco. O cabeçalho
 * sai na hora com o que /trafego/agora já trouxe; o resto chega depois, com esqueleto. O nome vem do OSM: só como texto.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { API_URL } from '../lib/api';
import {
  dataTxt,
  DetalhePonto as Dados,
  DIA_SEMANA,
  diaCurto,
  diaHoraTxt,
  erroDoPonto,
  horaEDiaAgora,
  idadeLeitura,
  NIVEIS,
  nomeDoPonto,
  Ponto,
  razaoTxt,
  ROTULO_NIVEL,
} from '../lib/trafego';
import Colunas, { Coluna } from './Colunas';
import { BotaoIcone, Selo, Skeleton } from './ui';

const TOM_NIVEL = ['ok', 'alerta', 'alerta', 'erro'] as const;
const MAX_DIAS = 7;
const MAX_LEITURAS = 6;
const CACHE_MS = 60_000; // a API também guarda 60 s; abrir o mesmo ponto de novo não gasta o limite por IP

// ponytail: sem limite; no máximo um por ponto monitorado (630 × ~4 KB), e a sessão acaba antes de pesar.
const guardados = new Map<number, { em: number; dados: Dados }>();

export default function DetalhePonto({ id, ponto, onFechar }: { id: number; ponto?: Ponto; onFechar: () => void }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const pedido = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    pedido.current?.abort();
    const guardado = guardados.get(id);
    if (guardado && Date.now() - guardado.em < CACHE_MS) {
      setDados(guardado.dados);
      setErro(null);
      setCarregando(false);
      return;
    }
    const ctrl = new AbortController();
    pedido.current = ctrl;
    const prazo = setTimeout(() => ctrl.abort(), 15_000);
    setDados(null);
    setErro(null);
    setCarregando(true);
    try {
      const r = await fetch(`${API_URL}/trafego/ponto/${id}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error(erroDoPonto(r.status));
      const j: Dados = await r.json();
      guardados.set(id, { em: Date.now(), dados: j });
      if (!ctrl.signal.aborted) setDados(j);
    } catch (e) {
      if (ctrl.signal.aborted && pedido.current !== ctrl) return; // já é outro ponto
      // Só as mensagens lançadas acima; as do navegador viriam em inglês ("Failed to fetch").
      setErro(e instanceof Error && e.name === 'Error' ? e.message : 'Sem conexão com o servidor.');
    } finally {
      clearTimeout(prazo);
      if (pedido.current === ctrl) setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    carregar();
    return () => pedido.current?.abort();
  }, [carregar]);

  const agora = dados?.agora ?? (ponto ? { razao: ponto.razao, nivel: ponto.nivel, leitura_ha_min: ponto.leitura_ha_min } : null);
  const nome = dados || ponto ? nomeDoPonto({ nome: dados?.nome ?? ponto?.nome ?? null, id }) : '';

  return (
    <View accessibilityLabel={nome ? `Detalhes de ${nome}` : 'Detalhes do ponto'}>
      <View style={styles.cabecalho}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          {nome ? <Text numberOfLines={2} style={[theme.typography.h3, { color: c.text }]}>{nome}</Text> : <Skeleton altura={22} largura="70%" />}
          {agora ? <Selo tom={TOM_NIVEL[agora.nivel] ?? 'neutro'} ponto>{ROTULO_NIVEL[NIVEIS[agora.nivel]] ?? 'Sem dado'}</Selo> : null}
        </View>
        <BotaoIcone icone="ion:close" rotulo="Fechar detalhes" tamanho={20} onPress={onFechar} style={{ margin: 0 }} />
      </View>

      {/* Visão geral */}
      <View style={styles.grade}>
        <Dado rotulo="Razão agora" valor={agora ? razaoTxt(agora.razao) : 'Sem dado'} nota={agora ? `${Math.round(agora.razao * 100)}% da livre` : undefined} />
        <Dado rotulo="Velocidade livre" valor={dados?.vel_livre_kmh ? `${Math.round(dados.vel_livre_kmh)} km/h` : carregando ? null : 'Sem dado'} />
        <Dado rotulo="Última leitura" valor={agora ? idadeLeitura(agora.leitura_ha_min) : 'Sem leitura'} largura />
      </View>
      <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 10, fontSize: 12 }]}>
        Razão é a velocidade atual dividida pela velocidade livre: 1,0 é via livre, 0,5 é metade da velocidade.
      </Text>

      {/* Histórico */}
      <Text style={[theme.typography.eyebrow, { color: c.textMuted, marginTop: 24 }]}>Histórico</Text>

      {erro ? (
        <View accessibilityRole="alert" style={{ marginTop: 10 }}>
          <Text style={[theme.typography.body, { color: c.danger }]}>{erro}</Text>
          <Pressable onPress={carregar} accessibilityRole="button" style={styles.tentar}>
            <Text style={[theme.typography.captionMd, { color: c.accent }]}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : carregando || !dados ? (
        <Esqueleto />
      ) : dados.historico.n_leituras === 0 ? (
        <Text style={[theme.typography.body, { color: c.textMuted, marginTop: 8 }]}>Ainda sem leituras deste ponto.</Text>
      ) : (
        <Historico h={dados.historico} />
      )}
    </View>
  );
}

function Dado({ rotulo, valor, nota, largura }: { rotulo: string; valor: string | null; nota?: string; largura?: boolean }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={[styles.dado, largura && styles.dadoLargo, { backgroundColor: c.surfaceAlt }]}>
      <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>{rotulo}</Text>
      {valor === null ? (
        <Skeleton altura={20} largura="60%" />
      ) : (
        <Text style={[{ color: c.text, fontFamily: theme.fonts.monoBold, fontSize: 18, lineHeight: 24, fontVariant: ['tabular-nums'] }]}>{valor}</Text>
      )}
      {nota ? <Text style={[theme.typography.caption, { color: c.textMuted, fontSize: 12 }]}>{nota}</Text> : null}
    </View>
  );
}

function Historico({ h }: { h: Dados['historico'] }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const { hora, dia } = horaEDiaAgora(new Date());
  const [horaSel, setHoraSel] = useState(hora);
  const [diaSel, setDiaSel] = useState(dia);
  const periodo = h.primeira_leitura && h.ultima_leitura ? ` de ${dataTxt(h.primeira_leitura)} a ${dataTxt(h.ultima_leitura)}` : '';

  const leitura = (v: { razao: number | null; n: number }) =>
    v.razao == null ? 'sem leituras' : `razão ${razaoTxt(v.razao)} em ${v.n.toLocaleString('pt-BR')} ${v.n === 1 ? 'leitura' : 'leituras'}`;
  const colunasHora: Coluna[] = h.por_hora.map((v) => ({ chave: `h${v.hora}`, valor: v.razao, a11y: `${v.hora} horas: ${leitura(v)}` }));
  const colunasDia: Coluna[] = h.por_dia_semana.map((v) => ({ chave: `d${v.dia}`, valor: v.razao, a11y: `${DIA_SEMANA[v.dia]}: ${leitura(v)}` }));

  return (
    <View>
      <Text style={[theme.typography.caption, { color: c.textMuted, marginTop: 4 }]}>
        {`${h.n_leituras.toLocaleString('pt-BR')} leituras${periodo}.`}
      </Text>

      <Text style={[theme.typography.captionMd, styles.subtitulo, { color: c.text }]}>Razão por hora do dia</Text>
      <Text style={[theme.typography.caption, { color: c.textMuted, marginBottom: 8 }]} aria-live="polite">
        {`${horaSel}h: ${leitura(h.por_hora[horaSel] ?? { razao: null, n: 0 })}`}
      </Text>
      <Colunas
        colunas={colunasHora}
        max={1}
        selecionada={horaSel}
        onSelecionar={setHoraSel}
        rotulo="Razão por hora do dia"
        altura={88}
        marcaCada={6}
        marca={(i) => `${h.por_hora[i].hora}h`}
        seguirMouse
      />

      <Text style={[theme.typography.captionMd, styles.subtitulo, { color: c.text }]}>Razão por dia da semana</Text>
      <Text style={[theme.typography.caption, { color: c.textMuted, marginBottom: 8 }]} aria-live="polite">
        {`${DIA_SEMANA[diaSel]}: ${leitura(h.por_dia_semana[diaSel] ?? { razao: null, n: 0 })}`}
      </Text>
      <Colunas
        colunas={colunasDia}
        max={1}
        selecionada={diaSel}
        onSelecionar={setDiaSel}
        rotulo="Razão por dia da semana"
        altura={72}
        marca={(i) => DIA_SEMANA[h.por_dia_semana[i].dia]}
        seguirMouse
      />

      {h.ultimos_dias.length ? (
        <>
          <Text style={[theme.typography.captionMd, styles.subtitulo, { color: c.text }]}>Últimos dias</Text>
          {[...h.ultimos_dias].sort((a, b) => b.dia.localeCompare(a.dia)).slice(0, MAX_DIAS).map((d) => (
            <Linha key={d.dia} quando={diaCurto(d.dia)} velocidade={d.vel_kmh} razao={d.razao} />
          ))}
        </>
      ) : null}

      {h.ultimas.length ? (
        <>
          <Text style={[theme.typography.captionMd, styles.subtitulo, { color: c.text }]}>Últimas leituras</Text>
          {[...h.ultimas].sort((a, b) => b.em.localeCompare(a.em)).slice(0, MAX_LEITURAS).map((l) => (
            <Linha key={l.em} quando={diaHoraTxt(l.em)} velocidade={l.vel_kmh} razao={l.razao} />
          ))}
        </>
      ) : null}
    </View>
  );
}

/** Linha de tabela: quando · velocidade · razão, com números alinhados. */
function Linha({ quando, velocidade, razao }: { quando: string; velocidade: number; razao: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const mono = { fontFamily: theme.fonts.mono, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums' as const] };
  return (
    <View style={[styles.linha, { borderTopColor: c.border }]} accessible accessibilityLabel={`${quando}: ${Math.round(velocidade)} quilômetros por hora, razão ${razaoTxt(razao)}`}>
      <Text numberOfLines={1} style={[mono, { color: c.textMuted, flex: 1 }]}>{quando}</Text>
      <Text style={[mono, { color: c.text, width: 72, textAlign: 'right' }]}>{`${Math.round(velocidade)} km/h`}</Text>
      <Text style={[mono, { color: c.text, width: 44, textAlign: 'right' }]}>{razaoTxt(razao)}</Text>
    </View>
  );
}

function Esqueleto() {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Carregando o histórico" style={{ gap: 10, marginTop: 10 }}>
      <Skeleton altura={14} largura="70%" />
      <Skeleton altura={88} raio={4} />
      <Skeleton altura={14} largura="45%" />
      <Skeleton altura={72} raio={4} />
      <Skeleton altura={14} largura="35%" />
      <Skeleton altura={18} />
      <Skeleton altura={18} />
      <Skeleton altura={18} />
    </View>
  );
}

const styles = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  dado: { flexGrow: 1, flexBasis: 130, minWidth: 0, padding: 12, borderRadius: 8, gap: 2 },
  dadoLargo: { flexBasis: '100%' },
  subtitulo: { marginTop: 20, marginBottom: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },
  tentar: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
