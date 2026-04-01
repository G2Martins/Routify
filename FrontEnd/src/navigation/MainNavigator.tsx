// src/navigation/MainNavigator.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons'; // Expo já traz os Ionicons!

// Importando as telas
import MapScreen from '../screens/MapScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProfileScreen from '../screens/ProfileScreen'; // Crie um mock simples
import { Colors } from '../constants/Colors';

const Tab = createBottomTabNavigator();

export default function MainNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap;

          if (route.name === 'Mapa') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Métricas') {
            iconName = focused ? 'pie-chart' : 'pie-chart-outline'; // O ícone que você solicitou!
          } else if (route.name === 'Perfil') {
            iconName = focused ? 'person' : 'person-outline';
          } else {
            iconName = 'alert-circle-outline'; // Default para erros
          }

          // Retorna o componente de ícone do Ionicons
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.gray,
        headerShown: true, // Mostra o título da tela no topo
        headerStyle: { backgroundColor: Colors.white },
        headerTintColor: Colors.text,
      })}
    >
      <Tab.Screen name="Mapa" component={MapScreen} options={{ title: 'Routify - Brasília' }} />
      <Tab.Screen name="Métricas" component={DashboardScreen} options={{ title: 'Estatísticas' }} />
      <Tab.Screen name="Perfil" component={ProfileScreen} options={{ title: 'Minha Conta' }} />
    </Tab.Navigator>
  );
}