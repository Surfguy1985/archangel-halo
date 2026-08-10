import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

async function loginWithPassword(
  password: string,
): Promise<{ token: string } | { error: string }> {
  try {
    const resp = await fetch(`https://${DOMAIN}/api/portal/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const json = await resp.json();
    if (!resp.ok) return { error: json.error ?? 'Something went wrong.' };
    return { token: json.token };
  } catch {
    return { error: 'No connection — check your internet and try again.' };
  }
}

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setToken } = useAuth();

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSignIn = async () => {
    setError('');
    const trimmed = password.trim();
    if (!trimmed) {
      setError('Enter your password to continue.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    try {
      const result = await loginWithPassword(trimmed);
      if ('error' in result) {
        setError(result.error);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      await setToken(result.token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

  const s = styles(colors);

  return (
    <LinearGradient colors={['#07101E', '#13223A', '#07101E']} style={s.bg}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            s.scroll,
            { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo */}
          <View style={s.logoArea}>
            <View style={s.logoCircle}>
              <Ionicons name="shield-checkmark" size={40} color="#B4FF44" />
            </View>
            <Text style={s.logoTitle}>HALO CREW</Text>
            <Text style={s.logoSub}>ArchAngel Field Operations</Text>
          </View>

          {/* Card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Sign In</Text>
            <Text style={s.cardSub}>
              Enter your crew password to access the app.
            </Text>

            {/* Password input */}
            <View style={[s.inputRow, error ? s.inputError : null]}>
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color="#435A7D"
                style={s.inputIcon}
              />
              <TextInput
                style={s.input}
                placeholder="Your password"
                placeholderTextColor="#435A7D"
                value={password}
                onChangeText={(v) => { setPassword(v); setError(''); }}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
              <Pressable onPress={() => setShowPassword(v => !v)} hitSlop={10}>
                <Ionicons
                  name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  size={18}
                  color="#435A7D"
                />
              </Pressable>
            </View>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            {/* Sign in button */}
            <Pressable
              onPress={handleSignIn}
              disabled={loading}
              style={({ pressed }) => [s.btn, pressed && s.btnPressed, loading && s.btnDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#07101E" />
              ) : (
                <>
                  <Ionicons name="arrow-forward-circle" size={20} color="#07101E" />
                  <Text style={s.btnText}>Sign In</Text>
                </>
              )}
            </Pressable>

            {/* Hint */}
            <View style={s.hint}>
              <Ionicons name="information-circle-outline" size={16} color="#435A7D" />
              <Text style={s.hintText}>
                Your password is your first name followed by{' '}
                <Text style={s.hintBold}>2026</Text>
                {' '}(e.g. Kevin2026).
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    bg: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoArea: { alignItems: 'center', marginBottom: 40 },
    logoCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(180,255,68,0.12)',
      borderWidth: 1,
      borderColor: 'rgba(180,255,68,0.3)',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    logoTitle: {
      fontSize: 26,
      fontWeight: '800',
      color: '#F4F7F9',
      letterSpacing: 3,
      fontFamily: 'Inter_700Bold',
    },
    logoSub: {
      fontSize: 12,
      color: '#435A7D',
      letterSpacing: 2,
      marginTop: 4,
      fontFamily: 'Inter_400Regular',
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: 'rgba(19,34,58,0.9)',
      borderRadius: 20,
      borderWidth: 1,
      borderColor: 'rgba(140,160,185,0.14)',
      padding: 28,
    },
    cardTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: '#F4F7F9',
      marginBottom: 8,
      fontFamily: 'Inter_700Bold',
    },
    cardSub: {
      fontSize: 14,
      color: '#8CA0B9',
      marginBottom: 24,
      lineHeight: 20,
      fontFamily: 'Inter_400Regular',
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: 'rgba(255,255,255,0.04)',
      borderWidth: 1,
      borderColor: 'rgba(140,160,185,0.2)',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
      marginBottom: 12,
    },
    inputError: { borderColor: 'rgba(225,29,72,0.5)' },
    inputIcon: { flexShrink: 0 },
    input: {
      flex: 1,
      fontSize: 16,
      color: '#F4F7F9',
      fontFamily: 'Inter_400Regular',
    },
    errorText: {
      fontSize: 13,
      color: '#E11D48',
      marginBottom: 12,
      fontFamily: 'Inter_400Regular',
    },
    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#B4FF44',
      borderRadius: 12,
      paddingVertical: 15,
      gap: 8,
      marginTop: 4,
      marginBottom: 20,
    },
    btnPressed: { opacity: 0.8 },
    btnDisabled: { opacity: 0.5 },
    btnText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#07101E',
      fontFamily: 'Inter_700Bold',
    },
    hint: {
      flexDirection: 'row',
      gap: 8,
      alignItems: 'flex-start',
    },
    hintText: {
      flex: 1,
      fontSize: 13,
      color: '#435A7D',
      lineHeight: 19,
      fontFamily: 'Inter_400Regular',
    },
    hintBold: {
      fontFamily: 'Inter_600SemiBold',
      color: '#8CA0B9',
    },
  });
