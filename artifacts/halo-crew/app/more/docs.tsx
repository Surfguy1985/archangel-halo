import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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

export default function DocsScreen() {
  const insets = useSafeAreaInsets();
  const { token, portal } = useAuth();
  const [openW9, setOpenW9] = useState(false);

  const { data: docs, isLoading: docsLoading } = useListPortalDocuments(
    token!,
    { query: { enabled: !!token, queryKey: getListPortalDocumentsQueryKey(token!) } },
  );
  const { data: w9 } = useGetPortalW9(token!, {
    query: { enabled: !!token, queryKey: getGetPortalW9QueryKey(token!) },
  });
  const { data: bank } = useGetPortalBank(token!, {
    query: { enabled: !!token, queryKey: getGetPortalBankQueryKey(token!) },
  });

  const crew = portal?.crew;
  const hasW9 = crew?.w9Submitted ?? false;
  const hasBank = !!bank?.accountLast4;
  const bottomPad = insets.bottom + (Platform.OS === 'web' ? 34 : 0);

  return (
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
          sub={hasW9 ? 'Submitted' : 'Required to get paid'}
          accent="#B4FF44"
          done={hasW9}
          onPress={hasW9 ? undefined : () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Alert.alert(
              'W-9 Form',
              'Please fill out the W-9 form. Contact your office manager if you need assistance.',
            );
          }}
        />
        <View style={s.rowDivider} />
        <DocRow
          icon="card-outline"
          label="Payment Method"
          sub={hasBank ? `Account ending ···${bank?.accountLast4}` : 'Add your bank account'}
          accent="#22C55E"
          done={hasBank}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Alert.alert(
              'Payment Setup',
              'Contact your office to update your bank account or payment method.',
            );
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
                  Alert.alert(doc.name ?? 'Document', 'Open in browser to view this document.');
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
  );
}

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
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.10)',
  },
  emptyDocsText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#435A7D',
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
