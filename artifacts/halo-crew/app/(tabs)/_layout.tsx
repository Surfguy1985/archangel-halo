import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs, router } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { instructionsAcked } from '@/constants/crewInstructions';

function AuthGuard() {
  const { isLoading, isAuthenticated, portal } = useAuth();
  const sentToOnboarding = useRef(false);
  const sentToInstructions = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      sentToOnboarding.current = false;
      sentToInstructions.current = false;
      router.replace('/link');
      return;
    }

    // The umbrella instructions gate comes first and shows on every fresh
    // launch, not once per crew — the same rule as the web crew links. The
    // field agreement stays where it is, right behind it.
    if (!sentToInstructions.current && portal && !instructionsAcked()) {
      sentToInstructions.current = true;
      router.replace('/onboarding/instructions');
      return;
    }

    if (!sentToOnboarding.current && portal && !portal.crew?.agreementAcceptedAt) {
      sentToOnboarding.current = true;
      router.replace('/onboarding');
    }
  }, [isLoading, isAuthenticated, portal]);

  return null;
}

export default function TabLayout() {
  const colors = useColors();
  usePushNotifications();

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
              <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#07101E' }]} />
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
            title: 'Job',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="location-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="camera"
          options={{
            title: 'Photos',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="images-outline" size={size} color={color} />
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
