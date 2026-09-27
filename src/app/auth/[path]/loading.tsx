import { AuthCardSkeleton } from '@/components/skeletons';

// Nested inside src/app/auth/layout.tsx, which already provides the header, the centred
// <main> frame and the footer — so only the card itself is a placeholder here.
export default function Loading() {
  return <AuthCardSkeleton />;
}
