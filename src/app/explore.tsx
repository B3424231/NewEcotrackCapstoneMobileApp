import { Redirect } from 'expo-router';

// Old links return to Home; the dedicated mobile control screen has been removed.
export default function ExploreScreen() {
  return <Redirect href="/" />;
}
