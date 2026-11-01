'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Copy, LoaderCircle, LogOut, Plus, ShieldCheck, Users } from 'lucide-react';

type Workspace = { tenant_id: string; tenant_name: string; role: 'OWNER' | 'DISPATCHER' | 'REVIEWER' };
type Session = { user: { display_name: string; email: string }; workspaces: Workspace[] };
type FieldAgent = { agent_id: string; display_name: string; email: string; active: boolean };

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'include', ...options });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { response, data };
}

export function OperatorSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { response, data } = await api('/v1/auth/operator/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!response.ok) { setError(data.error || 'Unable to sign in.'); return; }
    const next = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('next');
    router.replace(next?.startsWith('/') ? next : '/workspace');
  }

  return <main className="access-shell"><section className="access-aside"><Link href="/" className="public-brand"><span>RG</span> ResolveGrid</Link><div><p className="public-kicker"><span /> Pilot access</p><h1>Operations access for approved teams.</h1><p>Owners and dispatchers sign in here. Field agents use the mobile app with a provisioned account.</p></div><div className="access-aside-note"><ShieldCheck size={18} /><span>There is no public operational sign-up. Workspace owners invite their team.</span></div></section><section className="access-card-wrap"><form className="access-card" onSubmit={submit}><p className="public-kicker">Operator sign in</p><h2>Welcome back.</h2><p>Use the email and password issued for your pilot workspace.</p><label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="access-error">{error}</div>}<button className="public-primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <>Sign in <ArrowRight size={16} /></>}</button><small>Need access? Ask your workspace owner for an invitation link.</small><Link href="/start" className="inline-link">How access works <ArrowRight size={15} /></Link></form></section></main>;
}

export function InviteAcceptance() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') || '');
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    const { response, data } = await api('/v1/workspace-invitations/accept', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, display_name: displayName, password }),
    });
    setBusy(false);
    if (!response.ok) { setError(data.error || 'Unable to accept this invitation.'); return; }
    router.replace('/workspace');
  }

  return <main className="access-shell"><section className="access-aside"><Link href="/" className="public-brand"><span>RG</span> ResolveGrid</Link><div><p className="public-kicker"><span /> Pilot invitation</p><h1>Join a ResolveGrid workspace.</h1><p>This invitation creates an operator account for the workspace that invited you.</p></div></section><section className="access-card-wrap"><form className="access-card" onSubmit={submit}><p className="public-kicker">Set up access</p><h2>Create your password.</h2><p>Your workspace role will be assigned from the invitation.</p><label>Display name<input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>Password<input type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{!token && <div className="access-error">This invitation link is incomplete.</div>}{error && <div className="access-error">{error}</div>}<button className="public-primary" disabled={busy || !token}>{busy ? <LoaderCircle className="spin" size={16} /> : <>Join workspace <ArrowRight size={16} /></>}</button><small>Passwords must be at least 12 characters.</small></form></section></main>;
}

