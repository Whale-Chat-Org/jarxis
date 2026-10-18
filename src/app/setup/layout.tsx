import { PublicAuthFrame } from '@/components/auth/public-auth-frame';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <PublicAuthFrame>{children}</PublicAuthFrame>;
}
