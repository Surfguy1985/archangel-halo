import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import {
  useListPortalDocuments,
  useGetPortalW9,
  useGetPortalBank,
  getListPortalDocumentsQueryKey,
  getGetPortalW9QueryKey,
  getGetPortalBankQueryKey,
} from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';

// ─── W-9 Modal ────────────────────────────────────────────────────────────────

type W9Form = {
  name: string;
  businessName: string;
  taxClassification: string;
  tinType: 'ssn' | 'ein';
  ssn: string;
  ein: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  certified: boolean;
};

const TAX_CLASSES = [
  { value: 'individual', label: 'Individual / Sole Proprietor' },
  { value: 'llc', label: 'LLC' },
  { value: 'c_corp', label: 'C Corporation' },
  { value: 's_corp', label: 'S Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'other', label: 'Other' },
];

function W9Modal({
  visible,
  token,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<W9Form>({
    name: '',
    businessName: '',
    taxClassification: 'individual',
    tinType: 'ssn',
    ssn: '',
    ein: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    certified: false,
  });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof W9Form, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) { Alert.alert('Name required'); return; }
    if (!form.address.trim()) { Alert.alert('Address required'); return; }
    if (form.tinType === 'ssn' && !form.ssn.trim()) { Alert.alert('SSN required'); return; }
    if (form.tinType === 'ein' && !form.ein.trim()) { Alert.alert('EIN required'); return; }
    if (!form.certified) { Alert.alert('Please certify accuracy before submitting'); return; }

    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        businessName: form.businessName.trim() || null,
        taxClassification: form.taxClassification,
        tinType: form.tinType,
        ssn: form.tinType === 'ssn' ? form.ssn.trim() : null,
        ein: form.tinType === 'ein' ? form.ein.trim() : null,
        address: form.address.trim(),
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        certified: true,
        signedDate: new Date().toISOString().split('T')[0],
      };
      const resp = await fetch(`https://${DOMAIN}/api/portal/${token}/w9`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        Alert.alert('Error', (err as any).error ?? 'Could not submit W-9.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    } catch {
      Alert.alert('Error', 'Could not connect. Check your internet and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[m.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={m.header}>
          <TouchableOpacity onPress={onClose} style={m.closeBtn}>
            <Ionicons name="close" size={22} color="#8CA0B9" />
          </TouchableOpacity>
          <Text style={m.title}>W-9 Tax Form</Text>
          <View style={{ width: 36 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={m.scroll} keyboardShouldPersistTaps="handled">
            <Text style={m.sectionTitle}>Name & Classification</Text>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Full legal name *</Text>
              <TextInput
                style={m.input}
                value={form.name}
                onChangeText={(v) => set('name', v)}
                placeholder="As shown on tax return"
                placeholderTextColor="#435A7D"
              />
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Business / DBA name (optional)</Text>
              <TextInput
                style={m.input}
                value={form.businessName}
                onChangeText={(v) => set('businessName', v)}
                placeholder="If different from above"
                placeholderTextColor="#435A7D"
              />
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Federal tax classification</Text>
              <View style={m.pills}>
                {TAX_CLASSES.map((tc) => (
                  <Pressable
                    key={tc.value}
                    style={[m.pill, form.taxClassification === tc.value && m.pillActive]}
                    onPress={() => set('taxClassification', tc.value)}
                  >
                    <Text style={[m.pillText, form.taxClassification === tc.value && m.pillTextActive]}>
                      {tc.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Text style={m.sectionTitle}>Taxpayer ID</Text>

            <View style={m.fieldGroup}>
              <View style={m.toggleRow}>
                {(['ssn', 'ein'] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[m.toggleBtn, form.tinType === t && m.toggleBtnActive]}
                    onPress={() => set('tinType', t)}
                  >
                    <Text style={[m.toggleText, form.tinType === t && m.toggleTextActive]}>
                      {t === 'ssn' ? 'SSN' : 'EIN'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {form.tinType === 'ssn' ? (
                <TextInput
                  style={[m.input, { marginTop: 10 }]}
                  value={form.ssn}
                  onChangeText={(v) => set('ssn', v)}
                  placeholder="XXX-XX-XXXX"
                  placeholderTextColor="#435A7D"
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={11}
                />
              ) : (
                <TextInput
                  style={[m.input, { marginTop: 10 }]}
                  value={form.ein}
                  onChangeText={(v) => set('ein', v)}
                  placeholder="XX-XXXXXXX"
                  placeholderTextColor="#435A7D"
                  keyboardType="numeric"
                  maxLength={10}
                />
              )}
            </View>

            <Text style={m.sectionTitle}>Address</Text>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Street address *</Text>
              <TextInput
                style={m.input}
                value={form.address}
                onChangeText={(v) => set('address', v)}
                placeholder="123 Main St"
                placeholderTextColor="#435A7D"
              />
            </View>

            <View style={m.row3}>
              <View style={[m.fieldGroup, { flex: 2 }]}>
                <Text style={m.label}>City</Text>
                <TextInput
                  style={m.input}
                  value={form.city}
                  onChangeText={(v) => set('city', v)}
                  placeholder="City"
                  placeholderTextColor="#435A7D"
                />
              </View>
              <View style={[m.fieldGroup, { flex: 1 }]}>
                <Text style={m.label}>State</Text>
                <TextInput
                  style={m.input}
                  value={form.state}
                  onChangeText={(v) => set('state', v.toUpperCase())}
                  placeholder="TX"
                  placeholderTextColor="#435A7D"
                  maxLength={2}
                  autoCapitalize="characters"
                />
              </View>
              <View style={[m.fieldGroup, { flex: 1.5 }]}>
                <Text style={m.label}>ZIP</Text>
                <TextInput
                  style={m.input}
                  value={form.zip}
                  onChangeText={(v) => set('zip', v)}
                  placeholder="12345"
                  placeholderTextColor="#435A7D"
                  keyboardType="numeric"
                  maxLength={5}
                />
              </View>
            </View>

            <Text style={m.sectionTitle}>Certification</Text>

            <Pressable
              style={m.certRow}
              onPress={() => set('certified', !form.certified)}
            >
              <View style={[m.checkbox, form.certified && m.checkboxChecked]}>
                {form.certified && <Ionicons name="checkmark" size={14} color="#07101E" />}
              </View>
              <Text style={m.certText}>
                Under penalties of perjury, I certify that the taxpayer ID provided is correct and
                that I am not subject to backup withholding.
              </Text>
            </Pressable>

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={[m.footer, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              style={[m.submitBtn, (!form.certified || saving) && m.submitDisabled]}
              onPress={submit}
              disabled={saving || !form.certified}
            >
              {saving ? (
                <ActivityIndicator color="#07101E" />
              ) : (
                <>
                  <Ionicons name="document-text" size={18} color="#07101E" />
                  <Text style={m.submitText}>Submit W-9</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Bank Modal ───────────────────────────────────────────────────────────────

type BankForm = {
  holderName: string;
  accountKind: 'personal' | 'business';
  businessName: string;
  accountType: 'checking' | 'savings';
  bankName: string;
  routingNumber: string;
  accountNumber: string;
  confirmAccount: string;
};

function BankModal({
  visible,
  token,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<BankForm>({
    holderName: '',
    accountKind: 'personal',
    businessName: '',
    accountType: 'checking',
    bankName: '',
    routingNumber: '',
    accountNumber: '',
    confirmAccount: '',
  });
  const [saving, setSaving] = useState(false);

  const set = (key: keyof BankForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    if (!form.holderName.trim()) { Alert.alert('Account holder name required'); return; }
    if (!/^\d{9}$/.test(form.routingNumber)) { Alert.alert('Routing number must be exactly 9 digits'); return; }
    if (!/^\d{4,17}$/.test(form.accountNumber)) { Alert.alert('Account number must be 4–17 digits'); return; }
    if (form.accountNumber !== form.confirmAccount) { Alert.alert('Account numbers do not match'); return; }

    setSaving(true);
    try {
      const body = {
        holderName: form.holderName.trim(),
        accountKind: form.accountKind,
        businessName: form.accountKind === 'business' && form.businessName.trim()
          ? form.businessName.trim()
          : undefined,
        accountType: form.accountType,
        bankName: form.bankName.trim() || undefined,
        routingNumber: form.routingNumber,
        accountNumber: form.accountNumber,
      };
      const resp = await fetch(`https://${DOMAIN}/api/portal/${token}/bank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        Alert.alert('Error', (err as any).error ?? 'Could not save bank account.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    } catch {
      Alert.alert('Error', 'Could not connect. Check your internet and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[m.container, { paddingTop: insets.top }]}>
        <View style={m.header}>
          <TouchableOpacity onPress={onClose} style={m.closeBtn}>
            <Ionicons name="close" size={22} color="#8CA0B9" />
          </TouchableOpacity>
          <Text style={m.title}>Bank Account</Text>
          <View style={{ width: 36 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={m.scroll} keyboardShouldPersistTaps="handled">

            <View style={m.infoBox}>
              <Ionicons name="lock-closed-outline" size={16} color="#8CA0B9" />
              <Text style={m.infoText}>
                Your account details are encrypted and used only for payroll via ACH.
              </Text>
            </View>

            <Text style={m.sectionTitle}>Account Owner</Text>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Account type</Text>
              <View style={m.toggleRow}>
                {(['personal', 'business'] as const).map((k) => (
                  <Pressable
                    key={k}
                    style={[m.toggleBtn, form.accountKind === k && m.toggleBtnActive]}
                    onPress={() => setForm((f) => ({ ...f, accountKind: k }))}
                  >
                    <Text style={[m.toggleText, form.accountKind === k && m.toggleTextActive]}>
                      {k === 'personal' ? 'Personal' : 'Business'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Account holder name *</Text>
              <TextInput
                style={m.input}
                value={form.holderName}
                onChangeText={(v) => set('holderName', v)}
                placeholder="Full name on account"
                placeholderTextColor="#435A7D"
                autoCapitalize="words"
              />
            </View>

            {form.accountKind === 'business' && (
              <View style={m.fieldGroup}>
                <Text style={m.label}>Business name</Text>
                <TextInput
                  style={m.input}
                  value={form.businessName}
                  onChangeText={(v) => set('businessName', v)}
                  placeholder="Legal business name"
                  placeholderTextColor="#435A7D"
                />
              </View>
            )}

            <Text style={m.sectionTitle}>Account Details</Text>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Account type</Text>
              <View style={m.toggleRow}>
                {(['checking', 'savings'] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[m.toggleBtn, form.accountType === t && m.toggleBtnActive]}
                    onPress={() => setForm((f) => ({ ...f, accountType: t }))}
                  >
                    <Text style={[m.toggleText, form.accountType === t && m.toggleTextActive]}>
                      {t === 'checking' ? 'Checking' : 'Savings'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Bank name (optional)</Text>
              <TextInput
                style={m.input}
                value={form.bankName}
                onChangeText={(v) => set('bankName', v)}
                placeholder="e.g. Chase, Wells Fargo"
                placeholderTextColor="#435A7D"
              />
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Routing number (9 digits) *</Text>
              <TextInput
                style={m.input}
                value={form.routingNumber}
                onChangeText={(v) => set('routingNumber', v.replace(/\D/g, '').slice(0, 9))}
                placeholder="123456789"
                placeholderTextColor="#435A7D"
                keyboardType="numeric"
                maxLength={9}
              />
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Account number *</Text>
              <TextInput
                style={m.input}
                value={form.accountNumber}
                onChangeText={(v) => set('accountNumber', v.replace(/\D/g, '').slice(0, 17))}
                placeholder="Account number"
                placeholderTextColor="#435A7D"
                keyboardType="numeric"
                secureTextEntry
              />
            </View>

            <View style={m.fieldGroup}>
              <Text style={m.label}>Confirm account number *</Text>
              <TextInput
                style={[
                  m.input,
                  form.confirmAccount && form.confirmAccount !== form.accountNumber &&
                    { borderColor: '#E11D48' },
                ]}
                value={form.confirmAccount}
                onChangeText={(v) => set('confirmAccount', v.replace(/\D/g, '').slice(0, 17))}
                placeholder="Re-enter account number"
                placeholderTextColor="#435A7D"
                keyboardType="numeric"
                secureTextEntry
              />
              {form.confirmAccount !== '' && form.confirmAccount !== form.accountNumber && (
                <Text style={m.errorText}>Account numbers don't match</Text>
              )}
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>

          <View style={[m.footer, { paddingBottom: insets.bottom + 16 }]}>
            <Pressable
              style={[m.submitBtn, saving && m.submitDisabled]}
              onPress={submit}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#07101E" />
              ) : (
                <>
                  <Ionicons name="card" size={18} color="#07101E" />
                  <Text style={m.submitText}>Save Bank Account</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Doc row ─────────────────────────────────────────────────────────────────

function DocRow({
  icon,
  label,
  sub,
  onPress,
  loading,
  done,
  accent,
}: {
  icon: string;
  label: string;
  sub?: string;
  onPress?: () => void;
  loading?: boolean;
  done?: boolean;
  accent?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.docRow,
        pressed && onPress ? { opacity: 0.8 } : {},
      ]}
      onPress={onPress}
      disabled={!onPress || loading}
    >
      <View style={[s.docIcon, { backgroundColor: (accent ?? '#8CA0B9') + '18' }]}>
        {loading ? (
          <ActivityIndicator size="small" color={accent ?? '#8CA0B9'} />
        ) : (
          <Ionicons name={icon as any} size={22} color={accent ?? '#8CA0B9'} />
        )}
      </View>
      <View style={s.docInfo}>
        <Text style={s.docLabel}>{label}</Text>
        {sub && <Text style={s.docSub}>{sub}</Text>}
      </View>
      {done ? (
        <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color="#435A7D" />
      ) : null}
    </Pressable>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function DocsScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal } = useAuth();
  const queryClient = useQueryClient();
  const [showW9, setShowW9] = useState(false);
  const [showBank, setShowBank] = useState(false);

  const { data: docs, isLoading: docsLoading } = useListPortalDocuments(
    token!,
    { query: { enabled: !!token, queryKey: getListPortalDocumentsQueryKey(token!) } },
  );
  const { data: w9, refetch: refetchW9 } = useGetPortalW9(token!, {
    query: { enabled: !!token, queryKey: getGetPortalW9QueryKey(token!) },
  });
  const { data: bank, refetch: refetchBank } = useGetPortalBank(token!, {
    query: { enabled: !!token, queryKey: getGetPortalBankQueryKey(token!) },
  });

  const crew = portal?.crew;
  const hasW9 = w9?.submitted ?? crew?.w9Submitted ?? false;
  const hasBank = !!bank?.accountLast4;
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
    <>
      <ScrollView
        style={s.container}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 20 }]}
      >
        {/* Required */}
        <Text style={s.sectionTitle}>Required Documents</Text>

        <View style={s.section}>
          <DocRow
            icon="document-text-outline"
            label="W-9 Tax Form"
            sub={hasW9 ? 'Submitted ✓' : 'Required to get paid'}
            accent="#B4FF44"
            done={hasW9}
            onPress={hasW9 ? undefined : () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowW9(true);
            }}
          />
          <View style={s.rowDivider} />
          <DocRow
            icon="card-outline"
            label="Payment Method"
            sub={hasBank ? `Account ending ···${bank?.accountLast4}` : 'Add your bank account for direct pay'}
            accent="#22C55E"
            done={hasBank}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowBank(true);
            }}
          />
        </View>

        {/* My Documents */}
        <Text style={s.sectionTitle}>My Documents</Text>

        {docsLoading ? (
          <View style={s.loading}>
            <ActivityIndicator color="#B4FF44" />
          </View>
        ) : !docs?.length ? (
          <View style={s.emptyDocs}>
            <Ionicons name="folder-open-outline" size={36} color="#435A7D" />
            <Text style={s.emptyDocsText}>No documents yet</Text>
            <Text style={s.emptyDocsSub}>
              Your office will share contracts and job docs here.
            </Text>
          </View>
        ) : (
          <View style={s.section}>
            {docs.map((doc, i) => (
              <React.Fragment key={doc.id}>
                {i > 0 && <View style={s.rowDivider} />}
                <DocRow
                  icon={
                    doc.contentType?.includes('pdf')
                      ? 'document-text-outline'
                      : 'document-outline'
                  }
                  label={doc.name ?? 'Document'}
                  sub={doc.contentType ?? undefined}
                  accent="#60A5FA"
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    Alert.alert(doc.name ?? 'Document', 'Open in your browser to view this document.');
                  }}
                />
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Info */}
        <View style={s.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#8CA0B9" />
          <Text style={s.infoText}>
            All documents are stored securely. Your W-9 is required by the IRS
            for any payment over $600.
          </Text>
        </View>
      </ScrollView>

      {/* W-9 form modal */}
      <W9Modal
        visible={showW9}
        token={token!}
        onClose={() => setShowW9(false)}
        onSuccess={() => {
          setShowW9(false);
          refetchW9();
          queryClient.invalidateQueries({ queryKey: getGetPortalW9QueryKey(token!) });
        }}
      />

      {/* Bank form modal */}
      <BankModal
        visible={showBank}
        token={token!}
        onClose={() => setShowBank(false)}
        onSuccess={() => {
          setShowBank(false);
          refetchBank();
          queryClient.invalidateQueries({ queryKey: getGetPortalBankQueryKey(token!) });
        }}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  content: { padding: 16, gap: 14 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  section: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(140,160,185,0.10)',
    marginHorizontal: 16,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  docIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  docInfo: { flex: 1, gap: 2 },
  docLabel: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: '#F4F7F9',
  },
  docSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
  },
  loading: { alignItems: 'center', paddingVertical: 30 },
  emptyDocs: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
  },
  emptyDocsText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: '#8CA0B9',
  },
  emptyDocsSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
    textAlign: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(140,160,185,0.06)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
    lineHeight: 20,
  },
});

// Modal styles
const m = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(140,160,185,0.12)',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(140,160,185,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
  },
  scroll: { padding: 16, gap: 4 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
  },
  fieldGroup: { gap: 6, marginBottom: 12 },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#8CA0B9',
  },
  input: {
    backgroundColor: '#13223A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.20)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.20)',
    backgroundColor: 'rgba(140,160,185,0.06)',
  },
  pillActive: {
    borderColor: '#B4FF44',
    backgroundColor: 'rgba(180,255,68,0.10)',
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#8CA0B9',
  },
  pillTextActive: { color: '#B4FF44' },
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.20)',
    backgroundColor: 'rgba(140,160,185,0.06)',
    alignItems: 'center',
  },
  toggleBtnActive: {
    borderColor: '#B4FF44',
    backgroundColor: 'rgba(180,255,68,0.12)',
  },
  toggleText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
  },
  toggleTextActive: { color: '#B4FF44' },
  row3: { flexDirection: 'row', gap: 10 },
  certRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(140,160,185,0.06)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    marginTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(140,160,185,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: '#B4FF44',
    borderColor: '#B4FF44',
  },
  certText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    lineHeight: 19,
  },
  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(140,160,185,0.06)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
    alignItems: 'flex-start',
    marginTop: 8,
    marginBottom: 4,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
    lineHeight: 20,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#E11D48',
    marginTop: 4,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(140,160,185,0.12)',
    backgroundColor: '#07101E',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B4FF44',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 10,
  },
  submitDisabled: { opacity: 0.5 },
  submitText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
});
