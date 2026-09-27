import { SettingsSkeleton } from '@/components/skeletons';

// Nested inside src/app/settings/layout.tsx, which already provides the chrome and the
// container — so only the settings panels themselves are placeholders here.
export default function Loading() {
  return <SettingsSkeleton />;
}
