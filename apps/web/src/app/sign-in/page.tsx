import type { Metadata } from 'next';
import { OperatorSignIn } from '../../components/OperatorAccess';

export const metadata: Metadata = { title: 'Pilot sign in', robots: { index: false } };

export default function SignInPage() { return <OperatorSignIn />; }
