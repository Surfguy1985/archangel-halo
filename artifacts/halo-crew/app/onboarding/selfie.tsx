import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useSetPortalSelfie } from '@workspace/api-client-react';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

async function uploadToStorage(uri: string): Promise<string> {
  // Compress
  const compressed = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 600 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  const base64 = compressed.base64 ?? '';

  // Get presigned URL
  const urlResp = await fetch(`https://${DOMAIN}/api/storage/uploads/request-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `selfie-${Date.now()}.jpg`, contentType: 'image/jpeg' }),
  });
  if (!urlResp.ok) throw new Error('Failed to get upload URL');
  const { uploadUrl, storagePath } = await urlResp.json();

  // Upload
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: binary,
  });
  if (!uploadResp.ok) throw new Error('Upload failed');

  return storagePath as string;
}

export default function SelfieScreen() {
  const insets = useSafeAreaInsets();
  const { token, invalidate } = useAuth();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { mutateAsync: setSelfie } = useSetPortalSelfie();

  const pickPhoto = async () => {
    setError('');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      cameraType: ImagePicker.CameraType.front,
    });
    if (!result.canceled && result.assets[0]) {
      setUri(result.assets[0].uri);
    }
  };

  const pickFromLibrary = async () => {
    setError('');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      setUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!uri || !token || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setError('');
    try {
      const storagePath = await uploadToStorage(uri);
      await setSelfie({ token, data: { storagePath } });
      invalidate();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError('Upload failed — try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const skip = () => {
    router.replace('/(tabs)');
  };

  return (
    <LinearGradient colors={['#07101E', '#0D1C31', '#07101E']} style={{ flex: 1 }}>
      <View style={[s.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.badgeRow}>
            <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
            <Text style={s.badgeText}>Agreement accepted</Text>
          </View>
          <Text style={s.title}>Add your photo</Text>
          <Text style={s.subtitle}>
            A selfie helps your office identify you and makes your profile personal.
            {'\n'}You can skip this and add it later.
          </Text>
        </View>

        {/* Avatar area */}
        <Pressable
          style={({ pressed }) => [s.avatarArea, pressed && { opacity: 0.85 }]}
          onPress={pickPhoto}
        >
          {uri ? (
            <Image source={{ uri }} style={s.avatar} />
          ) : (
            <View style={s.avatarPlaceholder}>
              <Ionicons name="person" size={56} color="#435A7D" />
            </View>
          )}
          <View style={s.cameraBtn}>
            <Ionicons name="camera" size={18} color="#07101E" />
          </View>
        </Pressable>

        {/* Options */}
        <View style={s.options}>
          <Pressable
            style={({ pressed }) => [s.optBtn, pressed && { opacity: 0.7 }]}
            onPress={pickPhoto}
          >
            <Ionicons name="camera-outline" size={20} color="#B4FF44" />
            <Text style={s.optText}>Take selfie</Text>
          </Pressable>
          <View style={s.optDivider} />
          <Pressable
            style={({ pressed }) => [s.optBtn, pressed && { opacity: 0.7 }]}
            onPress={pickFromLibrary}
          >
            <Ionicons name="image-outline" size={20} color="#8CA0B9" />
            <Text style={[s.optText, { color: '#8CA0B9' }]}>Choose from library</Text>
          </Pressable>
        </View>

        {!!error && (
          <Text style={s.errorText}>{error}</Text>
        )}

        <View style={s.spacer} />

        {/* CTA */}
        {uri ? (
          <Pressable
            style={({ pressed }) => [s.btn, pressed && s.pressed]}
            onPress={handleSave}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#07101E" />
            ) : (
              <>
                <Ionicons name="checkmark" size={20} color="#07101E" />
                <Text style={s.btnText}>Save photo & continue</Text>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [s.skipBtn, pressed && { opacity: 0.6 }]}
            onPress={skip}
          >
            <Text style={s.skipText}>Skip for now</Text>
            <Ionicons name="arrow-forward" size={16} color="#435A7D" />
          </Pressable>
        )}
        {uri && (
          <Pressable style={s.skipBtnSmall} onPress={skip}>
            <Text style={s.skipTextSmall}>Skip — I'll add a photo later</Text>
          </Pressable>
        )}
      </View>
    </LinearGradient>
  );
}

const AVATAR_SIZE = 140;

const s = StyleSheet.create({
  content: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 36 },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.25)',
  },
  badgeText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#22C55E' },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#F4F7F9', marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', color: '#8CA0B9', textAlign: 'center', lineHeight: 23 },
  avatarArea: { position: 'relative', marginBottom: 28 },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: '#B4FF44',
  },
  avatarPlaceholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: '#13223A',
    borderWidth: 2,
    borderColor: 'rgba(140,160,185,0.20)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#B4FF44',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#07101E',
  },
  options: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#13223A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    overflow: 'hidden',
    width: '100%',
  },
  optBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  optText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#B4FF44' },
  optDivider: { width: 1, height: 30, backgroundColor: 'rgba(140,160,185,0.15)' },
  errorText: { fontSize: 13, color: '#E11D48', fontFamily: 'Inter_400Regular', marginTop: 12 },
  spacer: { flex: 1 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B4FF44',
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
    width: '100%',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#07101E' },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  skipText: { fontSize: 16, fontFamily: 'Inter_400Regular', color: '#435A7D' },
  skipBtnSmall: { marginTop: 14, paddingVertical: 8 },
  skipTextSmall: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#435A7D' },
});
