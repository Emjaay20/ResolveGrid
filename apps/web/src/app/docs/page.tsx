import type { Metadata } from 'next';
import PublicSite from '../../components/PublicSite';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'How ResolveGrid is designed: architecture, data flow, decisions and current limits.',
};

export default function DocumentationPage() {
  return <PublicSite page="docs" />;
}
