import React from 'react';
import { StyleSheet, View, Text, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';

export default function DashboardScreen() {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Cabeçalho com a Logo Principal */}
      <View style={styles.header}>
        <Image
            source={require('../../assets/Logo_Routify.png')}
            style={styles.mainLogo}
            resizeMode="contain"
        />
        <Text style={styles.dateText}>Quarta-feira, 01 de Abril</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Desempenho da Frota</Text>

        {/* Grid de Estatísticas Rápidas usando Ionicons */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="timer-outline" size={32} color={Colors.primary} />
            <Text style={styles.statValue}>-45 min</Text>
            <Text style={styles.statLabel}>Tempo Salvo</Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="leaf-outline" size={32} color={Colors.success} />
            <Text style={styles.statValue}>-12%</Text>
            <Text style={styles.statLabel}>Emissões CO₂</Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="git-network-outline" size={32} color={Colors.danger} />
            <Text style={styles.statValue}>8</Text>
            <Text style={styles.statLabel}>Vias Evitadas</Text>
          </View>
        </View>

        {/* Card de Impacto da IA Preditiva */}
        <Text style={styles.sectionTitle}>Impacto da Inteligência Artificial</Text>
        <View style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <Image
                source={require('../../assets/Logo_Routify_icon.png')}
                style={styles.iconLogo}
            />
            <View>
              <Text style={styles.aiTitle}>Otimização Routify</Text>
              <Text style={styles.aiSubtitle}>Status: Operando Ativamente</Text>
            </View>
          </View>
          
          <Text style={styles.aiDescription}>
            O roteamento proativo antecipou gargalos na Estrada Parque Taguatinga (EPTG), redirecionando a rota e reduzindo o custo operacional logístico.
          </Text>

          {/* Barra de Progresso Simulada */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBackground}>
              <View style={styles.progressBarFill} />
            </View>
            <Text style={styles.progressText}>Meta de eficiência diária: 85% atingida</Text>
          </View>
        </View>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.white,
    paddingVertical: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  mainLogo: {
    width: 250,
    height: 80,
    marginBottom: 10,
  },
  dateText: {
    color: Colors.gray,
    fontSize: 14,
    fontWeight: '500',
  },
  content: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: 15,
    marginTop: 10,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 25,
  },
  statCard: {
    backgroundColor: Colors.white,
    width: '31%', // Deixa um pequeno espaçamento entre os 3 cards
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
    marginTop: 8,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.gray,
    textAlign: 'center',
  },
  aiCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  iconLogo: {
    width: 50,
    height: 50,
    borderRadius: 10,
    marginRight: 15,
  },
  aiTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.text,
  },
  aiSubtitle: {
    fontSize: 13,
    color: Colors.success,
    fontWeight: '500',
    marginTop: 2,
  },
  aiDescription: {
    fontSize: 14,
    color: Colors.gray,
    lineHeight: 20,
    marginBottom: 20,
  },
  progressContainer: {
    marginTop: 5,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#E5E5EA',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    width: '85%', // Representa os 85% de preenchimento
  },
  progressText: {
    fontSize: 12,
    color: Colors.gray,
    marginTop: 8,
    textAlign: 'right',
  },
});