export function WorkspaceHome() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [fieldAgents, setFieldAgents] = useState<FieldAgent[]>([]);
  const [selectedFieldAgent, setSelectedFieldAgent] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [dispatchNotice, setDispatchNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'DISPATCHER' | 'REVIEWER'>('DISPATCHER');
  const [inviteLink, setInviteLink] = useState('');
  const [address, setAddress] = useState('');
  const [sending, setSending] = useState(false);
  const [fieldAgentId, setFieldAgentId] = useState('');
  const [fieldAgentName, setFieldAgentName] = useState('');
  const [fieldAgentEmail, setFieldAgentEmail] = useState('');
  const [fieldAgentPassword, setFieldAgentPassword] = useState('');
  const [fieldAgentNotice, setFieldAgentNotice] = useState('');

  useEffect(() => {
    api('/v1/auth/operator/me').then(({ response, data }) => {
      if (!response.ok) { router.replace('/sign-in?next=/workspace'); return; }
      setSession(data.session);
      setSelectedId(data.session.workspaces[0]?.tenant_id || '');
      setLoading(false);
    }).catch(() => { router.replace('/sign-in?next=/workspace'); });
  }, [router]);

  const workspace = useMemo(() => session?.workspaces.find((item) => item.tenant_id === selectedId) || null, [session, selectedId]);
  useEffect(() => {
    if (!workspace) return;
    api(`/v1/workspaces/${workspace.tenant_id}/tasks`).then(({ response, data }) => {
      if (response.ok) setTasks(data.data || []);
    });
  }, [workspace]);

  const loadFieldAgents = async (workspaceId: string) => {
    const { response, data } = await api(`/v1/workspaces/${workspaceId}/field-agents`);
    if (response.ok) setFieldAgents(data.data || []);
  };
  useEffect(() => {
    if (!workspace) return;
    loadFieldAgents(workspace.tenant_id);
    setSelectedFieldAgent('');
  }, [workspace]);

  async function signOut() {
    await api('/v1/auth/operator/logout', { method: 'POST' });
    router.replace('/');
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setNotice(''); setInviteLink('');
    const { response, data } = await api(`/v1/workspaces/${workspace.tenant_id}/invitations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    });
    if (!response.ok) { setNotice(data.error || 'Unable to create invitation.'); return; }
    setInviteLink(`${window.location.origin}${data.invitation.accept_url}`);
    setInviteEmail('');
  }

  async function createDispatch(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !address.trim()) return;
    setSending(true); setDispatchNotice('');
    const { response, data } = await api(`/v1/workspaces/${workspace.tenant_id}/dispatch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `workspace_${Date.now()}` }, body: JSON.stringify({ raw_address: address, ...(selectedFieldAgent ? { field_agent_id: selectedFieldAgent } : {}) }),
    });
    setSending(false);
    if (!response.ok) { setDispatchNotice(data.error || 'Unable to create dispatch plan.'); return; }
    setDispatchNotice(`Dispatch plan ${data.task?.id || 'created'} successfully.`);
    setAddress('');
    const refreshed = await api(`/v1/workspaces/${workspace.tenant_id}/tasks`);
    if (refreshed.response.ok) setTasks(refreshed.data.data || []);
  }

  async function provisionFieldAgent(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setFieldAgentNotice('');
    const { response, data } = await api(`/v1/workspaces/${workspace.tenant_id}/field-agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: fieldAgentId, display_name: fieldAgentName, email: fieldAgentEmail, password: fieldAgentPassword }),
    });
    if (!response.ok) { setFieldAgentNotice(data.error || 'Unable to provision this field agent.'); return; }
    setFieldAgentNotice(`${data.agent.display_name} can now sign in to the field app.`);
    setFieldAgentId(''); setFieldAgentName(''); setFieldAgentEmail(''); setFieldAgentPassword('');
    await loadFieldAgents(workspace.tenant_id);
  }

  if (loading || !session) return <main className="workspace-loading"><LoaderCircle className="spin" size={22} /> Checking secure workspace access…</main>;
  if (!workspace) return <main className="workspace-loading">Your account has no active workspace. Ask a pilot owner for an invitation.</main>;
  const canDispatch = workspace.role === 'OWNER' || workspace.role === 'DISPATCHER';

  return (
    <main className="workspace-page">
      <header className="workspace-header"><Link href="/" className="public-brand"><span>RG</span> ResolveGrid</Link><div className="workspace-user"><span>{session.user.display_name}</span><button onClick={signOut}><LogOut size={15} /> Sign out</button></div></header>
      <section className="workspace-hero"><div><p className="public-kicker"><span /> Approved pilot workspace</p><h1>{workspace.tenant_name}</h1><p>{workspace.role.toLowerCase()} access · Operations are attributed to your workspace.</p></div><div className="workspace-switcher">{session.workspaces.map((item) => <button key={item.tenant_id} onClick={() => setSelectedId(item.tenant_id)} className={item.tenant_id === workspace.tenant_id ? 'active' : ''}>{item.tenant_name}</button>)}</div></section>
      <section className="workspace-grid">
        <article className="workspace-panel dispatch-workspace">
          <p className="public-kicker">Dispatch</p><h2>Create a workspace dispatch plan</h2><p>Resolve an address, assign a field agent when needed, and create a protected plan.</p>
          {canDispatch ? <form onSubmit={createDispatch}><textarea value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Paste an address, landmark, or delivery note" required /><select aria-label="Assigned field agent" value={selectedFieldAgent} onChange={(event) => setSelectedFieldAgent(event.target.value)}><option value="">No field-agent assignment</option>{fieldAgents.filter((agent) => agent.active).map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.display_name} · {agent.agent_id}</option>)}</select><button className="public-primary" disabled={sending}>{sending ? <LoaderCircle className="spin" size={16} /> : <>Create plan <ArrowRight size={16} /></>}</button></form> : <p className="workspace-muted">Reviewer access can view activity but cannot create dispatch plans.</p>}
          {!fieldAgents.length && <p className="workspace-muted">No field agents are linked yet. An Owner can create one below.</p>}{dispatchNotice && <p className="workspace-message">{dispatchNotice}</p>}<Link href="/console" className="inline-link">Open public product demo <ArrowRight size={15} /></Link>
        </article>
        <article className="workspace-panel"><p className="public-kicker">Recent activity</p><h2>{tasks.length ? `${tasks.length} workspace plan${tasks.length === 1 ? '' : 's'}` : 'No plans yet'}</h2><div className="task-list">{tasks.slice(0, 5).map((task) => <div key={task.id}><strong>{task.resolved_postcode}</strong><span>{task.status.replaceAll('_', ' ')} · {task.assigned_agent_callsign || 'Assignment pending'}</span></div>)}{!tasks.length && <p className="workspace-muted">Your protected dispatch plans will appear here.</p>}</div></article>
        {workspace.role === 'OWNER' && <>
          <article className="workspace-panel invite-panel"><p className="public-kicker">Field team</p><h2>Provision a field agent</h2><p>This creates a mobile-only field identity and links it directly to {workspace.tenant_name}.</p><form onSubmit={provisionFieldAgent} className="field-agent-form"><input value={fieldAgentId} onChange={(event) => setFieldAgentId(event.target.value)} placeholder="field_yusuf_01" required /><input value={fieldAgentName} onChange={(event) => setFieldAgentName(event.target.value)} placeholder="Field agent name" required /><input type="email" value={fieldAgentEmail} onChange={(event) => setFieldAgentEmail(event.target.value)} placeholder="field@example.com" required /><input type="password" minLength={12} value={fieldAgentPassword} onChange={(event) => setFieldAgentPassword(event.target.value)} placeholder="Temporary password (12+ chars)" required /><button className="public-secondary"><Plus size={15} /> Add field agent</button></form>{fieldAgents.length > 0 && <p className="workspace-muted">Linked: {fieldAgents.map((agent) => `${agent.display_name} (${agent.agent_id})`).join(', ')}</p>}{fieldAgentNotice && <p className="workspace-notice">{fieldAgentNotice}</p>}</article>
          <article className="workspace-panel invite-panel"><p className="public-kicker">Team access</p><h2>Invite an operator</h2><p>Share the generated one-time link through an approved channel. Email sending can be connected next.</p><form onSubmit={createInvite}><input type="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'DISPATCHER' | 'REVIEWER')}><option value="DISPATCHER">Dispatcher</option><option value="REVIEWER">Reviewer</option></select><button className="public-secondary"><Plus size={15} /> Create invitation</button></form>{inviteLink && <div className="invite-result"><CheckCircle2 size={17} /><div><strong>Invitation ready</strong><code>{inviteLink}</code></div><button aria-label="Copy invitation link" onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={15} /></button></div>}{notice && <p className="workspace-notice">{notice}</p>}</article>
        </>}
      </section>
      <footer className="workspace-footer"><Users size={15} /> Invitation-only pilot access · Assigned field agents continue work in the mobile app.</footer>
    </main>
  );
}
