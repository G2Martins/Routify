import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';

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

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="Privacy" component={PrivacyScreen} />
    </ProfileStack.Navigator>
  );
}

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Mapa: { active: 'ion:map', inactive: 'ion:map-outline' },
  Painel: { active: 'ion:home', inactive: 'ion:home-outline' },
  Histórico: { active: 'ion:time-outline', inactive: 'ion:time-outline' },
  Perfil: { active: 'ion:person', inactive: 'ion:person-outline' },
};

function MainTabs() {
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
              color={focused ? c.text : c.textSubtle}
            />
          );
        },
        tabBarActiveTintColor: c.text,
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
      <Tab.Screen name="Mapa" component={MapScreen} />
      <Tab.Screen name="Painel" component={DashboardScreen} />
      <Tab.Screen name="Histórico" component={HistoryScreen} />
      <Tab.Screen name="Perfil" component={ProfileStackNavigator} />
    </Tab.Navigator>
  );
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
    <NavigationContainer theme={navTheme}>
      {session ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}
