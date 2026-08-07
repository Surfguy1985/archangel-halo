import { Stack } from 'expo-router';

export default function MoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#07101E' },
        headerTintColor: '#F4F7F9',
        headerTitleStyle: {
          fontFamily: 'Inter_600SemiBold',
          color: '#F4F7F9',
        },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#07101E' },
      }}
    >
      <Stack.Screen name="messages" options={{ title: 'Messages' }} />
      <Stack.Screen name="schedule" options={{ title: 'Schedule' }} />
      <Stack.Screen name="invoice" options={{ title: 'Crew Invoice' }} />
      <Stack.Screen name="pay" options={{ title: 'My Pay' }} />
      <Stack.Screen name="wings" options={{ title: 'Wings Program' }} />
      <Stack.Screen name="guide" options={{ title: 'Guide' }} />
      <Stack.Screen name="offers" options={{ title: 'Job Offers' }} />
      <Stack.Screen name="docs" options={{ title: 'Documents' }} />
    </Stack>
  );
}
