import React from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Geist_400Regular } from '@expo-google-fonts/geist/400Regular';
import { Geist_500Medium } from '@expo-google-fonts/geist/500Medium';
import { Geist_600SemiBold } from '@expo-google-fonts/geist/600SemiBold';
import { Geist_700Bold } from '@expo-google-fonts/geist/700Bold';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono/500Medium';
import { GeistMono_700Bold } from '@expo-google-fonts/geist-mono/700Bold';
import { Kalam_700Bold } from '@expo-google-fonts/kalam/700Bold';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/MainNavigator';
import AvisoApp from './src/components/AvisoApp';
import { ToastProvider } from './src/components/Toast';

// CSS global só da web: suavização de fonte, anel de foco visível por teclado,
// scrollbar discreta e respeito a prefers-reduced-motion.
function injetarCssWeb() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('routify-css')) return;
  const style = document.createElement('style');
  style.id = 'routify-css';
  style.textContent = `
    html, body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
    :focus { outline: none; }
    :focus-visible { outline: 2px solid rgba(2,107,248,.55); outline-offset: 2px; border-radius: 8px; }
    ::selection { background: rgba(2,107,248,.22); }
    * { scrollbar-width: thin; scrollbar-color: rgba(127,140,165,.35) transparent; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
  `;
  document.head.appendChild(style);
}
injetarCssWeb();

function ThemedStatusBar() {
  const { mode } = useTheme();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}

export default function App() {
  const [fontesProntas, erroFontes] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_500Medium,
    GeistMono_700Bold,
    Kalam_700Bold,
  });

  // Sem as fontes o layout "pula" ao trocar; com erro, segue com a do sistema.
  if (!fontesProntas && !erroFontes) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <ThemedStatusBar />
            <RootNavigator />
            <AvisoApp />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
