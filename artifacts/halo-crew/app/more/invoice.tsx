import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import {
  useListPortalInvoices,
  useListPortalJobs,
  useSubmitPortalInvoice,
  getListPortalInvoicesQueryKey,
  getListPortalJobsQueryKey,
} from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function fmtMoney(dollars: number | null | undefined) {
  if (dollars == null) return '$0.00';
  return `$${(dollars).toFixed(2)}`;
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    draft: '#8CA0B9',
    submitted: '#B4FF44',
    needs_corrections: '#F97316',
    approved: '#22C55E',
    paid: '#22C55E',
    rejected: '#E11D48',
  };
  return map[status] ?? '#8CA0B9';
}

function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function InvoiceScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal } = useAuth();
  const [tab, setTab] = useState<'list' | 'create'>('list');

  const { data: invoices, isLoading, refetch } = useListPortalInvoices(token!, {
    query: { enabled: !!token, queryKey: getListPortalInvoicesQueryKey(token!) },
  });

  const { data: jobs } = useListPortalJobs(token!, {
    query: { enabled: !!token, queryKey: getListPortalJobsQueryKey(token!) },
  });

  const activeJob = jobs?.find((j) => j.checkedIn) ?? jobs?.[0] ?? null;
  const crew = portal?.crew;

  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
    <View style={s.container}>
      {/* Tab bar */}
      <View style={s.tabs}>
        {(['list', 'create'] as const).map((t) => (
          <Pressable
            key={t}
            style={[s.tab, tab === t && s.tabActive]}
            onPress={() => {
              setTab(t);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'list' ? 'My Invoices' : 'New Invoice'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'list' ? (
        isLoading ? (
          <View style={s.loading}>
            <ActivityIndicator color="#B4FF44" />
          </View>
        ) : !invoices?.length ? (
          <View style={s.empty}>
            <Ionicons name="document-text-outline" size={48} color="#435A7D" />
            <Text style={s.emptyTitle}>No invoices yet</Text>
            <Text style={s.emptyBody}>
              Create your first crew invoice after completing a job.
            </Text>
            <Pressable
              style={s.createBtn}
              onPress={() => setTab('create')}
            >
              <Text style={s.createBtnText}>Create invoice</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={invoices}
            keyExtractor={(i) => i.id}
            contentContainerStyle={{ padding: 16, paddingBottom: bottomPad + 20, gap: 12 }}
            renderItem={({ item }) => (
              <View style={s.invoiceCard}>
                <View style={s.invoiceHeader}>
                  <Text style={s.invoiceId}>Invoice #{item.invoiceNo ?? item.id.slice(-6)}</Text>
                  <View style={[s.statusBadge, { borderColor: statusColor(item.status) + '55' }]}>
                    <Text style={[s.statusText, { color: statusColor(item.status) }]}>
                      {item.status?.replace('_', ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={s.invoiceProperty}>{item.jobLabel ?? item.propertyAddress}</Text>
                <Text style={s.invoiceAmount}>{fmtMoney(item.total)}</Text>
                {item.adminNote && (
                  <View style={s.noteBox}>
                    <Ionicons name="information-circle-outline" size={14} color="#F97316" />
                    <Text style={s.noteText}>{item.adminNote}</Text>
                  </View>
                )}
              </View>
            )}
          />
        )
      ) : (
        <CreateInvoiceForm
          token={token!}
          jobId={activeJob?.id ?? null}
          propertyAddress={activeJob?.propertyName ?? ''}
          crewName={crew?.name ?? ''}
          onSuccess={() => { setTab('list'); refetch(); }}
        />
      )}
    </View>
  );
}

function CreateInvoiceForm({
  token,
  jobId,
  propertyAddress,
  crewName,
  onSuccess,
}: {
  token: string;
  jobId: string | null;
  propertyAddress: string;
  crewName: string;
  onSuccess: () => void;
}) {
  const insets = useSafeAreaInsets();
  const today = localDateStr();

  // Required fields
  const [fromCompany, setFromCompany] = useState(crewName);
  const [address, setAddress] = useState(propertyAddress);
  const [dateOfWork, setDateOfWork] = useState(today);
  const [typeOfWork, setTypeOfWork] = useState('');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [signatureName, setSignatureName] = useState(crewName);

  const { mutateAsync: submit, isPending } = useSubmitPortalInvoice();

  const handleSubmit = async () => {
    const parsedQty = parseFloat(qty) || 1;
    const parsedPrice = parseFloat(unitPrice.replace(/[^0-9.]/g, ''));

    if (!fromCompany.trim()) {
      Alert.alert('Missing info', 'Enter your company name.');
      return;
    }
    if (!address.trim()) {
      Alert.alert('Missing info', 'Enter the property address.');
      return;
    }
    if (!typeOfWork.trim()) {
      Alert.alert('Missing info', 'Describe the work performed.');
      return;
    }
    if (!parsedPrice || isNaN(parsedPrice) || parsedPrice <= 0) {
      Alert.alert('Missing info', 'Enter a unit price greater than zero.');
      return;
    }
    if (!signatureName.trim()) {
      Alert.alert('Missing info', 'Type your full name to sign the invoice.');
      return;
    }

    try {
      await submit({
        token,
        data: {
          fromCompany: fromCompany.trim(),
          propertyAddress: address.trim(),
          invoiceDate: today,
          jobId: jobId ?? undefined,
          signatureName: signatureName.trim(),
          items: [
            {
              dateOfWork,
              typeOfWork: typeOfWork.trim(),
              qty: parsedQty,
              unitPrice: parsedPrice,
            },
          ],
        },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not submit invoice';
      Alert.alert('Error', msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[
        s.form,
        { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 20) },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.formLabel}>Your Company Name *</Text>
      <TextInput
        style={s.input}
        value={fromCompany}
        onChangeText={setFromCompany}
        placeholder="Your company name"
        placeholderTextColor="#435A7D"
      />

      <Text style={s.formLabel}>Property Address *</Text>
      <TextInput
        style={s.input}
        value={address}
        onChangeText={setAddress}
        placeholder="123 Main St, City, State"
        placeholderTextColor="#435A7D"
      />

      <Text style={s.formLabel}>Date of Work *</Text>
      <TextInput
        style={s.input}
        value={dateOfWork}
        onChangeText={setDateOfWork}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#435A7D"
        keyboardType="numbers-and-punctuation"
      />

      <Text style={s.formLabel}>Work Performed *</Text>
      <TextInput
        style={[s.input, { minHeight: 72 }]}
        value={typeOfWork}
        onChangeText={setTypeOfWork}
        placeholder="e.g. Deep clean, carpet cleaning, painting..."
        placeholderTextColor="#435A7D"
        multiline
      />

      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.formLabel}>Qty</Text>
          <TextInput
            style={s.input}
            value={qty}
            onChangeText={setQty}
            placeholder="1"
            placeholderTextColor="#435A7D"
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 2, marginLeft: 12 }}>
          <Text style={s.formLabel}>Unit Price *</Text>
          <TextInput
            style={s.input}
            value={unitPrice}
            onChangeText={setUnitPrice}
            placeholder="0.00"
            placeholderTextColor="#435A7D"
            keyboardType="decimal-pad"
          />
        </View>
      </View>

      <Text style={s.formLabel}>Your Full Name (signature) *</Text>
      <TextInput
        style={s.input}
        value={signatureName}
        onChangeText={setSignatureName}
        placeholder="Full legal name"
        placeholderTextColor="#435A7D"
        autoCorrect={false}
      />

      {unitPrice && parseFloat(unitPrice) > 0 && (
        <View style={s.totalPreview}>
          <Text style={s.totalLabel}>Invoice Total</Text>
          <Text style={s.totalAmount}>
            ${((parseFloat(qty) || 1) * (parseFloat(unitPrice) || 0)).toFixed(2)}
          </Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          s.submitBtn,
          pressed && { opacity: 0.85 },
          isPending && { opacity: 0.6 },
        ]}
        onPress={handleSubmit}
        disabled={isPending}
      >
        {isPending ? (
          <ActivityIndicator color="#07101E" />
        ) : (
          <Text style={s.submitBtnText}>Submit Invoice</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(140,160,185,0.12)',
    paddingHorizontal: 16,
  },
  tab: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginRight: 24,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: '#B4FF44' },
  tabText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#435A7D',
  },
  tabTextActive: { color: '#F4F7F9', fontFamily: 'Inter_600SemiBold' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    textAlign: 'center',
    lineHeight: 21,
  },
  createBtn: {
    backgroundColor: '#B4FF44',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  createBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
  invoiceCard: {
    backgroundColor: '#13223A',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    gap: 6,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceId: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize',
  },
  invoiceProperty: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#F4F7F9',
  },
  invoiceAmount: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
  },
  noteBox: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(249,115,22,0.10)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#F97316',
    lineHeight: 18,
  },
  form: {
    padding: 16,
    gap: 6,
    maxWidth: Platform.OS === 'web' ? 600 : undefined,
    width: '100%',
    alignSelf: 'center' as const,
  },
  formLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#13223A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  totalPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(180,255,68,0.08)',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.20)',
  },
  totalLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
  },
  totalAmount: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
  },
  submitBtn: {
    backgroundColor: '#B4FF44',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#07101E',
  },
});
