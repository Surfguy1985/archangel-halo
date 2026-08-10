import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import { useAcceptPortalAgreement } from '@workspace/api-client-react';

const AGREEMENT_TEXT = `
HALO CREW PORTAL — FIELD OPERATIONS AGREEMENT

By accepting this agreement you confirm that:

1. ACCURATE REPORTING
You will record your check-in and check-out times honestly and only when you are physically at the job site. Falsifying time records is grounds for immediate removal from the platform.

2. GPS & LOCATION
You consent to your GPS location being recorded while you are checked in to a job. Location data is used solely to verify site attendance and resolve disputes. Tracking stops automatically when you check out.

3. PHOTO DOCUMENTATION
You will take before and after photos for every job. These photos protect you, the property owner, and the company. Do not alter or delete job photos.

4. PROFESSIONAL CONDUCT
You represent HALO ArchAngel Operations at all times while on a job site. Treat all properties and their occupants with respect.

5. PAY & INVOICING
Your pay is calculated from the crew invoice you submit. Invoices must reflect actual work completed. Submitting invoices for work not performed is fraud.

6. CONFIDENTIALITY
Job site information, client details, and pay data are confidential. Do not share this information with anyone outside your crew.

7. EQUIPMENT & PROPERTY
Any damage caused by negligence is your responsibility. Report all pre-existing damage in your before photos.

By tapping "I Agree" below, you acknowledge that you have read, understood, and agree to operate under these terms for every job you complete through the HALO Crew platform.
`.trim();

export default function AgreementScreen() {
  const insets = useSafeAreaInsets();
  const { token, invalidate } = useAuth();
  const [loading, setLoading] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const { mutateAsync: acceptAgreement } = useAcceptPortalAgreement();

  const handleAgree = async () => {
    if (!token || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      await acceptAgreement({ token });
      invalidate(); // refresh portal bundle so agreementAcceptedAt is populated
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(tabs)');
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleScroll = (e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const isBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
    if (isBottom) setScrolledToBottom(true);
  };

  return (
    <LinearGradient colors={['#07101E', '#0D1C31', '#07101E']} style={{ flex: 1 }}>
      {/* Header */}
      <View style={[hdrStyles.row, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [hdrStyles.back, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={24} color="#8CA0B9" />
        </Pressable>
        <Text style={hdrStyles.title}>Field Agreement</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Agreement text */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          agStyles.scroll,
          { paddingTop: 20, paddingBottom: 24 },
        ]}
        onScroll={handleScroll}
        scrollEventThrottle={100}
      >
        <View style={agStyles.card}>
          <View style={agStyles.iconRow}>
            <Ionicons name="document-text" size={28} color="#B4FF44" />
          </View>
          <Text style={agStyles.body}>{AGREEMENT_TEXT}</Text>
        </View>

        {!scrolledToBottom && (
          <View style={agStyles.scrollHint}>
            <Ionicons name="chevron-down" size={16} color="#435A7D" />
            <Text style={agStyles.scrollHintText}>Scroll to read all</Text>
          </View>
        )}
      </ScrollView>

      {/* CTA */}
      <View style={[ctaStyles.area, { paddingBottom: insets.bottom + 24 }]}>
        {!scrolledToBottom && (
          <Text style={ctaStyles.readFirst}>
            Please scroll to read the full agreement
          </Text>
        )}
        <Pressable
          style={({ pressed }) => [
            ctaStyles.btn,
            !scrolledToBottom && ctaStyles.btnDisabled,
            pressed && scrolledToBottom && ctaStyles.pressed,
          ]}
          onPress={handleAgree}
          disabled={!scrolledToBottom || loading}
        >
          {loading ? (
            <ActivityIndicator color="#07101E" />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={22} color="#07101E" />
              <Text style={ctaStyles.btnText}>I Agree — Continue</Text>
            </>
          )}
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const hdrStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  back: { width: 36, alignItems: 'flex-start' },
  title: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    textAlign: 'center',
  },
});

const agStyles = StyleSheet.create({
  scroll: { paddingHorizontal: 16 },
  card: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
  },
  iconRow: { alignItems: 'center', marginBottom: 20 },
  body: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#C5D4E3',
    lineHeight: 24,

  },
  scrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  scrollHintText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
});

const ctaStyles = StyleSheet.create({
  area: { paddingHorizontal: 16, paddingTop: 12 },
  readFirst: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
    textAlign: 'center',
    marginBottom: 10,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B4FF44',
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
  },
  btnDisabled: { backgroundColor: 'rgba(180,255,68,0.25)' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  btnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#07101E' },
});
