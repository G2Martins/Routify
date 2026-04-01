import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';

// Componente auxiliar para os itens do menu
const MenuItem = ({ icon, title, subtitle }: { icon: any, title: string, subtitle?: string }) => (
  <TouchableOpacity style={styles.menuItem}>
    <View style={styles.menuItemLeft}>
      <Ionicons name={icon} size={24} color={Colors.primary} style={styles.menuIcon} />
      <View>
        <Text style={styles.menuTitle}>{title}</Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
    </View>
    <Ionicons name="chevron-forward" size={20} color={Colors.gray} />
  </TouchableOpacity>
);

export default function ProfileScreen() {
  return (
    <ScrollView style={styles.container}>
      {/* Cabeçalho do Perfil */}
      <View style={styles.header}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person" size={50} color={Colors.white} />
        </View>
        <Text style={styles.userName}>Gustavo Martins Gripaldi</Text>
        <Text style={styles.userRole}>Estagiário de Dados / Gestor</Text>
      </View>

      {/* Lista de Configurações */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Configurações da Frota</Text>
        <MenuItem icon="car-outline" title="Veículo Atual" subtitle="Furgão Husky (Placa PAN-001)" />
        <MenuItem icon="speedometer-outline" title="Preferências de Rota" subtitle="Priorizar IA Preditiva" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Conta & Segurança</Text>
        <MenuItem icon="people-outline" title="Contato de Emergência" subtitle="Luisa" />
        <MenuItem icon="shield-checkmark-outline" title="Privacidade de Dados" />
      </View>

      {/* Botão de Sair */}
      <TouchableOpacity style={styles.logoutButton}>
        <Ionicons name="log-out-outline" size={20} color={Colors.danger} style={{ marginRight: 8 }} />
        <Text style={styles.logoutText}>Encerrar Sessão</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    alignItems: 'center',
    paddingVertical: 40,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  avatarContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  userName: { fontSize: 22, fontWeight: 'bold', color: Colors.text },
  userRole: { fontSize: 16, color: Colors.gray, marginTop: 4 },
  section: {
    marginTop: 25,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5EA',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Colors.gray,
    textTransform: 'uppercase',
    marginLeft: 20,
    marginTop: 15,
    marginBottom: 5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center' },
  menuIcon: { marginRight: 15 },
  menuTitle: { fontSize: 16, color: Colors.text },
  menuSubtitle: { fontSize: 13, color: Colors.gray, marginTop: 2 },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 35,
    marginBottom: 40,
    paddingVertical: 15,
    backgroundColor: '#FFE5E5',
    marginHorizontal: 20,
    borderRadius: 10,
  },
  logoutText: { color: Colors.danger, fontSize: 16, fontWeight: 'bold' },
});