import type { Metadata } from 'next';
import { ChatPage } from '@/components/chat/chat-page';

export const metadata: Metadata = {
  title: 'Chat · Jarxis',
  description: 'A space to think, write, and explore with Jarxis.',
};
export default function Page() {
  return <ChatPage />;
}
