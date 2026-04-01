// src/screens/DashboardScreen.tsx
import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Colors } from '../constants/Colors';

export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dashboard Logístico</Text>
      <View style={styles.mockCard}>
        <Text style={styles.cardTitle}>Última Viagem (Simulado)</Text>
        <Text style={styles.cardData}>Tempo: 25 min</Text>
        <Text style={[styles.cardData, { color: Colors.success }]}>Economia IA: 4 min</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: Colors.text },
  mockCard: {
    backgroundColor: Colors.white,
    padding: 20,
    borderRadius: 10,
    elevation: 2,
    width: '90%',
  },
  cardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: Colors.primary },
  cardData: { fontSize: 16, color: Colors.gray, marginBottom: 5 },
});