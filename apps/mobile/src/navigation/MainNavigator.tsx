import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CommonActions,
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { BottomTabBarProps, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import Icon from '../components/Icon';
import SideRail from '../components/SideRail';
import BarraNavegacao, { iniciarNavegacao } from '../components/BarraNavegacao';

import MapScreen from '../screens/MapScreen';
import PlanejarScreen from '../screens/PlanejarScreen';
import TransitoScreen from '../screens/TransitoScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProfileScreen from '../screens/ProfileScreen';
import HistoryScreen from '../screens/HistoryScreen';
import LoginScreen from '../screens/LoginScreen';
import MfaVerificarScreen from '../screens/MfaVerificarScreen';
import SegurancaScreen from '../screens/SegurancaScreen';
import RegisterScreen from '../screens/RegisterScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import PrivacyScreen from '../screens/PrivacyScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();

// Ref global pra navegar/observar state de fora do navigator.
export const navigationRef = createNavigationContainerRef();

const TAB_NAMES = ['Mapa', 'Planejar', 'Trânsito', 'Painel', 'Histórico', 'Perfil'];

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Mapa: { active: 'ion:map', inactive: 'ion:map-outline' },
  Planejar: { active: 'ion:alarm', inactive: 'ion:alarm-outline' },
  'Trânsito': { active: 'ion:speedometer', inactive: 'ion:speedometer-outline' },
  Painel: { active: 'ion:grid', inactive: 'ion:grid-outline' },
  Histórico: { active: 'ion:time', inactive: 'ion:time-outline' },
  Perfil: { active: 'ion:person', inactive: 'ion:person-outline' },
};

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="Privacy" component={PrivacyScreen} />
      <ProfileStack.Screen name="Seguranca" component={SegurancaScreen} />
    </ProfileStack.Navigator>
  );
}

function tabsCommonScreens() {
  return (
    <>
      <Tab.Screen name="Mapa" component={MapScreen} />
      <Tab.Screen name="Planejar" component={PlanejarScreen} />
      <Tab.Screen name="Trânsito" component={TransitoScreen} />
      <Tab.Screen name="Painel" component={DashboardScreen} />
      <Tab.Screen name="Histórico" component={HistoryScreen} />
      <Tab.Screen name="Perfil" component={ProfileStackNavigator} />
    </>
  );
}

/** Depois que o navegador pintar o que já mudou (destaque e barra de progresso): a tela nova monta em seguida. */
function depoisDePintar(acao: () => void) {
  requestAnimationFrame(() => setTimeout(acao, 0));
}

// --------------------------------------------------------------------- MOBILE
/**
 * Barra de abas própria (no lugar da BottomTabBar): o toque acende a aba e a barra de progresso no quadro seguinte, mesmo
 * que a tela nova demore a montar. Cada aba tem pelo menos 44 px de largura e 62 de altura, com a área segura embaixo.
 */
