'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import PublicSite from '../components/PublicSite';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Clock3,
  Copy,
  Crosshair,
  Database,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Route,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  Users,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SAMPLES = [
  { label: 'Wuse II landmark', query: 'Yellow duplex opposite AP filling station near Banex Junction off Aminu Kano Crescent, Wuse 2, Abuja' },
  { label: 'Garki Area 11', query: 'Yellow building opposite Central Mosque gate near NNPC station, Gimbiya Street, Garki Area 11' },
  { label: 'Lekki Phase 1', query: '14B Admiralty Way opposite Ebeano Supermarket near Lekki-Ikoyi Link Bridge, Lekki Phase 1' },
  { label: 'Ado-Ekiti reference', query: 'NTA Road, back of Fabian Hotel, Basiri axis, Ado Ekiti (EK-01-A03-FK-01)' },
];

type View = 'resolve' | 'quality' | 'verification' | 'ml';

function duration(seconds?: number | null) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const value = Math.max(0, Math.round(seconds));
  return value >= 60 ? `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, '0')}s` : `${value}s`;
}

function sourceLabel(source?: string) {
  if (!source) return 'Awaiting resolution';
  if (source === 'LOCAL_DEVELOPMENT_FIXTURE') return 'Development fixture';
  return 'NIPOST response';
}

export default function ResolveGridRoute() {
  const pathname = usePathname();
  return pathname === '/' ? <PublicSite page="home" /> : <ResolveGridConsole />;
}

