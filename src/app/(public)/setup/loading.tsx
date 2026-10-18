import { AuthCardSkeleton } from '@/components/skeletons';

// The (public) layout renders the header and footer and src/app/(public)/setup/layout.tsx the
// centred <main> frame, so only the card is a placeholder here. The page defers to
// request time (`connection()`), so this is what streams while the status is resolved.
export default function Loading() {
  return <AuthCardSkeleton />;
}
