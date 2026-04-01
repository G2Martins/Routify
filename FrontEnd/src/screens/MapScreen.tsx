import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';

// @ts-ignore
import MapComponent from '../components/MapComponent';

export default function MapScreen() {
  const [origem, setOrigem] = useState('');
  const [destino, setDestino] = useState('');
  const mapRef = useRef<any>(null);

  // EFEITO MÁGICO: Executa assim que a tela abre
  useEffect(() => {
    // Dá 1 segundo para o mapa renderizar, pede permissão e centraliza
    const timer = setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.centerOnUser();
      }
    }, 1000);
    
    return () => clearTimeout(timer);
  }, []);

  const handleCenterLocation = () => {
    mapRef.current?.centerOnUser();
  };

  const webInputStyle = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {};

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <MapComponent ref={mapRef} />

      <View style={styles.searchContainer}>
        <View style={styles.inputWrapper}>
          <Ionicons name="location-outline" size={20} color={Colors.primary} style={styles.icon} />
          <TextInput
            style={[styles.input, webInputStyle]}
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
            style={[styles.input, webInputStyle]}
            placeholder="Destino Final"
            value={destino}
            onChangeText={setDestino}
            placeholderTextColor={Colors.gray}
          />
        </View>
      </View>
      
      {/* Botão de Centralizar Localização Manual */}
      <TouchableOpacity style={styles.locationButton} onPress={handleCenterLocation}>
        <Ionicons name="locate" size={25} color={Colors.primary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.fab} onPress={() => alert('Otimizando...')}>
        <Ionicons name="navigate" size={20} color={Colors.white} style={{ marginRight: 8 }} />
        <Text style={styles.fabText}>Otimizar Rota</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchContainer: {
    position: 'absolute', top: 50, left: 20, right: 20,
    backgroundColor: Colors.white, borderRadius: 12, padding: 10,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 5, zIndex: 1,
  },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  icon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: Colors.text },
  divider: { height: 1, backgroundColor: '#E5E5EA', marginVertical: 4, marginLeft: 30 },
  locationButton: {
    position: 'absolute', bottom: 100, right: 20,
    backgroundColor: Colors.white, width: 50, height: 50, borderRadius: 25,
    justifyContent: 'center', alignItems: 'center',
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 3.84, zIndex: 1,
  },
  fab: {
    position: 'absolute', bottom: 30, right: 20,
    backgroundColor: Colors.primary, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 15, paddingHorizontal: 25, borderRadius: 30,
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 3.84, zIndex: 1,
  },
  fabText: { color: Colors.white, fontWeight: 'bold', fontSize: 16 },
});