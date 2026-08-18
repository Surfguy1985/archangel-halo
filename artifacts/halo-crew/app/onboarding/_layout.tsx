import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: '#07101E' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="instructions" />
      <Stack.Screen name="agreement" />
      <Stack.Screen name="selfie" />
    </Stack>
  );
}
