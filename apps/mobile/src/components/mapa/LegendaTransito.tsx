/** Legenda das cores do trânsito na rota: as mesmas do mapa. Nunca só cor: cada amostra tem o nome ao lado. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { trafficColors } from '../../constants/Theme';
import { useTheme } from '../../context/ThemeContext';
import { FaixaMarca } from '../ui';

export default function LegendaTransito() {
  const { theme, mapStyle } = useTheme();
  const c = theme.colors;
  const [moderado, lento, parado] = trafficColors[mapStyle === 'street' ? 'light' : 'dark'];
  const itens = [
    { rotulo: 'Moderado', cor: moderado },
    { rotulo: 'Lento', cor: lento },
    { rotulo: 'Parado', cor: parado },
  ];
  const rotulo = [theme.typography.caption, { color: c.textMuted, fontSize: 12, lineHeight: 16 }];
  return (
    <View pointerEvents="none" style={[styles.caixa, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.item}>
        <FaixaMarca altura={4} style={styles.amostra} />
        <Text style={rotulo}>Livre</Text>
      </View>
      {itens.map((i) => (
        <View key={i.rotulo} style={styles.item}>
          <View style={[styles.amostra, { height: 4, borderRadius: 4, backgroundColor: i.cor }]} />
          <Text style={rotulo}>{i.rotulo}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  caixa: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  amostra: { width: 14 },
});
