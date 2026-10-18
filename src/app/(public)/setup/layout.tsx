import { AuthFrame } from '@/components/auth/auth-frame';

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
