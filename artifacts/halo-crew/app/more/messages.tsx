import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import {
  useListPortalMessages,
  useSendPortalMessage,
  useMarkPortalSeen,
  getListPortalMessagesQueryKey,
} from '@workspace/api-client-react';
import type { CrewMessage } from '@workspace/api-client-react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';

function formatTime(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function MessageBubble({ msg }: { msg: CrewMessage }) {
  // sender === 'office' means office sent it; anything else is crew
  const fromCrew = msg.sender !== 'office';
  return (
    <View
      style={[
        msgStyles.bubble,
        fromCrew ? msgStyles.bubbleRight : msgStyles.bubbleLeft,
      ]}
    >
      {!fromCrew && (
        <Text style={msgStyles.sender}>Office</Text>
      )}
      <Text
        style={[
          msgStyles.text,
          fromCrew ? msgStyles.textRight : msgStyles.textLeft,
        ]}
      >
        {msg.body}
      </Text>
      <Text style={[msgStyles.time, fromCrew ? msgStyles.timeRight : msgStyles.timeLeft]}>
        {formatTime(msg.createdAt)}
      </Text>
    </View>
  );
}

const msgStyles = StyleSheet.create({
  bubble: {
    maxWidth: '78%',
    marginVertical: 4,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
    backgroundColor: '#1C3050',
    borderBottomLeftRadius: 4,
  },
  bubbleRight: {
    alignSelf: 'flex-end',
    backgroundColor: '#B4FF44',
    borderBottomRightRadius: 4,
  },
  sender: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#8CA0B9',
    marginBottom: 3,
  },
  text: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  textLeft: { color: '#F4F7F9' },
  textRight: { color: '#07101E' },
  time: { fontSize: 11, marginTop: 3 },
  timeLeft: { color: '#435A7D' },
  timeRight: { color: '#435A7D' },
});

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  const { data: messages, isLoading, refetch } = useListPortalMessages(token!, {
    query: { enabled: !!token, refetchInterval: 15_000, queryKey: getListPortalMessagesQueryKey(token!) },
  });

  const { mutateAsync: send, isPending } = useSendPortalMessage();
  const { mutateAsync: markSeen } = useMarkPortalSeen();

  useEffect(() => {
    if (token) {
      markSeen({ token, data: { section: 'messages' } }).catch(() => {});
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async () => {
    const body = text.trim();
    if (!body || !token || isPending) return;
    setText('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await send({ token, data: { body } });
      refetch();
    } catch {
      setText(body);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const sorted = [...(messages ?? [])].sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
  );

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {isLoading ? (
        <View style={s.loading}>
          <ActivityIndicator color="#B4FF44" />
        </View>
      ) : sorted.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="chatbubbles-outline" size={48} color="#435A7D" />
          <Text style={s.emptyTitle}>No messages yet</Text>
          <Text style={s.emptyBody}>
            Send your office a message — they'll see it right away.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={sorted}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble msg={item} />}
          contentContainerStyle={[
            s.list,
            { paddingBottom: 16 + insets.bottom },
          ]}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
        />
      )}

      {/* Input bar */}
      <View
        style={[
          s.inputBar,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <TextInput
          style={s.input}
          value={text}
          onChangeText={setText}
          placeholder="Message your office…"
          placeholderTextColor="#435A7D"
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <Pressable
          style={({ pressed }) => [
            s.sendBtn,
            (!text.trim() || isPending) && s.sendBtnDisabled,
            pressed && { opacity: 0.8 },
          ]}
          onPress={handleSend}
          disabled={!text.trim() || isPending}
        >
          {isPending ? (
            <ActivityIndicator size="small" color="#07101E" />
          ) : (
            <Ionicons name="arrow-up" size={20} color="#07101E" />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07101E' },
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
  list: { paddingHorizontal: 16, paddingTop: 16 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(140,160,185,0.12)',
    backgroundColor: '#07101E',
  },
  input: {
    flex: 1,
    backgroundColor: '#13223A',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#F4F7F9',
    maxHeight: 120,
    borderWidth: 1,
    borderColor: 'rgba(140,160,185,0.14)',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#B4FF44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: 'rgba(140,160,185,0.15)' },
});