function ResolveGridConsole() {
  const [view, setView] = useState<View>('resolve');
  const [query, setQuery] = useState(SAMPLES[0].query);
  const [resolution, setResolution] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any>(null);
  const [mlStatus, setMlStatus] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [tenantId, setTenantId] = useState('tenant_logistics_ng');
  const [resolving, setResolving] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatch, setDispatch] = useState<any>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [evalReport, setEvalReport] = useState<any>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [batchInput, setBatchInput] = useState(SAMPLES.map((sample) => sample.query).join('\n'));
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  const fetchOperationalState = useCallback(async () => {
    try {
      const [accuracy, agentsResponse, tenantsResponse, mlResponse] = await Promise.all([
        fetch(`${API_URL}/v1/telemetry/live-accuracy`),
        fetch(`${API_URL}/v1/agents`),
        fetch(`${API_URL}/v1/tenants`),
        fetch(`${API_URL}/v1/ml/status`),
      ]);
      if (accuracy.ok) setTelemetry(await accuracy.json());
      if (agentsResponse.ok) setAgents((await agentsResponse.json()).data || []);
      if (tenantsResponse.ok) setTenants((await tenantsResponse.json()).data || []);
      if (mlResponse.ok) setMlStatus(await mlResponse.json());
    } catch {
      setError('The operations API is unavailable. Refresh the page to try again.');
    }
  }, []);

  useEffect(() => {
    fetchOperationalState();
    const poll = window.setInterval(fetchOperationalState, 15_000);
    return () => window.clearInterval(poll);
  }, [fetchOperationalState]);

  const resolve = useCallback(async (nextQuery = query) => {
    if (!nextQuery.trim()) return;
    setResolving(true);
    setError('');
    setDispatch(null);
    try {
      const response = await fetch(`${API_URL}/v1/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: nextQuery }),
      });
      if (!response.ok) throw new Error('Unable to resolve that address.');
      setResolution(await response.json());
      await fetchOperationalState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to resolve that address.');
    } finally {
      setResolving(false);
    }
  }, [fetchOperationalState, query]);

  const runDispatch = async () => {
    if (!resolution?.primary_match?.postcode) return;
    setDispatching(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/v1/tasks/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `resolvegrid_${Date.now()}` },
        body: JSON.stringify({ tenant_id: tenantId, raw_address: query, postcode: resolution.primary_match.postcode }),
      });
      if (!response.ok) throw new Error('Unable to create a dispatch task.');
      setDispatch(await response.json());
      await fetchOperationalState();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create a dispatch task.');
    } finally {
      setDispatching(false);
    }
  };

  const copyAddress = async () => {
    if (!resolution?.standardized_address_block?.formatted_copy_block) return;
    await navigator.clipboard.writeText(resolution.standardized_address_block.formatted_copy_block);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const runEvals = async () => {
    setEvalRunning(true);
    try {
      const response = await fetch(`${API_URL}/v1/evals/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('Evaluation suite was unavailable.');
      setEvalReport(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evaluation suite was unavailable.');
    } finally {
      setEvalRunning(false);
    }
  };

  const runBatch = async () => {
    const addresses = batchInput.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!addresses.length) return;
    setBatchLoading(true);
    try {
      const response = await fetch(`${API_URL}/v1/resolve/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addresses }),
      });
      if (!response.ok) throw new Error('Batch resolution was unavailable.');
      setBatchResults((await response.json()).results || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Batch resolution was unavailable.');
    } finally {
      setBatchLoading(false);
    }
  };

  const primary = resolution?.primary_match;
  const address = resolution?.standardized_address_block;
  const parts = primary?.postcode?.split('-') || [];
  const tasks = telemetry?.tasks || [];
  const verifiedCount = telemetry?.rolling_24h_metrics?.verified_ground_truth_arrivals || 0;
  const activeAgents = agents.filter((agent) => agent.status === 'AVAILABLE');
  const trace = resolution?.agent_trace?.steps || [];
  const bestCandidate = dispatch?.ranked_candidates?.[0];
  const sourceIsFixture = primary?.source === 'LOCAL_DEVELOPMENT_FIXTURE';
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === tenantId), [tenantId, tenants]);

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Primary navigation">
        <div className="brand-mark">RG</div>
        <nav className="rail-nav">
          <button className={view === 'resolve' ? 'rail-button active' : 'rail-button'} onClick={() => setView('resolve')} aria-label="Resolver"><Crosshair size={18} /></button>
          <button className={view === 'quality' ? 'rail-button active' : 'rail-button'} onClick={() => setView('quality')} aria-label="Quality"><BarChart3 size={18} /></button>
          <button className={view === 'verification' ? 'rail-button active' : 'rail-button'} onClick={() => setView('verification')} aria-label="Verification"><ShieldCheck size={18} /></button>
          <button className={view === 'ml' ? 'rail-button active' : 'rail-button'} onClick={() => setView('ml')} aria-label="Model telemetry"><Activity size={18} /></button>
        </nav>
        <div className="rail-status"><Activity size={17} /><span className="status-dot" /></div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="identity">
            <div><strong>ResolveGrid</strong><span className="engine-badge">Operations console</span></div>
            <p><span className="status-dot" /> NIPOST integration <span className="topbar-divider">/</span> <span>{sourceIsFixture ? 'fixture mode' : 'ready for resolution'}</span></p>
          </div>
          <nav className="view-tabs" aria-label="Workspace views">
            <button className={view === 'resolve' ? 'active' : ''} onClick={() => setView('resolve')}>1. Resolve & dispatch</button>
            <button className={view === 'quality' ? 'active' : ''} onClick={() => setView('quality')}>2. Quality checks</button>
            <button className={view === 'verification' ? 'active' : ''} onClick={() => setView('verification')}>3. Evidence tools</button>
            <button className={view === 'ml' ? 'active' : ''} onClick={() => setView('ml')}>4. ETA telemetry</button>
          </nav>
          <div className="topbar-metric"><Clock3 size={14} /> {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </header>

        <main className="content">
          {error && <div className="notice error"><AlertCircle size={16} /> {error}<button onClick={() => setError('')}>Dismiss</button></div>}

          {view === 'resolve' && <>
            <section className="dashboard-grid">
              <section className="panel resolution-panel">
                <div className="panel-heading">
                  <div><span className="eyebrow">Stage A</span><h1>Address resolution</h1><p>Turn an unstructured Nigerian address into a traceable postcode record.</p></div>
                  <div className="stepper"><span>Search</span><ChevronRight size={13} /><span>Nearby</span><ChevronRight size={13} /><span>Lookup</span><ChevronRight size={13} /><strong>Assemble</strong></div>
                </div>

                <div className="sample-row" aria-label="Address examples">
                  {SAMPLES.map((sample) => <button key={sample.label} className={sample.query === query ? 'sample active' : 'sample'} onClick={() => { setQuery(sample.query); resolve(sample.query); }}>{sample.label}</button>)}
                </div>

                <div className="resolver-form">
                  <Search size={18} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && resolve()} placeholder="Paste an address, landmark, or delivery note" aria-label="Address to resolve" />
                  <button className="primary-button" onClick={() => resolve()} disabled={resolving}><Send size={15} /> {resolving ? 'Resolving…' : 'Resolve'}</button>
                </div>

                {!primary ? <div className="empty-resolution"><ScanLine size={28} /><h2>Ready to resolve an address</h2><p>Start with a real address or one of the examples above. Results will show their data source and confidence.</p></div> : <>
                  <div className="resolution-result">
                    <div className={sourceIsFixture ? 'provenance fixture' : 'provenance verified'}><span className="status-dot" /> {sourceLabel(primary.source)} <span>•</span> confidence {Math.round((resolution.confidence || 0) * 100)}%</div>
                    <div className="postcode" aria-label={`Resolved postcode ${primary.postcode}`}>{parts.map((part: string, index: number) => <span key={`${part}-${index}`}>{index > 0 && <i>•</i>}{part}</span>)}</div>
                    <p className="address-line"><MapPin size={16} /> {address?.line_1_building || primary?.recent_house_address?.recent || 'Address record available'}{address?.line_2_locality ? `, ${address.line_2_locality}` : ''}</p>
                    {sourceIsFixture && <p className="truth-note">This is a local development fixture, not an official NIPOST verification. Connect an approved server-side NIPOST credential before using it operationally.</p>}
                  </div>

                  <div className="attribute-grid">
                    {[
                      ['State', primary.administrative_address?.state_name || '—'],
                      ['LGA', primary.administrative_address?.lga_name || '—'],
                      ['Locality', primary.administrative_address?.locality_name || '—'],
                      ['Legacy code', primary.legacy_postal_code || '—'],
                    ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                  </div>

                  <div className="result-actions"><button className="quiet-button" onClick={copyAddress}><Copy size={15} /> {copied ? 'Copied' : 'Copy standard address'}</button><span>{resolution.agent_trace?.total_tool_calls || 0} checked sources <span className="muted-separator">•</span> {Math.round(resolution.agent_trace?.total_latency_ms || 0)}ms</span></div>
                </>}
              </section>

              <aside className="panel dispatch-panel">
                <div className="panel-heading compact"><div><span className="eyebrow">Stage B</span><h2>Dispatch readiness</h2><p>Route an eligible network agent after resolution.</p></div><span className="metric-label"><Users size={14} /> {activeAgents.length} available</span></div>
                <div className="network-window">
                  <div className="network-caption"><span><Radio size={13} /> Network context</span><span>{primary ? `${primary.coordinates?.latitude?.toFixed?.(4) || '—'}, ${primary.coordinates?.longitude?.toFixed?.(4) || '—'}` : 'No target selected'}</span></div>
                  <div className="network-grid"><div className="target-node"><MapPin size={18} /><span>{primary?.postcode || 'Resolve an address'}</span></div>{activeAgents.slice(0, 4).map((agent, index) => <div className={`agent-node n${index}`} key={agent.id}><span className="status-dot" /> {agent.callsign?.split(' ')[0] || agent.id}</div>)}</div>
                </div>
                <div className="dispatch-stats"><div><span>Source</span><strong>{primary ? sourceLabel(primary.source) : '—'}</strong></div><div><span>Nearest ETA</span><strong>{bestCandidate ? duration(bestCandidate.final_predicted_eta_sec) : '—'}</strong></div></div>
                <label className="tenant-control"><span>Operating profile</span><select value={tenantId} onChange={(event) => setTenantId(event.target.value)}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
                <button className="primary-button dispatch-button" disabled={!primary || dispatching} onClick={runDispatch}><Navigation size={16} /> {dispatching ? 'Creating demo plan…' : primary ? 'Create demo dispatch plan' : 'Resolve an address first'}</button>
                {dispatch ? <div className="dispatch-confirmation"><CheckCircle2 size={17} /><div><strong>Demo plan {dispatch.task?.id || 'created'}</strong><p>{bestCandidate ? `${bestCandidate.callsign} ranked first • ${duration(bestCandidate.final_predicted_eta_sec)}` : 'Plan created; candidate ranking is pending.'}</p></div></div> : <p className="panel-footnote">Demo planning is rate-limited and does not mark arrival or performance as verified.</p>}
              </aside>
            </section>

            <section className="panel ledger-panel">
              <div className="panel-heading compact"><div><span className="eyebrow">Stage C</span><h2>Arrival evidence ledger</h2><p>Only consented and verified arrivals contribute to operational accuracy.</p></div><div className="ledger-summary"><span className="status-dot" /> {verifiedCount ? `${verifiedCount} verified arrival${verifiedCount === 1 ? '' : 's'}` : 'No verified arrivals yet'}</div></div>
              {tasks.length ? <div className="table-scroll"><table><thead><tr><th>Task</th><th>Postcode</th><th>Assigned network agent</th><th>Predicted ETA</th><th>Arrival evidence</th><th>Model update</th></tr></thead><tbody>{tasks.slice(0, 6).map((task: any) => <tr key={task.id}><td><strong>{task.id}</strong><small>{new Date(task.dispatched_at).toLocaleString()}</small></td><td className="mono">{task.resolved_postcode}</td><td>{task.assigned_agent_id || 'Unassigned'}</td><td className="mono">{duration(task.predicted_eta_sec)}</td><td>{task.status === 'ARRIVED_VERIFIED' ? <span className="verified-text"><CheckCircle2 size={14} /> Verified</span> : <span className="muted">Awaiting evidence</span>}</td><td>{task.online_model_updated ? <span className="verified-text">Applied</span> : <span className="muted">Not applied</span>}</td></tr>)}</tbody></table></div> : <div className="ledger-empty"><Database size={20} /><span>No dispatches in this session. Create a task above to begin the auditable ledger.</span></div>}
            </section>
          </>}

          {view === 'quality' && <section className="tool-grid"><section className="panel tool-panel"><span className="eyebrow">Quality checks</span><h1>Address benchmark</h1><p>Run the project’s maintained benchmark. Results report the data actually available to this environment.</p><button className="primary-button" onClick={runEvals} disabled={evalRunning}><BarChart3 size={16} /> {evalRunning ? 'Running checks…' : 'Run benchmark'}</button>{evalReport && <div className="evaluation-results"><div><span>Cases</span><strong>{evalReport.summary?.total_cases ?? '—'}</strong></div><div><span>Exact matches</span><strong>{evalReport.summary?.exact_building_matches ?? '—'}</strong></div><div><span>Accuracy</span><strong>{evalReport.summary?.accuracy_pct !== undefined ? `${evalReport.summary.accuracy_pct}%` : '—'}</strong></div></div>}</section><section className="panel trace-panel"><span className="eyebrow">Resolution trace</span><h2>Most recent tool chain</h2>{trace.length ? trace.map((step: any) => <div className="trace-row" key={step.step}><span>{step.step}</span><div><strong>{step.tool_name}</strong><p>{step.output_summary}</p></div><small>{step.status}</small></div>) : <div className="empty-inline"><Route size={20} /> Resolve an address to inspect the tool trace.</div>}</section></section>}

          {view === 'verification' && <section className="tool-grid"><section className="panel tool-panel"><span className="eyebrow">Batch operations</span><h1>Address scrubber</h1><p>Resolve one address per line. Each result retains its source label.</p><textarea value={batchInput} onChange={(event) => setBatchInput(event.target.value)} aria-label="Addresses to resolve in batch" /><button className="primary-button" onClick={runBatch} disabled={batchLoading}><Clipboard size={16} /> {batchLoading ? 'Resolving…' : 'Run batch resolution'}</button>{batchResults.length > 0 && <div className="batch-results">{batchResults.slice(0, 6).map((item: any, index) => <div key={index}><span>{item.primary_match?.postcode || item.postcode || 'No match'}</span><small>{sourceLabel(item.primary_match?.source)}</small></div>)}</div>}</section><section className="panel tool-panel"><span className="eyebrow">Consent-first evidence</span><h2>Protected evidence and KYC</h2><p>Field evidence is submitted only through the authenticated mobile app. KYC pass creation and task verification are protected server operations, not public browser tools.</p><div className="field-callout"><ShieldCheck size={18} /><span>For a real field visit, use the mobile app with a provisioned field identity and an official NIPOST result.</span></div></section></section>}

          {view === 'ml' && <section className="ml-layout"><section className="panel ml-overview"><div className="panel-heading compact"><div><span className="eyebrow">ETA telemetry</span><h1>Explainable ETA baseline</h1><p>Operational factors are visible. The service does not claim a trained model before it has verified arrival data.</p></div><span className={mlStatus?.available ? 'ml-status good' : 'ml-status'}><span className="status-dot" /> {mlStatus?.available ? 'Engine online' : 'Status unavailable'}</span></div><div className="ml-metrics"><div><span>Baseline</span><strong>{mlStatus?.champion_model || 'Loading…'}</strong></div><div><span>Online learner</span><strong>{mlStatus?.challenger_model || 'Loading…'}</strong></div><div><span>Verified samples</span><strong>{mlStatus?.online_samples_learned ?? '—'}</strong></div><div><span>Rolling MAE</span><strong>{mlStatus?.online_samples_learned ? duration(mlStatus?.rolling_mae_sec) : 'Not measured yet'}</strong></div></div></section><section className="panel ml-factors"><span className="eyebrow">Configured ETA factors</span><h2>What affects each estimate</h2><p>These are baseline factor weights, not learned feature importance claims.</p><div className="factor-list">{Object.entries(mlStatus?.feature_importances || {}).map(([factor, weight]: [string, any]) => <div key={factor}><span>{factor.replaceAll('_', ' ')}</span><div><i style={{ width: `${Math.round(Number(weight) * 100)}%` }} /><strong>{Math.round(Number(weight) * 100)}%</strong></div></div>)}</div></section><section className="panel ml-comparison"><span className="eyebrow">Most recent demo plan</span><h2>ETA comparison</h2>{bestCandidate ? <><div className="eta-comparison"><div><span>Route baseline</span><strong>{duration(bestCandidate.champion_lgbm_eta_sec)}</strong></div><div><span>Online-corrected</span><strong>{duration(bestCandidate.challenger_river_eta_sec)}</strong></div><div><span>Blended ETA</span><strong>{duration(bestCandidate.final_predicted_eta_sec)}</strong></div></div><div className="factor-chips"><span>Road {duration(bestCandidate.osrm_base_duration_sec)}</span><span>Gate {duration(bestCandidate.gate_delay_sec)}</span><span>Weather +{duration(bestCandidate.weather_penalty_sec)}</span></div></> : <div className="empty-inline"><Route size={20} /> Create a demo dispatch plan to inspect the ETA factors.</div>}</section></section>}
        </main>
        <footer className="footer"><span>ResolveGrid operations console</span><span>Source-aware results • consent-first evidence</span></footer>
      </div>
    </div>
  );
}
