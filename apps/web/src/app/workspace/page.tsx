import type { Metadata } from 'next';
import { WorkspaceHome } from '../../components/OperatorAccess';

export const metadata: Metadata = { title: 'Workspace', robots: { index: false } };

export default function WorkspacePage() { return <WorkspaceHome />; }
