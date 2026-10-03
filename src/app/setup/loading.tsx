import { AuthCardSkeleton } from '@/components/skeletons';

// Nested inside src/app/setup/layout.tsx, which already renders the header, the centred
// <main> frame and the footer, so only the card is a placeholder here. The page defers to
// request time (`connection()`), so this is what streams while the status is resolved.
export default function Loading() {
  return <AuthCardSkeleton />;
}
