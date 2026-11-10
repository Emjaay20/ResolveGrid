import type { Metadata } from 'next';
import PublicSite from '../../components/PublicSite';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What ResolveGrid collects during the pilot, why, and the choices people have.',
};

export default function PrivacyPage() {
  return <PublicSite page="privacy" />;
}
