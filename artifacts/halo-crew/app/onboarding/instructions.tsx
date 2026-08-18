import React, { useCallback, useEffect, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/context/AuthContext';
import {
  acceptCrewInstructions,
  fetchCrewInstructions,
  type CrewInstructionsCopy,
  type InstructionsLang,
  type InstructionsPayload,
} from '@/constants/crewInstructions';

/**
 * The same umbrella instructions gate the crew sees on every QR link, mirrored
 * natively. It runs BEFORE the field agreement (which stays exactly as it is)
 * and on every fresh launch of the app, not once per crew.
 *
 * The requirement text comes from the server and the acceptance is recorded
 * there against the portal token's crew.
 */
export default function InstructionsScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal } = useAuth();
  const params = useLocalSearchParams<{ next?: string }>();
  const [payload, setPayload] = useState<InstructionsPayload | null>(null);
  const [lang, setLang] = useState<InstructionsLang>('en');
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setError('');
    try {
      setPayload(await fetchCrewInstructions(token));
    } catch {
      setError("Couldn't load your crew instructions. Check your connection.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy: CrewInstructionsCopy | null = payload?.copy?.[lang] ?? null;

  const onAgree = async () => {
    if (!token || saving || !checked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    setError('');
    try {
      await acceptCrewInstructions(token, lang);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Straight into the field agreement when it has never been accepted;
      // otherwise back to work.
      const next =
        params.next ?? (portal?.crew?.agreementAcceptedAt ? '/(tabs)' : '/onboarding/agreement');
      router.replace(next as never);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('Could not record your agreement. Try again.');
      setSaving(false);
    }
  };

  return (
    <LinearGradient colors={['#07101E', '#0D1C31', '#07101E']} style={{ flex: 1 }}>
      <View style={[s.hdr, { paddingTop: insets.top + 12 }]}>
        <View style={{ width: 36 }} />
        <Text style={s.hdrTitle}>Crew Requirements</Text>
        <Pressable
          hitSlop={12}
          onPress={() => setLang(lang === 'en' ? 'es' : 'en')}
          style={({ pressed }) => [s.lang, pressed && { opacity: 0.7 }]}
        >
          <Text style={s.langText}>{copy?.otherLangLabel ?? 'Español'}</Text>
        </Pressable>
      </View>

      {!copy ? (
        <View style={s.loading}>
          {error ? (
            <>
              <Ionicons name="warning" size={26} color="#FF6A4D" />
              <Text style={s.loadingText}>{error}</Text>
              <Pressable onPress={() => void load()} style={s.retry}>
                <Text style={s.retryText}>Try again</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color="#B4FF44" />
              <Text style={s.loadingText}>Loading…</Text>
            </>
          )}
        </View>
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll}>
            <View style={s.card}>
              <View style={s.kickerRow}>
                <Ionicons name="shield-checkmark" size={18} color="#B4FF44" />
                <Text style={s.kicker}>{copy.kicker}</Text>
              </View>
              <Text style={s.title}>{copy.title}</Text>
              {payload?.crewName ? <Text style={s.who}>{payload.crewName}</Text> : null}
              <Text style={s.intro}>{copy.intro}</Text>
            </View>

            {copy.requirements.map((r, i) => (
              <View key={r.title} style={s.req}>
                <View style={s.num}>
                  <Text style={s.numText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.reqTitle}>{r.title}</Text>
                  <Text style={s.reqBody}>{r.body}</Text>
                </View>
              </View>
            ))}

            <View style={s.warn}>
              <Ionicons name="alert-circle" size={20} color="#FF6A4D" />
              <Text style={s.warnText}>{copy.warning}</Text>
            </View>

            <Pressable style={s.check} onPress={() => setChecked((v) => !v)}>
              <View style={[s.box, checked && s.boxOn]}>
                {checked ? <Ionicons name="checkmark" size={17} color="#07101E" /> : null}
              </View>
              <Text style={s.checkText}>{copy.agreeCheckbox}</Text>
            </Pressable>

            {error ? <Text style={s.err}>{error}</Text> : null}
          </ScrollView>

          <View style={[s.ctaArea, { paddingBottom: insets.bottom + 24 }]}>
            <Pressable
              style={({ pressed }) => [
                s.btn,
                (!checked || saving) && s.btnOff,
                pressed && checked && !saving && { opacity: 0.85 },
              ]}
              disabled={!checked || saving}
              onPress={() => void onAgree()}
            >
              {saving ? (
                <ActivityIndicator color="#07101E" />
              ) : (
                <>
                  <Ionicons name="arrow-forward-circle" size={22} color="#07101E" />
                  <Text style={s.btnText}>{copy.agreeLabel}</Text>
                </>
              )}
            </Pressable>
            <Text style={s.foot}>{copy.footnote}</Text>
          </View>
        </>
      )}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 4 },
  hdrTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    textAlign: 'center',
  },
  lang: {
    minWidth: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.2)',
  },
  langText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#B4FF44' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(180,255,68,0.16)',
  },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#B4FF44' },
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 12 },
  card: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    gap: 6,
  },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
    textTransform: 'uppercase',
  },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#F4F7F9', lineHeight: 28 },
  who: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#B4FF44' },
  intro: { fontSize: 14, fontFamily: 'Inter_400Regular', color: '#C5D4E3', lineHeight: 21 },
  req: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    padding: 14,
  },
  num: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(180,255,68,0.16)',
  },
  numText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#B4FF44' },
  reqTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#F4F7F9' },
  reqBody: {
    marginTop: 4,
    fontSize: 13.5,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    lineHeight: 20,
  },
  warn: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,106,77,0.4)',
    backgroundColor: 'rgba(255,106,77,0.1)',
  },
  warnText: { flex: 1, fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: '#FFD9CF', lineHeight: 20 },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 4 },
  box: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(180,255,68,0.55)',
    backgroundColor: 'rgba(180,255,68,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: '#B4FF44', borderColor: '#B4FF44' },
  checkText: { flex: 1, fontSize: 13.5, fontFamily: 'Inter_600SemiBold', color: '#F4F7F9', lineHeight: 20 },
  err: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FF6A4D' },
  ctaArea: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B4FF44',
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
  },
  btnOff: { backgroundColor: 'rgba(180,255,68,0.25)' },
  btnText: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#07101E' },
  foot: {
    fontSize: 11.5,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
    textAlign: 'center',
    lineHeight: 17,
  },
});
