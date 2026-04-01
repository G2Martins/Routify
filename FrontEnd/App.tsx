// App.tsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import MainNavigator from './src/navigation/MainNavigator';
import { StatusBar } from 'expo-status-bar';

export default function App() {
  return (
    // NavigationContainer gerencia todo o estado de navegação
    <NavigationContainer>
      <StatusBar style="auto" />
      <MainNavigator />
    </NavigationContainer>
  );
}