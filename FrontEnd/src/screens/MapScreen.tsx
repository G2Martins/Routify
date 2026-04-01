import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';

const BRASILIA_REGION = {
  latitude: -15.793889,
  longitude: -47.882778,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

export default function MapScreen() {
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');

  const handleTraceRoute = () => {
    if (!origem || !destino) {
      alert("Por favor, preencha a origem e o destino.");
      return;
    }
    console.log(`Traçando rota de ${origem} para ${destino}...`);
    alert(`Calculando rota: ${origem} ➔ ${destino}`);
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <MapView
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={BRASILIA_REGION}
        showsUserLocation={true}
      />

      {/* Card Flutuante de Pesquisa */}
      <View style={styles.searchContainer}>
        <View style={styles.inputWrapper}>
          <Ionicons name="location-outline" size={20} color={Colors.primary} style={styles.icon} />
          <TextInput
            style={styles.input}
            placeholder="Ponto de Origem"
            value={origem}
            onChangeText={setOrigem}
            placeholderTextColor={Colors.gray}
          />
        </View>
        
        <View style={styles.divider} />

        <View style={styles.inputWrapper}>
          <Ionicons name="flag-outline" size={20} color={Colors.danger} style={styles.icon} />
          <TextInput
            style={styles.input}
            placeholder="Destino Final"
            value={destino}
            onChangeText={setDestino}
            placeholderTextColor={Colors.gray}
          />
        </View>
      </View>
      
      {/* Botão Flutuante de Ação (FAB) */}
      <TouchableOpacity style={styles.fab} onPress={handleTraceRoute}>
        <Ionicons name="navigate" size={20} color={Colors.white} style={{ marginRight: 8 }} />
        <Text style={styles.fabText}>Otimizar Rota</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  searchContainer: {
    position: 'absolute',
    top: 50, // Afasta do topo (Notch do celular)
    left: 20,
    right: 20,
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 10,
    elevation: 8, // Sombra Android
    shadowColor: '#000', // Sombra iOS
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  icon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 16,
    color: Colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 4,
    marginLeft: 30, // Alinha o divisor com o texto, pulando o ícone
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 25,
    borderRadius: 30,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  fabText: { color: Colors.white, fontWeight: 'bold', fontSize: 16 },
});