function BarraAbas({ state, navigation }: BottomTabBarProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const atual = state.routes[state.index].name;
  const [pendente, setPendente] = useState<string | null>(null);
  useEffect(() => setPendente(null), [atual]);
  const acesa = pendente ?? atual;

  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: c.surface, borderTopColor: c.border, borderTopWidth: 1, paddingBottom: insets.bottom }}
    >
      {state.routes.map((route) => {
        const ativa = route.name === acesa;
        const icones = TAB_ICONS[route.name] || TAB_ICONS.Mapa;
        const aoTocar = () => {
          const evento = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (route.name === atual || evento.defaultPrevented) return;
          setPendente(route.name);
          iniciarNavegacao();
          depoisDePintar(() => navigation.dispatch({ ...CommonActions.navigate(route), target: state.key }));
        };
        return (
          <Pressable
            key={route.key}
            onPress={aoTocar}
            accessibilityRole="tab"
            accessibilityLabel={route.name}
            aria-selected={ativa}
            style={{ flex: 1, minWidth: 0, minHeight: 62, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <View style={{ width: 44, height: 28, borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: ativa ? c.accentSoft : 'transparent' }}>
              <Icon name={ativa ? icones.active : icones.inactive} size={20} color={ativa ? c.accent : c.textMuted} />
            </View>
            <Text numberOfLines={1} style={{ fontFamily: ativa ? theme.fonts.sansSemi : theme.fonts.sansMedium, fontSize: 11, lineHeight: 14, color: ativa ? c.accent : c.textMuted }}>
              {route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MainTabsMobile() {
  return (
    <Tab.Navigator tabBar={(props: BottomTabBarProps) => <BarraAbas {...props} />} screenOptions={{ headerShown: false }}>
      {tabsCommonScreens()}
    </Tab.Navigator>
  );
}

// -------------------------------------------------------------------- DESKTOP
/**
 * Desktop: layout flex-row manual.
 *  - SideRail à esquerda
 *  - Tab.Navigator (sem tabBar default) à direita
 *
 * tabBarPosition='left' do bottom-tabs v7 não funciona consistentemente
 * em react-native-web — daí o layout manual.
 */
function MainTabsDesktop() {
  const [activeName, setActiveName] = useState<string>('Mapa');

  useEffect(() => {
    const sync = () => {
      if (!navigationRef.isReady()) return;
      const root = navigationRef.getRootState();
      if (!root) return;
      // Root nav = Tab.Navigator quando logado. Tab name está em routes[index].name.
      // Stack aninhada (Perfil) também resolve no nome do tab pai, que é o que
      // SideRail precisa pra highlight.
      const name = root.routes[root.index]?.name;
      if (name) setActiveName(name);
    };
    sync();
    const unsub = navigationRef.addListener('state', sync);
    return unsub;
  }, []);

  const handleSelect = (name: string) => {
    if (!navigationRef.isReady() || name === activeName) return;
    setActiveName(name); // o rail acende já; a tela nova monta depois de pintar
    iniciarNavegacao();
    depoisDePintar(() => navigationRef.navigate(name as never));
  };

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <SideRail
        routes={TAB_NAMES}
        activeName={activeName}
        onSelect={handleSelect}
      />
      <View style={{ flex: 1 }}>
        <Tab.Navigator
          tabBar={() => null}
          screenOptions={{ headerShown: false }}
        >
          {tabsCommonScreens()}
        </Tab.Navigator>
      </View>
    </View>
  );
}

function MainTabs() {
  const desktop = useDesktopLayout();
  return desktop ? <MainTabsDesktop /> : <MainTabsMobile />;
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      {/* Aviso de privacidade acessível antes do login (aceite no cadastro — LGPD). */}
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
    </Stack.Navigator>
  );
}

// Só em desenvolvimento (__DEV__ some do export de produção): ?preview=mapa abre o app sem sessão,
// para inspecionar o mapa sem criar usuário de teste no Supabase de produção.
const PREVIEW_PARAM =
  __DEV__ && typeof window !== 'undefined' && !!window.location
    ? new URLSearchParams(window.location.search).get('preview')
    : null;
const PREVIEW = PREVIEW_PARAM === 'mapa';
const PREVIEW_MFA = PREVIEW_PARAM === 'mfa';

export default function RootNavigator() {
  const { theme, mode } = useTheme();
  const { session, loading, mfaPendente } = useAuth();
  const c = theme.colors;
  const assinarNavegacao = useCallback((ouvinte: () => void) => navigationRef.addListener('state', ouvinte), []);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: c.background,
        }}
      >
        <ActivityIndicator color={c.accent} size="large" />
      </View>
    );
  }

  const navTheme = {
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      background: c.background,
      card: c.surface,
      text: c.text,
      border: c.border,
      primary: c.accent,
    },
  };

  // documentTitle desligado: o React Navigation trocaria o <title> da página pelo nome da tela ("Login", "Mapa"), e o
  // app não tem URL por tela. O título fica o do public/index.html (SEO).
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} documentTitle={{ enabled: false }}>
      {PREVIEW_MFA || (session && mfaPendente) ? <MfaVerificarScreen /> : session || PREVIEW ? <MainTabs /> : <AuthStack />}
      <BarraNavegacao assinar={assinarNavegacao} />
    </NavigationContainer>
  );
}
