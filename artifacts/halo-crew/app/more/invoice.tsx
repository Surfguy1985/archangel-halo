import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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
  useGetPortalServices,
  useSubmitPortalInvoice,
  getListPortalInvoicesQueryKey,
  getListPortalJobsQueryKey,
  getGetPortalServicesQueryKey,
} from '@workspace/api-client-react';
import type { PortalServicesCatalogItem } from '@workspace/api-client-react';
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

// ─── Service Picker Modal ──────────────────────────────────────────────────────

function ServicePickerModal({
  visible,
  onClose,
  items,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  items: PortalServicesCatalogItem[];
  onSelect: (service: string, rate: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? items.filter((i) => i.service.toLowerCase().includes(search.toLowerCase().trim()))
    : items;

  // Group by category
  const groups: { category: string; services: PortalServicesCatalogItem[] }[] = [];
  for (const item of filtered) {
    const cat = item.category ?? 'General';
    const g = groups.find((x) => x.category === cat);
    if (g) g.services.push(item);
    else groups.push({ category: cat, services: [item] });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={pm.overlay}>
        <Pressable style={pm.backdrop} onPress={onClose} />
        <View style={[pm.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={pm.handle} />
          <Text style={pm.title}>Select Service</Text>

          {/* Search */}
          <View style={pm.searchRow}>
            <Ionicons name="search" size={16} color="#8CA0B9" />
            <TextInput
              style={pm.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search services…"
              placeholderTextColor="#435A7D"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>

          {filtered.length === 0 ? (
            <View style={pm.empty}>
              <Text style={pm.emptyText}>No matching services</Text>
            </View>
          ) : (
            <FlatList
              data={groups}
              keyExtractor={(g) => g.category}
              style={{ maxHeight: 420 }}
              renderItem={({ item: group }) => (
                <View>
                  <Text style={pm.groupHeader}>{group.category.toUpperCase()}</Text>
                  {group.services.map((svc) => (
                    <Pressable
                      key={svc.service}
                      style={({ pressed }) => [pm.row, pressed && pm.rowPressed]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onSelect(svc.service, svc.rate);
                        setSearch('');
                        onClose();
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={pm.rowService}>{svc.service}</Text>
                        {svc.unit && (
                          <Text style={pm.rowUnit}>per {svc.unit}</Text>
                        )}
                      </View>
                      <Text style={pm.rowRate}>{fmtMoney(svc.rate)}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            />
          )}

          <Pressable style={pm.cancelBtn} onPress={onClose}>
            <Text style={pm.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

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

  const { data: servicesData } = useGetPortalServices(token!, {
    query: { enabled: !!token, queryKey: getGetPortalServicesQueryKey(token!) },
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
            <Pressable style={s.createBtn} onPress={() => setTab('create')}>
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
          jobLabel={activeJob?.label ?? null}
          propertyAddress={activeJob?.propertyName ?? ''}
          crewName={crew?.name ?? ''}
          catalog={servicesData?.catalog ?? []}
          byJob={servicesData?.byJob ?? {}}
          onSuccess={() => { setTab('list'); refetch(); }}
        />
      )}
    </View>
  );
}

// ─── Create Form ──────────────────────────────────────────────────────────────

function CreateInvoiceForm({
  token,
  jobId,
  jobLabel,
  propertyAddress,
  crewName,
  catalog,
  byJob,
  onSuccess,
}: {
  token: string;
  jobId: string | null;
  jobLabel: string | null;
  propertyAddress: string;
  crewName: string;
  catalog: PortalServicesCatalogItem[];
  byJob: Record<string, string[]>;
  onSuccess: () => void;
}) {
  const insets = useSafeAreaInsets();
  const today = localDateStr();

  const [fromCompany, setFromCompany] = useState(crewName);
  const [address, setAddress] = useState(propertyAddress);
  const [dateOfWork, setDateOfWork] = useState(today);
  const [typeOfWork, setTypeOfWork] = useState('');
  const [qty, setQty] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [signatureName, setSignatureName] = useState(crewName);
  const [showPicker, setShowPicker] = useState(false);

  const { mutateAsync: submit, isPending } = useSubmitPortalInvoice();

  // ── Eligible service items for the selected job ────────────────────────────
  // If the job has specific services recorded (from Base44), only show those.
  // Otherwise fall back to the full catalog so the form is never blocked.
  const eligibleNames: Set<string> = React.useMemo(() => {
    if (!jobId) return new Set();
    const names = byJob[jobId];
    if (!names || names.length === 0) return new Set();
    return new Set(names.map((n) => n.trim().toLowerCase()));
  }, [jobId, byJob]);

  const pickerItems: PortalServicesCatalogItem[] = React.useMemo(() => {
    if (eligibleNames.size === 0) return catalog; // no job or no services → full catalog
    return catalog.filter((c) => eligibleNames.has(c.service.trim().toLowerCase()));
  }, [catalog, eligibleNames]);

  const handleSelectService = (service: string, rate: number) => {
    setTypeOfWork(service);
    setUnitPrice(rate.toFixed(2));
  };

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
      Alert.alert('Missing info', 'Select a service from the list.');
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
    <>
      <ScrollView
        contentContainerStyle={[
          s.form,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 20) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Job context */}
        {jobLabel && (
          <View style={s.jobBadge}>
            <Ionicons name="briefcase-outline" size={13} color="#B4FF44" />
            <Text style={s.jobBadgeText}>{jobLabel}</Text>
          </View>
        )}

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

        {/* ── Service Picker ── */}
        <Text style={s.formLabel}>Service Performed *</Text>
        {eligibleNames.size > 0 && (
          <Text style={s.eligibleNote}>
            {eligibleNames.size} service{eligibleNames.size !== 1 ? 's' : ''} verified for this job
          </Text>
        )}
        <Pressable
          style={({ pressed }) => [s.pickerTrigger, pressed && { opacity: 0.75 }]}
          onPress={() => setShowPicker(true)}
        >
          <Text
            style={[s.pickerValue, !typeOfWork && s.pickerPlaceholder]}
            numberOfLines={1}
          >
            {typeOfWork || 'Tap to select a service…'}
          </Text>
          <Ionicons name="chevron-down" size={16} color="#8CA0B9" />
        </Pressable>

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
            <Text style={s.formLabel}>Rate *</Text>
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

      <ServicePickerModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        items={pickerItems}
        onSelect={handleSelectService}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  jobBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(180,255,68,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.15)',
  },
  jobBadgeText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#B4FF44',
    flex: 1,
  },
  formLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    marginTop: 10,
    marginBottom: 4,
  },
  eligibleNote: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#22C55E',
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
  pickerTrigger: {
    backgroundColor: '#13223A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: 'rgba(180,255,68,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerValue: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: '#F4F7F9',
  },
  pickerPlaceholder: {
    color: '#435A7D',
    fontFamily: 'Inter_400Regular',
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

const pm = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: '#111E30',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
    maxHeight: '80%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,160,185,0.30)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: '#F4F7F9',
    marginBottom: 12,
    textAlign: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D1827',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.12)',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
  },
  groupHeader: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#435A7D',
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderRadius: 10,
    gap: 10,
  },
  rowPressed: {
    backgroundColor: 'rgba(180,255,68,0.07)',
  },
  rowService: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: '#F4F7F9',
  },
  rowUnit: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#8CA0B9',
    marginTop: 2,
  },
  rowRate: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: '#B4FF44',
  },
  cancelBtn: {
    marginTop: 10,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(140,160,185,0.08)',
  },
  cancelText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
  },
});
