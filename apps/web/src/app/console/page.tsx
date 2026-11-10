import type { Metadata } from 'next';
import ConsoleApp from '../page';

export const metadata: Metadata = {
  title: 'Demo console',
  description: 'Resolve a Nigerian address into a source-labelled postcode record and plan a demo dispatch.',
};

export default function ConsolePage() { return <ConsoleApp />; }
