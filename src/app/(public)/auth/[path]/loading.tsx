import { AuthCardSkeleton } from '@/components/skeletons';

// The (public) layout provides the header and footer and src/app/(public)/auth/layout.tsx the
// centred <main> frame, so only the card itself is a placeholder here.
export default function Loading() {
  return <AuthCardSkeleton />;
}
