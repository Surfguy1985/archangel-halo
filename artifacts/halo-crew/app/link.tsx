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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

function extractToken(input: string): string | null {
  const trimmed = input.trim();
  // Check if it's a URL containing /portal/TOKEN
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split('/').filter(Boolean);
    const portalIdx = parts.indexOf('portal');
    if (portalIdx >= 0 && parts[portalIdx + 1]) {
      return parts[portalIdx + 1];
    }
    // Check query param
    const token = url.searchParams.get('token');
    if (token) return token;
  } catch {
    // Not a URL — treat as raw token
    if (/^[a-zA-Z0-9_-]{8,}$/.test(trimmed)) return trimmed;
  }
  return null;
}

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

async function validateToken(token: string): Promise<{ ok: boolean; status: number }> {
  try {
    const resp = await fetch(`https://${DOMAIN}/api/portal/${token}`);
    return { ok: resp.ok, status: resp.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export default function LinkScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { setToken } = useAuth();

  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setError('');
    const token = extractToken(input);
    if (!token) {
      setError('Paste the full crew link your office sent you.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    try {
      // Validate the token against the server BEFORE storing it
      const { ok, status } = await validateToken(token);
      if (!ok) {
        const msg =
          status === 404
            ? "That link isn't valid. Ask your office to send a fresh crew link."
            : status === 0
            ? 'No connection — check your internet and try again.'
            : 'Could not connect — check your link and try again.';
        setError(msg);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      await setToken(token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch {
      setError('Could not connect — check your connection and try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const s = styles(colors);

  return (
    <LinearGradient
      colors={['#07101E', '#13223A', '#07101E']}
      style={s.bg}
    >
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
            <Text style={s.cardTitle}>Connect your account</Text>
            <Text style={s.cardBody}>
              Paste the crew link your office sent you — it looks like a web
              address.
            </Text>

            <View style={[s.inputWrapper, error ? s.inputError : null]}>
              <Ionicons name="link-outline" size={18} color="#8CA0B9" style={s.inputIcon} />
              <TextInput
                style={s.input}
                placeholder="https://… or paste token"
                placeholderTextColor="#435A7D"
                value={input}
                onChangeText={(t) => {
                  setInput(t);
                  setError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleConnect}
              />
              {input.length > 0 && (
                <Pressable onPress={() => setInput('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color="#435A7D" />
                </Pressable>
              )}
            </View>

            {!!error && <Text style={s.errorText}>{error}</Text>}

            <Pressable
              style={({ pressed }) => [s.btn, pressed && s.btnPressed, loading && s.btnDisabled]}
              onPress={handleConnect}
              disabled={loading}
            >
              <Text style={s.btnText}>
                {loading ? 'Connecting…' : 'Connect'}
              </Text>
              {!loading && <Ionicons name="arrow-forward" size={18} color="#07101E" />}
            </Pressable>
          </View>

          {/* Help */}
          <View style={s.help}>
            <Ionicons name="information-circle-outline" size={16} color="#435A7D" />
            <Text style={s.helpText}>
              Don't have a link? Ask your office manager to send you your crew
              portal link.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = (colors: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    bg: { flex: 1, backgroundColor: '#07101E' },
    scroll: { flexGrow: 1, paddingHorizontal: 24, alignItems: 'center' },
    logoArea: { alignItems: 'center', marginBottom: 40 },
    logoCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: 'rgba(180,255,68,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'rgba(180,255,68,0.25)',
      marginBottom: 16,
    },
    logoTitle: {
      fontSize: 28,
      fontWeight: '800' as const,
      color: '#F4F7F9',
      letterSpacing: 4,
      fontFamily: 'Inter_700Bold',
    },
    logoSub: {
      fontSize: 13,
      color: '#8CA0B9',
      marginTop: 4,
      fontFamily: 'Inter_400Regular',
      letterSpacing: 1,
    },
    card: {
      width: '100%',
      backgroundColor: '#13223A',
      borderRadius: 20,
      padding: 24,
      borderWidth: 1,
      borderColor: 'rgba(140,160,185,0.14)',
      marginBottom: 24,
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '700' as const,
      color: '#F4F7F9',
      marginBottom: 8,
      fontFamily: 'Inter_700Bold',
    },
    cardBody: {
      fontSize: 14,
      color: '#8CA0B9',
      marginBottom: 20,
      lineHeight: 21,
      fontFamily: 'Inter_400Regular',
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(140,160,185,0.10)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(140,160,185,0.18)',
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 12,
      gap: 10,
    },
    inputError: {
      borderColor: 'rgba(225,29,72,0.5)',
    },
    inputIcon: { flexShrink: 0 },
    input: {
      flex: 1,
      fontSize: 14,
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
    },
    btnPressed: { opacity: 0.8 },
    btnDisabled: { opacity: 0.5 },
    btnText: {
      fontSize: 16,
      fontWeight: '700' as const,
      color: '#07101E',
      fontFamily: 'Inter_700Bold',
    },
    help: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 4,
      alignItems: 'flex-start',
    },
    helpText: {
      flex: 1,
      fontSize: 13,
      color: '#435A7D',
      lineHeight: 19,
      fontFamily: 'Inter_400Regular',
    },
  });
