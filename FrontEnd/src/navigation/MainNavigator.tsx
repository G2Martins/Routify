import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDesktopLayout } from '../lib/responsive';
import Icon from '../components/Icon';
import SideRail from '../components/SideRail';

import MapScreen from '../screens/MapScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProfileScreen from '../screens/ProfileScreen';
import HistoryScreen from '../screens/HistoryScreen';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import PrivacyScreen from '../screens/PrivacyScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const ProfileStack = createNativeStackNavigator();

// Ref global pra navegar/observar state de fora do navigator.
export const navigationRef = createNavigationContainerRef();

const TAB_NAMES = ['Mapa', 'Painel', 'Histórico', 'Perfil'];

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Mapa: { active: 'ion:map', inactive: 'ion:map-outline' },
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
    </ProfileStack.Navigator>
  );
}

function tabsCommonScreens() {
  return (
    <>
      <Tab.Screen name="Mapa" component={MapScreen} />
      <Tab.Screen name="Painel" component={DashboardScreen} />
      <Tab.Screen name="Histórico" component={HistoryScreen} />
      <Tab.Screen name="Perfil" component={ProfileStackNavigator} />
    </>
  );
}

// --------------------------------------------------------------------- MOBILE
function MainTabsMobile() {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Tab.Navigator
      screenOptions={({ route }: { route: { name: string } }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, size }: { focused: boolean; size: number }) => {
          const map = TAB_ICONS[route.name] || TAB_ICONS.Mapa;
          return (
            <Icon
              name={focused ? map.active : map.inactive}
              size={size}
              color={focused ? c.accent : c.textSubtle}
            />
          );
        },
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textSubtle,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.surfaceMuted,
          borderTopWidth: 1,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
      })}
    >
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
    if (!navigationRef.isReady()) return;
    const sync = () => {
      const root = navigationRef.getRootState();
      if (!root) return;
      const tabState = root.routes[root.index]?.state;
      if (tabState && typeof tabState.index === 'number') {
        const name = tabState.routes[tabState.index]?.name;
        if (name) setActiveName(name);
      }
    };
    sync();
    const unsub = navigationRef.addListener('state', sync);
    return unsub;
  }, []);

  const handleSelect = (name: string) => {
    if (navigationRef.isReady()) {
      navigationRef.navigate(name as never);
    }
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
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { theme, mode } = useTheme();
  const { session, loading } = useAuth();
  const c = theme.colors;

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
        <ActivityIndicator color={c.text} size="large" />
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
      border: c.surfaceMuted,
      primary: c.text,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      {session ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
