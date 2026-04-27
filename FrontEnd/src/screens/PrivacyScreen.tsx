import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from '../components/Icon';

interface Section {
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    title: '1. Quais dados coletamos',
    body:
      'O Routify coleta apenas o necessário para operar o motor preditivo: email e nome (cadastro), origem e destino das rotas calculadas e métricas anônimas de uso (latência, tempo de resposta da LIA). Não coletamos contatos, fotos ou dados de navegação fora do app.',
  },
  {
    title: '2. Localização',
    body:
      'Sua localização em tempo real é usada exclusivamente para centralizar o mapa e sugerir origem ao calcular uma rota. A coordenada não é enviada ao servidor sem sua ação explícita (clicar em "Otimizar rota").',
  },
  {
    title: '3. Histórico de rotas',
    body:
      'Cada rota otimizada é armazenada na sua conta para consulta futura na aba "Histórico". Esses registros são protegidos por Row Level Security (RLS) no Supabase — apenas você acessa o seu histórico. Você pode excluir qualquer rota a qualquer momento.',
  },
  {
    title: '4. Compartilhamento',
    body:
      'Routify é um trabalho acadêmico (TCC). Não vendemos, alugamos ou compartilhamos dados pessoais com terceiros. Métricas agregadas e anônimas podem ser usadas em publicações acadêmicas relacionadas ao projeto.',
  },
  {
    title: '5. Segurança',
    body:
      'Autenticação é gerenciada pelo Supabase Auth com criptografia em repouso e em trânsito (TLS 1.3). Senhas são armazenadas com hash bcrypt — nunca em texto puro. Recomendamos senhas com no mínimo 8 caracteres e ativar autenticação em duas etapas quando disponível.',
  },
  {
    title: '6. Seus direitos (LGPD)',
    body:
      'Você pode solicitar a qualquer momento: acesso aos seus dados, correção de informações incorretas, exclusão da conta e portabilidade dos registros. Para exercer esses direitos, contate a equipe via email institucional do TCC.',
  },
  {
    title: '7. IA Preditiva (LIA)',
    body:
      'A LIA é treinada exclusivamente com dados públicos de tráfego (TomTom Flow API e OpenStreetMap). Suas rotas individuais não alimentam o modelo — o treinamento usa apenas a malha viária agregada de Brasília-DF.',
  },
  {
    title: '8. Atualizações desta política',
    body:
      'Esta política pode ser atualizada para refletir mudanças no escopo do projeto ou requisitos regulatórios. Revisaremos a data de revisão abaixo a cada alteração significativa.',
  },
];

export default function PrivacyScreen({ navigation }: any) {
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 20, paddingTop: 60, paddingBottom: 80 }}
    >
      <Pressable
        onPress={() => navigation.goBack()}
        style={[styles.back, { backgroundColor: c.surfaceAlt }]}
      >
        <Icon name="ion:arrow-back" size={20} color={c.text} />
      </Pressable>

      <Text style={[styles.title, { color: c.text }]}>Privacidade</Text>
      <Text style={[styles.subtitle, { color: c.textMuted }]}>
        Como o Routify trata seus dados.
      </Text>

      <View style={[styles.heroCard, { backgroundColor: c.inverse }]}>
        <Icon name="ion:lock-closed-outline" size={28} color={c.onInverse} />
        <Text style={{ color: c.onInverse, fontSize: 16, fontWeight: '700', marginTop: 12 }}>
          Seus dados ficam com você
        </Text>
        <Text style={{ color: c.onInverse, opacity: 0.7, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
          Routify é um TCC acadêmico. Não vendemos, não compartilhamos e não usamos suas rotas para
          treinar modelos. Tudo que está abaixo é o que coletamos e por quê.
        </Text>
      </View>

      {SECTIONS.map((s, i) => (
        <View
          key={i}
          style={[styles.section, { backgroundColor: c.surface, borderColor: c.surfaceMuted }]}
        >
          <Text style={[styles.sectionTitle, { color: c.text }]}>{s.title}</Text>
          <Text style={[styles.sectionBody, { color: c.textMuted }]}>{s.body}</Text>
        </View>
      ))}

      <Text style={[styles.footer, { color: c.textSubtle }]}>
        Última revisão: 27 de abril de 2026 · Routify · TCC
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, marginTop: 6, marginBottom: 20 },
  heroCard: { borderRadius: 16, padding: 20, marginBottom: 18 },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  sectionBody: { fontSize: 13, lineHeight: 20 },
  footer: { fontSize: 11, textAlign: 'center', marginTop: 18 },
});
