import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs, router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

function AuthGuard() {
  const { isLoading, isAuthenticated, portal } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/link');
      return;
    }
    // New crew: send to onboarding if they haven't accepted the agreement yet
    if (portal && !portal.crew?.agreementAcceptedAt) {
      router.replace('/onboarding');
    }
  }, [isLoading, isAuthenticated, portal]);

  return null;
}

export default function TabLayout() {
  const colors = useColors();

  return (
    <>
      <AuthGuard />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.lime,
          tabBarInactiveTintColor: colors.faint,
          headerShown: false,
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: Platform.OS === 'ios' ? 'transparent' : '#07101E',
            borderTopWidth: 1,
            borderTopColor: 'rgba(140,160,185,0.12)',
            elevation: 0,
            height: Platform.OS === 'web' ? 84 : 80,
          },
          tabBarBackground: () =>
            Platform.OS === 'ios' ? (
              <BlurView
                intensity={90}
                tint="dark"
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: '#07101E' }]}
              />
            ),
          tabBarLabelStyle: {
            fontSize: 11,
            fontFamily: 'Inter_600SemiBold',
            marginBottom: Platform.OS === 'ios' ? 0 : 4,
          },
          tabBarIconStyle: {
            marginTop: Platform.OS === 'ios' ? 0 : 4,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Today',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="today-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="camera"
          options={{
            title: 'Camera',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="camera-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="grid-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
