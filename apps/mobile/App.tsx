import React from 'react';
import { Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
    html, body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; touch-action: manipulation; }
    :focus { outline: none; }
    :focus-visible { outline: 2px solid rgba(2,107,248,.55); outline-offset: 2px; border-radius: 8px; }
    ::selection { background: rgba(2,107,248,.22); }
    * { scrollbar-width: thin; scrollbar-color: rgba(127,140,165,.35) transparent; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-delay: 0s !important; transition-duration: .01ms !important; }
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
  // Subconjunto latino das fontes do @expo-google-fonts (566 KB → 202 KB; o app espera por elas no boot). Refazer:
  // python -m fontTools.subset <ttf> --unicodes="U+0000-017F,U+0192,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0308,
  //   U+2000-206F,U+2070-209F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+2264-2265,U+FEFF,U+FFFD" --no-hinting --desubroutinize
  const [fontesProntas, erroFontes] = useFonts({
    Geist_400Regular: require('./assets/fontes/Geist_400Regular.ttf'),
    Geist_500Medium: require('./assets/fontes/Geist_500Medium.ttf'),
    Geist_600SemiBold: require('./assets/fontes/Geist_600SemiBold.ttf'),
    Geist_700Bold: require('./assets/fontes/Geist_700Bold.ttf'),
    GeistMono_500Medium: require('./assets/fontes/GeistMono_500Medium.ttf'),
    GeistMono_700Bold: require('./assets/fontes/GeistMono_700Bold.ttf'),
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
