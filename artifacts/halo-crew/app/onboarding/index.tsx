import { Redirect } from 'expo-router';

// Welcome slides and one-time onboarding content are sent as separate links.
// The only gate before using the crew app is the field operations agreement.
export default function OnboardingIndex() {
  return <Redirect href="/onboarding/agreement" />;
}
