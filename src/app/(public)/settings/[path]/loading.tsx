import { SettingsSkeleton } from '@/components/skeletons';

// The (public) layout provides the chrome and src/app/(public)/settings/layout.tsx the
// container, so only the settings panels themselves are placeholders here.
export default function Loading() {
  return <SettingsSkeleton />;
}
