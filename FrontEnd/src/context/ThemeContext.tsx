import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildTheme, MapStyle, Theme, ThemeMode } from '../constants/Theme';

type ThemePreference = 'light' | 'dark' | 'auto';

interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
  mapStyle: MapStyle;
  setMapStyle: (style: MapStyle) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY_THEME = '@routify:theme';
const STORAGE_KEY_MAP = '@routify:mapStyle';

const storageGet = async (key: string): Promise<string | null> => {
  try {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
};

const storageSet = async (key: string, value: string) => {
  try {
    if (Platform.OS === 'web') localStorage.setItem(key, value);
    else await AsyncStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemMode: ThemeMode =
    (Appearance.getColorScheme() as ThemeMode) || 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('auto');
  const [systemColorScheme, setSystemColorScheme] = useState<ThemeMode>(systemMode);
  const [mapStyle, setMapStyleState] = useState<MapStyle>('dark');

  // Carrega preferências persistidas
  useEffect(() => {
    (async () => {
      const t = (await storageGet(STORAGE_KEY_THEME)) as ThemePreference | null;
      const m = (await storageGet(STORAGE_KEY_MAP)) as MapStyle | null;
      if (t) setPreferenceState(t);
      if (m) setMapStyleState(m);
    })();
  }, []);

  // Acompanha mudanças do sistema
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemColorScheme((colorScheme as ThemeMode) || 'light');
    });
    return () => sub.remove();
  }, []);

  const mode: ThemeMode = preference === 'auto' ? systemColorScheme : preference;

  const setPreference = (pref: ThemePreference) => {
    setPreferenceState(pref);
    storageSet(STORAGE_KEY_THEME, pref);
  };

  const setMapStyle = (style: MapStyle) => {
    setMapStyleState(style);
    storageSet(STORAGE_KEY_MAP, style);
  };

  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setPreference(next);
  };

  const value: ThemeContextValue = useMemo(
    () => ({
      theme: buildTheme(mode),
      mode,
      preference,
      setPreference,
      toggle,
      mapStyle,
      setMapStyle,
    }),
    [mode, preference, mapStyle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve ser usado dentro de ThemeProvider');
  return ctx;
}
