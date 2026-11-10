import type { Metadata } from 'next';
import { InviteAcceptance } from '../../components/OperatorAccess';

export const metadata: Metadata = { title: 'Accept invitation', robots: { index: false } };

export default function JoinPage() { return <InviteAcceptance />; }
