import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { fonts } from '../constants/Theme';
import Icon from '../components/Icon';
import { Cartao, FaixaMarca, RotuloSecao, Selo, Surgir, Tela, TituloPagina } from '../components/ui';

/** Destaque dentro do texto (herda a cor do parágrafo). */
const B = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ fontFamily: fonts.sansSemi }}>{children}</Text>
);

interface Item {
  icone: string;
  titulo: string;
  texto: React.ReactNode;
}

// Fatos conferidos em apps/api/usage.py e supabase/migrations/20260923010000_usage_tracking_admin.sql.
const COLETA: Item[] = [
  {
    icone: 'ion:person-outline',
    titulo: 'Cadastro',
    texto: 'E-mail e nome, para você entrar na conta e o app te chamar pelo nome.',
  },
  {
    icone: 'ion:server-outline',
    titulo: 'Uso do servidor',
    texto: (
      <>
        De cada chamada guardamos <B>o endereço, o resultado e o tempo de resposta</B>, para medir erros e desempenho.
      </>
    ),
  },
  {
    icone: 'ion:navigate-outline',
    titulo: 'Rotas calculadas',
    texto: (
      <>
        Origem e destino <B>arredondados em ~110 m</B>, com distância, tempo previsto e horário. Nunca o ponto exato.
      </>
    ),
  },
  {
    icone: 'ion:analytics-outline',
    titulo: 'Eventos de uso',
    texto: (
      <>
        Ações como “rota solicitada” ou “navegação iniciada”, <B>sem coordenadas</B> e sem o texto digitado.
      </>
    ),
  },
  {
    icone: 'ion:eye-off-outline',
    titulo: 'Busca de lugares',
    texto: (
      <>
        O <B>texto digitado não é guardado</B>. Ele só vai ao provedor de mapas (TomTom ou OpenStreetMap) para sugerir
        lugares naquele momento.
      </>
    ),
  },
  {
    icone: 'ion:locate',
    titulo: 'Localização do aparelho',
    texto:
      'Usada para centralizar o mapa e sugerir a origem. A coordenada só sai do aparelho quando você pede uma rota: vai ao servidor do Routify, que consulta o trânsito do trajeto na TomTom. Sem GPS no navegador, o mapa centraliza na cidade do seu IP (ipapi.co). Os provedores do mapa (na web, OpenFreeMap e Esri) recebem o IP e a área vista, como em qualquer site de mapas.',
  },
];

const GUARDA: Item[] = [
  {
    icone: 'ion:time-outline',
    titulo: 'Retenção de 90 dias',
    texto: (
      <>
        Requisições, rotas calculadas e eventos são <B>apagados automaticamente depois de 90 dias</B>.
      </>
    ),
  },
  {
    icone: 'ion:lock-closed-outline',
    titulo: 'Histórico só seu',
    texto: (
      <>
        As rotas da aba Histórico ficam protegidas no banco: <B>só você vê</B>, e pode excluir qualquer uma.
      </>
    ),
  },
  {
    icone: 'ion:layers-outline',
    titulo: 'Equipe vê só agregados',
    texto:
      'O painel da equipe mostra totais e coordenadas arredondadas, nunca a trilha de uma pessoa. Nada é vendido nem cedido.',
  },
  {
    icone: 'ion:flash-outline',
    titulo: 'A LIA não aprende com você',
    texto:
      'O modelo é treinado só com dados públicos de tráfego (TomTom e OpenStreetMap). Suas rotas não entram no treino.',
  },
];

const DIREITOS: Item[] = [
  {
    icone: 'ion:mail-outline',
    titulo: 'Seus direitos (LGPD)',
    texto: (
      <>
        Você pode pedir <B>acesso, correção, exportação ou exclusão</B> dos seus dados e da conta, pelo e-mail
        institucional da equipe do TCC.
      </>
    ),
  },
  {
    icone: 'ion:checkmark-circle',
    titulo: 'Segurança',
    texto:
      'Conexão criptografada e senha guardada só como hash, nunca em texto puro.',
  },
];

export default function PrivacyScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;

  // `inicio` continua o escalonamento de onde a seção anterior parou.
  const grade = (itens: Item[], inicio: number) => (
    <View style={styles.grade}>
      {itens.map((item, i) => (
        <Surgir key={item.titulo} ordem={inicio + i} style={styles.celula}>
          <Cartao style={{ flex: 1 }}>
            <View style={[styles.iconeCirculo, { backgroundColor: c.accentSoft }]}>
              <Icon name={item.icone} size={18} color={c.accent} />
            </View>
            <Text style={[theme.typography.h4, { color: c.text, marginTop: 14 }]}>{item.titulo}</Text>
            <Text style={[theme.typography.body, styles.texto, { color: c.textMuted }]}>{item.texto}</Text>
          </Cartao>
        </Surgir>
      ))}
    </View>
  );

  return (
    <Tela voltar={() => navigation.goBack()}>
        <Surgir>
          <TituloPagina titulo="Privacidade" sub="Como tratamos seus dados, conforme a LGPD." />
        </Surgir>

        <Surgir ordem={1} style={{ marginTop: 24 }}>
          <Cartao padding={0} style={{ overflow: 'hidden' }}>
            <FaixaMarca altura={3} style={{ borderRadius: 0 }} />
            <View style={styles.resumo}>
              <View style={[styles.iconeCirculo, { backgroundColor: c.accentSoft }]}>
                <Icon name="ion:lock-closed-outline" size={18} color={c.accent} />
              </View>
              <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0 }}>
                <Text style={[theme.typography.h3, { color: c.text }]}>Seus dados ficam com você</Text>
                <Text style={[theme.typography.body, styles.texto, { color: c.textMuted }]}>
                  O Routify é um trabalho acadêmico (TCC). Não vendemos seus dados e suas rotas não treinam o modelo.
                </Text>
                <View style={styles.selos}>
                  <Selo tom="marca">Retenção de 90 dias</Selo>
                  <Selo tom="marca">Coordenadas arredondadas</Selo>
                  <Selo tom="marca">Busca não é guardada</Selo>
                  <Selo tom="marca">Histórico só seu</Selo>
                </View>
              </View>
            </View>
          </Cartao>
        </Surgir>

        <RotuloSecao>O que coletamos</RotuloSecao>
        {grade(COLETA, 2)}

        <RotuloSecao>Por quanto tempo e quem vê</RotuloSecao>
        {grade(GUARDA, 2 + COLETA.length)}

        <RotuloSecao>Direitos e segurança</RotuloSecao>
        {grade(DIREITOS, 2 + COLETA.length + GUARDA.length)}

        <Text style={[theme.typography.caption, styles.rodape, { color: c.textSubtle }]}>
          Última revisão: 9 de novembro de 2026
        </Text>
    </Tela>
  );
}

const styles = StyleSheet.create({
  resumo: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 16 },
  selos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  grade: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  celula: { flexGrow: 1, flexShrink: 1, flexBasis: 320, minWidth: 0, padding: 6 },
  iconeCirculo: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  texto: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  rodape: { textAlign: 'center', marginTop: 40 },
});
