import { PublicAuthFrame } from '@/components/auth/public-auth-frame';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <PublicAuthFrame>{children}</PublicAuthFrame>;
}
