import type { Metadata } from 'next';
import PublicSite from '../../components/PublicSite';

export const metadata: Metadata = {
  title: 'How to use',
  description: 'Which ResolveGrid access path fits explorers, pilot operators and field agents.',
};

export default function StartPage() {
  return <PublicSite page="start" />;
}
