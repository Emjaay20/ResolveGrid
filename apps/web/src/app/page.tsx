'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  MapPin,
  Cpu,
  ShieldCheck,
  Navigation,
  Activity,
  CheckCircle2,
  Zap,
  Layers,
  KeyRound,
  RefreshCw,
  Copy,
  Send,
  BarChart3,
  Building2,
  Radio,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const SAMPLE_ADDRESSES = [
  {
    label: 'Abuja (Wuse II Landmark)',
    query: 'Yellow duplex opposite AP filling station near Banex Junction off Aminu Kano Crescent, Wuse 2, Abuja',
  },
  {
    label: 'Abuja (Garki Area 11)',
    query: 'Yellow building opposite Central Mosque gate near NNPC station, Gimbiya Street, Garki Area 11',
  },
  {
    label: 'Lagos (Lekki Phase 1)',
    query: '14B Admiralty Way opposite Ebeano Supermarket near Lekki-Ikoyi Link Bridge, Lekki Phase 1',
  },
  {
    label: 'Lagos (Victoria Island)',
    query: 'Beside Zenith Bank HQ, 290 Akin Adesola Street off Adeola Odeku, Victoria Island, Lagos',
  },
  {
    label: 'Ado-Ekiti (Official NIPOST Sandbox)',
    query: 'NTA Road, back of Fabian Hotel, Basiri axis, Ado Ekiti (EK-01-A03-FK-01)',
  },
  {
    label: 'Lagos (Sabo Yaba Tech Zone)',
    query: '294 Herbert Macaulay Way near Sabo Bus Stop and CcHUB, Yaba, Lagos',
  },
];

export default function ResolveGridConsole() {
  const [activeTab, setActiveTab] = useState<'console' | 'evals' | 'kyc_b2b'>('console');
  const [nipostKey, setNipostKey] = useState<string>('');
  const [query, setQuery] = useState<string>(SAMPLE_ADDRESSES[0].query);
  const [selectedTenant, setSelectedTenant] = useState<string>('tenant_logistics_ng');

  const [resolving, setResolving] = useState<boolean>(false);
  const [resolution, setResolution] = useState<any>(null);

  const [dispatching, setDispatching] = useState<boolean>(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  const [telemetry, setTelemetry] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);

  const [evalRunning, setEvalRunning] = useState<boolean>(false);
  const [evalReport, setEvalReport] = useState<any>(null);

  const [kycApplicant, setKycApplicant] = useState<string>('MERCHANT-NG-88412');
  const [kycClaimedCode, setKycClaimedCode] = useState<string>('FC-02-A09-DB-09');
  const [kycLat, setKycLat] = useState<string>('9.07874');
  const [kycLng, setKycLng] = useState<string>('7.47018');
  const [kycResult, setKycResult] = useState<any>(null);
  const [kycLoading, setKycLoading] = useState<boolean>(false);

  const [batchInput, setBatchInput] = useState<string>(
    [
      'Yellow duplex opposite AP filling station off Aminu Kano Crescent Wuse 2',
      '14B Admiralty Way opposite Ebeano Supermarket Lekki Phase 1',
      'NTA Road back of Fabian Hotel Ado Ekiti',
      '18 Gimbiya Street opposite Central Mosque gate Garki Area 11',
    ].join('\n')
  );
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchLoading, setBatchLoading] = useState<boolean>(false);
  const [copiedBlock, setCopiedBlock] = useState<boolean>(false);

  const buildHeaders = useCallback(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (nipostKey.trim()) {
      h['X-Nipost-Key'] = nipostKey.trim();
    }
    return h;
  }, [nipostKey]);

  const fetchLiveState = useCallback(async () => {
    try {
      const [accRes, agRes, tenRes] = await Promise.all([
        fetch(`${API_URL}/v1/telemetry/live-accuracy`, { headers: buildHeaders() }),
        fetch(`${API_URL}/v1/agents`),
        fetch(`${API_URL}/v1/tenants`),
      ]);
      if (accRes.ok) setTelemetry(await accRes.json());
      if (agRes.ok) {
        const agData = await agRes.json();
        setAgents(agData.data || []);
      }
      if (tenRes.ok) {
        const tenData = await tenRes.json();
        setTenants(tenData.data || []);
      }
    } catch {
      // Ignore transient poll error while backend boots
    }
  }, [buildHeaders]);

  const handleResolve = useCallback(
    async (inputQuery?: string) => {
      const q = inputQuery ?? query;
      if (!q.trim()) return;
      setResolving(true);
      try {
        const res = await fetch(`${API_URL}/v1/resolve`, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify({ query: q }),
        });
        if (res.ok) {
          const data = await res.json();
          setResolution(data);
          await fetchLiveState();
        }
      } finally {
        setResolving(false);
      }
    },
    [query, buildHeaders, fetchLiveState]
  );

  const handleDispatch = async () => {
    setDispatching(true);
    try {
      const res = await fetch(`${API_URL}/v1/tasks/dispatch`, {
        method: 'POST',
        headers: {
          ...buildHeaders(),
          'Idempotency-Key': `idem_${Date.now()}`,
        },
        body: JSON.stringify({
          tenant_id: selectedTenant,
          raw_address: query,
          postcode: resolution?.primary_match?.postcode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDispatchResult(data);
        await fetchLiveState();
      }
    } finally {
      setDispatching(false);
    }
  };

  const handleRunEvals = async () => {
    setEvalRunning(true);
    try {
      const res = await fetch(`${API_URL}/v1/evals/run`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setEvalReport(await res.json());
      }
    } finally {
      setEvalRunning(false);
    }
  };

  const handleVerifyKyc = async (useBrowserGps = false) => {
    setKycLoading(true);
    try {
      let lat = parseFloat(kycLat);
      let lng = parseFloat(kycLng);
      let acc = 4.8;

      if (useBrowserGps && typeof navigator !== 'undefined' && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              lat = pos.coords.latitude;
              lng = pos.coords.longitude;
              acc = pos.coords.accuracy;
              setKycLat(String(lat.toFixed(6)));
              setKycLng(String(lng.toFixed(6)));
              resolve();
            },
            () => resolve(),
            { enableHighAccuracy: true, timeout: 4000 }
          );
        });
      }

      const res = await fetch(`${API_URL}/v1/kyc/verify-location`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
          applicant_ref: kycApplicant,
          claimed_postcode: kycClaimedCode,
          latitude: lat,
          longitude: lng,
          gps_accuracy_m: acc,
        }),
      });
      if (res.ok) {
        setKycResult(await res.json());
      }
    } finally {
      setKycLoading(false);
    }
  };

  const handleBatchResolve = async () => {
    setBatchLoading(true);
    try {
      const addresses = batchInput
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`${API_URL}/v1/resolve/batch`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ addresses }),
      });
      if (res.ok) {
        const data = await res.json();
        setBatchResults(data.results || []);
      }
    } finally {
      setBatchLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveState();
    handleResolve(SAMPLE_ADDRESSES[0].query);
    const timer = setInterval(fetchLiveState, 10000);
    return () => clearInterval(timer);
  }, []);

  const primary = resolution?.primary_match;
  const postcodeParts = (primary?.postcode || 'FC-02-A09-DB-09').split('-');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* ====================================================================
          TOP TELEMETRY & INFRASTRUCTURE HEADER BAR
          ==================================================================== */}
      <header
        style={{
          background: 'rgba(14, 21, 38, 0.95)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '0.85rem 1.5rem',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backdropFilter: 'blur(10px)',
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                color: '#04120c',
                fontSize: '1.15rem',
              }}
            >
              RG
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}>
                  ResolveGrid
                </span>
                <span
                  className="mono"
                  style={{
                    fontSize: '0.72rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                  }}
                >
                  NIPOST NDAPS v1 + H3 + LightGBM/River
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Autonomous National Postcode Resolution, Last-Mile Dispatch & Ground-Truth Telemetry Engine
              </div>
            </div>
          </div>

          {/* Live Telemetry Pill Metrics */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
            <div
              className="mono"
              style={{
                fontSize: '0.75rem',
                padding: '0.35rem 0.7rem',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <Radio size={13} color="#10b981" />
              <span>NIPOST Circuit:</span>
              <strong style={{ color: '#34d399' }}>
                {telemetry?.nipost_gateway?.circuit_breaker_state || 'CLOSED'}
              </strong>
            </div>

            <div
              className="mono"
              style={{
                fontSize: '0.75rem',
                padding: '0.35rem 0.7rem',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              24h MAE:{' '}
              <strong style={{ color: '#38bdf8' }}>
                {telemetry?.rolling_24h_metrics?.verified_ground_truth_arrivals
                  ? `${telemetry.rolling_24h_metrics.mean_absolute_error_sec}s`
                  : '—'}
              </strong>
            </div>

            <div
              className="mono"
              style={{
                fontSize: '0.75rem',
                padding: '0.35rem 0.7rem',
                borderRadius: 8,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              Online River Updates:{' '}
              <strong style={{ color: '#a78bfa' }}>
                {telemetry?.rolling_24h_metrics?.online_river_updates_applied ?? 0}
              </strong>
            </div>

            {/* Live NIPOST API Key Override Input */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '0.25rem 0.6rem',
              }}
            >
              <KeyRound size={13} color="#f59e0b" />
              <input
                type="password"
                value={nipostKey}
                onChange={(e) => setNipostKey(e.target.value)}
                placeholder="nipost_test_... key (optional)"
                className="mono"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-main)',
                  fontSize: '0.75rem',
                  width: 175,
                  outline: 'none',
                }}
              />
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            maxWidth: 1440,
            margin: '0.75rem auto 0',
            display: 'flex',
            gap: '0.5rem',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '0.65rem',
          }}
        >
          {[
            {
              id: 'console',
              label: '1. Live Address Intelligence & Dispatch Console',
              icon: Navigation,
            },
            {
              id: 'evals',
              label: '2. Golden Nigerian Address Benchmark (/evals)',
              icon: BarChart3,
            },
            {
              id: 'kyc_b2b',
              label: '3. Banking/KYC Location Pass & B2B Batch Scrubber',
              icon: ShieldCheck,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  if (tab.id === 'evals' && !evalReport) {
                    handleRunEvals();
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.45rem 0.95rem',
                  borderRadius: 8,
                  border: active ? '1px solid #10b981' : '1px solid var(--border-subtle)',
                  background: active ? 'rgba(16, 185, 129, 0.14)' : 'var(--bg-card)',
                  color: active ? '#34d399' : 'var(--text-muted)',
                  fontWeight: 600,
                  fontSize: '0.83rem',
                  cursor: 'pointer',
                }}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* ====================================================================
          MAIN WORKSPACE BODY
          ==================================================================== */}
      <main
        style={{
          maxWidth: 1440,
          width: '100%',
          margin: '0 auto',
          padding: '1.25rem 1.5rem 3rem',
          flex: 1,
        }}
      >
        {activeTab === 'console' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Top Split Grid: Left = NIPOST Multi-Tool Agent Resolver, Right = Spatio-Temporal Map & Dispatch */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))',
                gap: '1.25rem',
              }}
            >
              {/* LEFT PANEL: Natural Language NIPOST Resolution & 5-Segment Breakdown */}
              <section
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Cpu size={18} color="#10b981" />
                    <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>
                      Stage A: Multi-Tool NIPOST Address Resolution Agent
                    </h2>
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: '0.72rem',
                      color: '#38bdf8',
                      background: 'rgba(6, 182, 212, 0.12)',
                      padding: '0.2rem 0.55rem',
                      borderRadius: 6,
                    }}
                  >
                    Search → Nearby → L3 Lookup → Assemble
                  </span>
                </div>

                {/* Preset Nigerian Landmark Selector */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {SAMPLE_ADDRESSES.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => {
                        setQuery(s.query);
                        handleResolve(s.query);
                      }}
                      style={{
                        fontSize: '0.73rem',
                        padding: '0.28rem 0.6rem',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: query === s.query ? '#1e293b' : 'var(--bg-card)',
                        color: query === s.query ? '#38bdf8' : 'var(--text-muted)',
                        cursor: 'pointer',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* Input Box + Resolve Button */}
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Paste messy Nigerian landmark address, WhatsApp delivery note, or postcode..."
                    style={{
                      flex: 1,
                      padding: '0.7rem 0.9rem',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-main)',
                      fontSize: '0.88rem',
                    }}
                  />
                  <button
                    onClick={() => handleResolve()}
                    disabled={resolving}
                    style={{
                      padding: '0.7rem 1.15rem',
                      borderRadius: 8,
                      border: 'none',
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      color: '#04120c',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <Send size={14} />
                    {resolving ? 'Resolving...' : 'Resolve Postcode'}
                  </button>
                </div>

                {/* 5-Segment Official NIPOST Code & Legacy 6-Digit Bridge */}
                {primary && (
                  <div
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      borderRadius: 10,
                      padding: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                          Verified Official NIPOST 11-Char Digital Postcode
                        </div>
                        <div
                          className="mono"
                          style={{
                            fontSize: '1.6rem',
                            fontWeight: 800,
                            color: '#34d399',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {primary.display}
                        </div>
                        <div style={{ fontSize: '0.83rem', color: '#e2e8f0', fontWeight: 600 }}>
                          {primary.recent_house_address?.recent}
                        </div>
                      </div>

                      {/* Legacy 6-Digit Postal Zone Dual-Bridge Badge */}
                      <div
                        style={{
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid rgba(245, 158, 11, 0.4)',
                          borderRadius: 8,
                          padding: '0.5rem 0.8rem',
                          textAlign: 'right',
                        }}
                      >
                        <div style={{ fontSize: '0.68rem', color: '#fbbf24', fontWeight: 600 }}>
                          LEGACY 6-DIGIT NIPOST BRIDGE
                        </div>
                        <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fde68a' }}>
                          {primary.legacy_postal_code}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          {primary.administrative_address?.locality_name}
                        </div>
                      </div>
                    </div>

                    {/* 5-Segment Hierarchy Breakdown Pills */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: '0.45rem',
                      }}
                    >
                      {[
                        { label: 'STATE (2)', val: postcodeParts[0], sub: primary.administrative_address?.state_name },
                        { label: 'LGA (2)', val: postcodeParts[1], sub: primary.administrative_address?.lga_name },
                        { label: 'DISTRICT (3)', val: postcodeParts[2], sub: primary.administrative_address?.locality_name },
                        { label: 'AREA (2)', val: postcodeParts[3], sub: 'Spatial Zone' },
                        { label: 'UNIT (2)', val: postcodeParts[4], sub: primary.building_use_status || 'Building' },
                      ].map((seg) => (
                        <div
                          key={seg.label}
                          style={{
                            background: '#0b1221',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 8,
                            padding: '0.45rem 0.5rem',
                            textAlign: 'center',
                          }}
                        >
                          <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>{seg.label}</div>
                          <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 800, color: '#38bdf8' }}>
                            {seg.val}
                          </div>
                          <div
                            style={{
                              fontSize: '0.64rem',
                              color: '#cbd5e1',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {seg.sub}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Last-50-Meters Building Intelligence Graph */}
                    {primary.building_telemetry && (
                      <div
                        style={{
                          background: 'rgba(99, 102, 241, 0.1)',
                          border: '1px solid rgba(99, 102, 241, 0.3)',
                          borderRadius: 8,
                          padding: '0.65rem 0.85rem',
                          fontSize: '0.79rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.3rem',
                          }}
                        >
                          <span style={{ fontWeight: 700, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Building2 size={14} />
                            Last-50-Meters Building Telemetry (Indexed by {primary.postcode})
                          </span>
                          <span className="mono" style={{ fontSize: '0.72rem', color: '#34d399' }}>
                            KYC Trust: {primary.building_telemetry.kyc_trust_score}% ({primary.building_telemetry.verified_arrival_count} verified arrivals)
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', color: '#cbd5e1' }}>
                          <span>
                            Gate Clearance:{' '}
                            <strong>{primary.building_telemetry.gate_clearance_required ? 'REQUIRED' : 'Direct Street'}</strong>
                          </span>
                          <span>
                            Measured Gate Delay:{' '}
                            <strong className="mono" style={{ color: '#fbbf24' }}>
                              +{primary.building_telemetry.avg_security_check_delay_sec}s
                            </strong>
                          </span>
                          <span>
                            Compound Walk:{' '}
                            <strong className="mono">{primary.building_telemetry.compound_walk_meters}m</strong>
                          </span>
                        </div>
                        <div style={{ marginTop: '0.3rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                          Access Note: {primary.building_telemetry.building_access_notes}
                        </div>
                      </div>
                    )}

                    {/* Copy Standardized Address Block */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        H3 Res-8 Cell: <code className="mono">{primary.coordinates?.h3_res8}</code>
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(
                            resolution?.standardized_address_block?.formatted_copy_block || primary.postcode
                          );
                          setCopiedBlock(true);
                          setTimeout(() => setCopiedBlock(false), 2000);
                        }}
                        style={{
                          fontSize: '0.74rem',
                          padding: '0.3rem 0.65rem',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                          background: '#0b1221',
                          color: '#e2e8f0',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                      >
                        <Copy size={12} />
                        {copiedBlock ? 'Copied Dual-Bridge Block!' : 'Copy Standardized Address'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Agent Tool-Calling Execution Trace */}
                {resolution?.agent_trace && (
                  <div
                    style={{
                      background: '#090f1d',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: '0.85rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <span>
                        Agent Orchestrator: <strong style={{ color: '#e2e8f0' }}>{resolution.agent_trace.provider_used}</strong> ({resolution.agent_trace.model_used})
                      </span>
                      <span className="mono" style={{ color: '#34d399' }}>
                        {resolution.agent_trace.total_tool_calls} tools · {resolution.agent_trace.total_latency_ms}ms
                      </span>
                    </div>
                    <p style={{ margin: '0 0 0.6rem', fontSize: '0.78rem', color: '#cbd5e1' }}>
                      {resolution.agent_trace.reasoning_summary}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {resolution.agent_trace.steps?.map((st: any) => (
                        <div
                          key={st.step}
                          className="mono"
                          style={{
                            fontSize: '0.72rem',
                            padding: '0.35rem 0.6rem',
                            borderRadius: 6,
                            background: 'var(--bg-card)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <div>
                            <span style={{ color: '#10b981', fontWeight: 700 }}>
                              [{st.step}] {st.tool_name}
                            </span>{' '}
                            <span style={{ color: '#38bdf8' }}>({st.endpoint})</span> —{' '}
                            <span style={{ color: '#cbd5e1' }}>{st.output_summary}</span>
                          </div>
                          <span style={{ color: '#fbbf24', whiteSpace: 'nowrap' }}>{st.latency_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* RIGHT PANEL: Live Spatio-Temporal Radar Map & Two-Stage ML Dispatch */}
              <section
                style={{
                  background: 'var(--bg-panel)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 12,
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Zap size={18} color="#38bdf8" />
                    <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>
                      Stage B: Two-Stage Spatial Filter, LightGBM/River ETA & Redlock Dispatch
                    </h2>
                  </div>

                  {/* Multi-Tenant Industry Profile Selector */}
                  <select
                    value={selectedTenant}
                    onChange={(e) => setSelectedTenant(e.target.value)}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: 6,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      color: '#38bdf8',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                    }}
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.industry_vertical})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Live Interactive Vector Geospatial Radar Map */}
                <div
                  style={{
                    position: 'relative',
                    height: 245,
                    borderRadius: 10,
                    background: 'radial-gradient(circle at 50% 50%, #0f213c 0%, #070d19 100%)',
                    border: '1px solid var(--border-subtle)',
                    overflow: 'hidden',
                  }}
                >
                  <svg width="100%" height="100%" viewBox="0 0 600 245">
                    {/* Hexagonal H3 Grid Lines */}
                    <defs>
                      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path
                          d="M 40 0 L 0 0 0 40"
                          fill="none"
                          stroke="rgba(56, 189, 248, 0.08)"
                          strokeWidth="1"
                        />
                      </pattern>
                    </defs>
                    <rect width="600" height="245" fill="url(#grid)" />

                    {/* Geofence Radius Rings around Target NIPOST Building */}
                    <circle
                      cx="310"
                      cy="122"
                      r="85"
                      fill="rgba(16, 185, 129, 0.04)"
                      stroke="rgba(16, 185, 129, 0.25)"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx="310"
                      cy="122"
                      r="42"
                      fill="rgba(16, 185, 129, 0.08)"
                      stroke="rgba(16, 185, 129, 0.4)"
                    />

                    {/* OSRM Road Route Polyline from Winning Agent to NIPOST Building */}
                    <polyline
                      points="175,68 230,85 268,108 310,122"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="3"
                      strokeDasharray="6 3"
                    />

                    {/* Candidate Field Agents in Redis GEOADD */}
                    {agents.slice(0, 6).map((ag, idx) => {
                      const positions = [
                        { x: 175, y: 68 },
                        { x: 420, y: 74 },
                        { x: 225, y: 178 },
                        { x: 445, y: 165 },
                        { x: 120, y: 145 },
                        { x: 375, y: 48 },
                      ];
                      const pos = positions[idx % positions.length];
                      const isWinner =
                        dispatchResult?.task?.assigned_agent_id === ag.id || idx === 0;
                      return (
                        <g key={ag.id}>
                          <circle
                            cx={pos.x}
                            cy={pos.y}
                            r={isWinner ? 8 : 6}
                            fill={isWinner ? '#38bdf8' : '#6366f1'}
                            stroke="#070b14"
                            strokeWidth="2"
                          />
                          <text
                            x={pos.x + 11}
                            y={pos.y + 4}
                            fill={isWinner ? '#38bdf8' : '#94a3b8'}
                            fontSize="10"
                            fontFamily="monospace"
                            fontWeight={isWinner ? 'bold' : 'normal'}
                          >
                            {ag.callsign.split(' ')[0]} ({ag.velocity_kmh}km/h)
                          </text>
                        </g>
                      );
                    })}

                    {/* Target Resolved NIPOST Building Pin */}
                    <g>
                      <circle cx="310" cy="122" r="10" fill="#10b981" />
                      <circle cx="310" cy="122" r="4" fill="#04120c" />
                      <text
                        x="325"
                        y="120"
                        fill="#34d399"
                        fontSize="11"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        {primary?.postcode || 'FC-02-A09-DB-09'}
                      </text>
                      <text
                        x="325"
                        y="134"
                        fill="#fde68a"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        Legacy: {primary?.legacy_postal_code || '900288'} · Gate +{primary?.building_telemetry?.avg_security_check_delay_sec ?? 35}s
                      </text>
                    </g>
                  </svg>

                  <div
                    className="mono"
                    style={{
                      position: 'absolute',
                      bottom: 8,
                      left: 10,
                      fontSize: '0.7rem',
                      background: 'rgba(7, 11, 20, 0.85)',
                      padding: '0.25rem 0.55rem',
                      borderRadius: 6,
                      color: '#94a3b8',
                    }}
                  >
                    Coords: {primary?.coordinates?.latitude?.toFixed(5)}, {primary?.coordinates?.longitude?.toFixed(5)} · Active Redis GEO Agents: {agents.length}
                  </div>
                </div>

                {/* One-Click ACID + Redlock Dispatch Button */}
                <button
                  onClick={handleDispatch}
                  disabled={dispatching}
                  style={{
                    padding: '0.8rem 1.2rem',
                    borderRadius: 8,
                    border: 'none',
                    background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                    color: '#041019',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Zap size={16} />
                  {dispatching
                    ? 'Running Redis GEOSEARCH + LightGBM/River Scoring + Redlock...'
                    : `Dispatch Nearest Agent to ${primary?.postcode || 'FC-02-A09-DB-09'} (ACID + Redlock)`}
                </button>

                {/* Live Dispatch Telemetry Breakdown */}
                {dispatchResult ? (
                  <div
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      borderRadius: 10,
                      padding: '0.9rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8' }}>
                        Dispatched Task: <code className="mono">{dispatchResult.task.id}</code>
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: 6,
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#34d399',
                        }}
                      >
                        REDLOCK ACQUIRED ({dispatchResult.telemetry_timings?.total_ms}ms total)
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '0.45rem',
                      }}
                    >
                      <div style={{ background: '#0b1221', padding: '0.45rem', borderRadius: 6 }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Winning Agent</div>
                        <div className="mono" style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                          {dispatchResult.task.assigned_agent_callsign}
                        </div>
                      </div>
                      <div style={{ background: '#0b1221', padding: '0.45rem', borderRadius: 6 }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>OSRM Road Dist</div>
                        <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#38bdf8' }}>
                          {dispatchResult.task.road_distance_m}m ({dispatchResult.task.osrm_base_duration_sec}s)
                        </div>
                      </div>
                      <div style={{ background: '#0b1221', padding: '0.45rem', borderRadius: 6 }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Champion LightGBM</div>
                        <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fbbf24' }}>
                          {dispatchResult.task.champion_lgbm_eta_sec}s
                        </div>
                      </div>
                      <div style={{ background: '#0b1221', padding: '0.45rem', borderRadius: 6 }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Challenger River ETA</div>
                        <div className="mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#34d399' }}>
                          {dispatchResult.task.challenger_river_eta_sec}s (Final: {dispatchResult.task.predicted_eta_sec}s)
                        </div>
                      </div>
                    </div>

                    {/* Top-K Candidate Waterfall Table */}
                    {dispatchResult.ranked_candidates?.length > 0 && (
                      <div className="mono" style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
                        <div style={{ marginBottom: '0.25rem', color: 'var(--text-muted)' }}>
                          Vectorized Candidate Ranking (OSRM Driving + NIPOST Gate Delay +{dispatchResult.task.gate_delay_sec}s):
                        </div>
                        {dispatchResult.ranked_candidates.slice(0, 3).map((rc: any, i: number) => (
                          <div
                            key={rc.agent_id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '0.25rem 0.5rem',
                              background: i === 0 ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                              borderRadius: 4,
                            }}
                          >
                            <span>
                              #{i + 1} {rc.callsign} ({rc.road_distance_m}m road)
                            </span>
                            <span>
                              LGBM: {rc.champion_lgbm_eta_sec}s | River: {rc.challenger_river_eta_sec}s →{' '}
                              <strong style={{ color: '#34d399' }}>{rc.final_predicted_eta_sec}s</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px dashed var(--border-subtle)',
                      borderRadius: 10,
                      padding: '1rem',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '0.82rem',
                    }}
                  >
                    Click <strong>Dispatch Nearest Agent</strong> above to run Stage-1 Redis GEOSEARCH, query live OSRM road geometry & Open-Meteo weather, score candidates in FastAPI, and acquire a distributed Redlock.
                  </div>
                )}
              </section>
            </div>

            {/* ================================================================
                BOTTOM PANEL: Live Self-Grading Ground-Truth Ledger (responsive-table)
                ================================================================ */}
            <section
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '1.25rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.9rem',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Activity size={18} color="#a78bfa" />
                  <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>
                    Stage C: Autonomous Ground-Truth Verification & Online River Self-Grading Ledger
                  </h2>
                </div>
                <button
                  onClick={fetchLiveState}
                  style={{
                    fontSize: '0.76rem',
                    padding: '0.35rem 0.7rem',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-card)',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <RefreshCw size={13} />
                  Refresh Telemetry
                </button>
              </div>

              <div
                tabIndex={0}
                role="region"
                aria-labelledby="ground-truth-ledger-caption"
                className="table-wrapper"
              >
                <table className="ledger-table">
                  <caption id="ground-truth-ledger-caption">
                    Live Ground-Truth Delivery & KYC Verification Ledger — Comparing Champion LightGBM & Challenger Online River ETA Predictions Against Physical Geofence Arrivals
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Task ID</th>
                      <th scope="col">NIPOST Postcode (Legacy)</th>
                      <th scope="col">Assigned Field Agent</th>
                      <th scope="col">Predicted ETA (LGBM / River)</th>
                      <th scope="col">Actual Physical Arrival</th>
                      <th scope="col">Residual Error</th>
                      <th scope="col">Online River Model Loop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(telemetry?.tasks || []).map((t: any) => (
                      <tr key={t.id}>
                        <th scope="row" className="mono">
                          {t.id}
                        </th>
                        <td className="mono">
                          <strong style={{ color: '#34d399' }}>{t.resolved_postcode}</strong>{' '}
                          <span style={{ color: '#fbbf24' }}>({t.legacy_postal_code})</span>
                        </td>
                        <td>{t.assigned_agent_callsign}</td>
                        <td className="mono">
                          <strong>{t.predicted_eta_sec}s</strong>{' '}
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            (LGBM: {t.champion_lgbm_eta_sec}s / River: {t.challenger_river_eta_sec}s)
                          </span>
                        </td>
                        <td className="mono">
                          {t.actual_duration_sec !== null ? (
                            <span style={{ color: '#e2e8f0' }}>{t.actual_duration_sec}s</span>
                          ) : (
                            <span style={{ color: '#fbbf24' }}>EN ROUTE (Geofence Armed)</span>
                          )}
                        </td>
                        <td className="mono">
                          {t.residual_error_sec !== null ? (
                            <span
                              style={{
                                color:
                                  Math.abs(t.residual_error_sec) <= 12 ? '#34d399' : '#fbbf24',
                                fontWeight: 700,
                              }}
                            >
                              {t.residual_error_sec > 0
                                ? `+${t.residual_error_sec}s`
                                : `${t.residual_error_sec}s`}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {t.status === 'ARRIVED_VERIFIED' ? (
                            <span
                              className="mono"
                              style={{
                                fontSize: '0.73rem',
                                padding: '0.2rem 0.5rem',
                                borderRadius: 6,
                                background: 'rgba(16, 185, 129, 0.14)',
                                color: '#34d399',
                              }}
                            >
                              LEARN_ONE APPLIED
                            </span>
                          ) : (
                            <span style={{ color: '#fbbf24', fontSize: '0.78rem' }}>
                              Awaiting Field app GPS geofence
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ====================================================================
            TAB 2: GOLDEN NIGERIAN ADDRESS BENCHMARK & EVALUATION SUITE (/evals)
            ==================================================================== */}
        {activeTab === 'evals' && (
          <section
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
                  Nigerian Messy Address Golden Benchmark & Evaluation Suite
                </h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Automated evaluation harness measuring exact building-level NIPOST resolution accuracy across landmark-heavy Nigerian addresses.
                </p>
              </div>
              <button
                onClick={handleRunEvals}
                disabled={evalRunning}
                style={{
                  padding: '0.65rem 1.2rem',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                  color: '#04120c',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {evalRunning ? 'Running Golden Evaluation Suite...' : 'Re-Run Live Golden Benchmark'}
              </button>
            </div>

            {evalReport && (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '1rem',
                  }}
                >
                  <div style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: 10, border: '1px solid rgba(16, 185, 129, 0.4)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ResolveGrid Multi-Tool Agent</div>
                    <div className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, color: '#34d399' }}>
                      {evalReport.summary.accuracy_pct}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
                      {evalReport.summary.exact_building_matches}/{evalReport.summary.total_cases} Exact Building Matches
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Naive Single-Call Search Baseline</div>
                    <div className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fbbf24' }}>
                      {evalReport.summary.naive_single_call_baseline_pct}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Fails on local landmarks & aliases</div>
                  </div>
                  <div style={{ background: 'var(--bg-card)', padding: '1rem', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Standard Street Centroid Geocoder</div>
                    <div className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f87171' }}>
                      {evalReport.summary.standard_maps_centroid_baseline_pct}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Lacks NIPOST building unit codes</div>
                  </div>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby="eval-benchmark-caption"
                  className="table-wrapper"
                >
                  <table>
                    <caption id="eval-benchmark-caption">
                      Golden Dataset Evaluation Results — Landmark Input vs. Expected & Resolved Official NIPOST Postcode
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">City / Axis</th>
                        <th scope="col">Messy Landmark Input</th>
                        <th scope="col">Expected NIPOST</th>
                        <th scope="col">Resolved NIPOST (Legacy)</th>
                        <th scope="col">Tool Calls & Latency</th>
                        <th scope="col">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evalReport.cases.map((c: any) => (
                        <tr key={c.id}>
                          <th scope="row">{c.city}</th>
                          <td>{c.messy_input}</td>
                          <td className="mono">{c.expected_postcode}</td>
                          <td className="mono">
                            <strong style={{ color: '#34d399' }}>{c.predicted_postcode}</strong> ({c.predicted_legacy})
                          </td>
                          <td className="mono">
                            {c.tool_calls} tools · {c.latency_ms}ms
                          </td>
                          <td className="mono">
                            <span style={{ color: c.exact_match ? '#34d399' : '#f87171', fontWeight: 700 }}>
                              {c.exact_match ? 'EXACT MATCH' : 'MISMATCH'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        )}

        {/* ====================================================================
            TAB 3: BANKING/KYC PROOF-OF-LOCATION PASS & B2B BATCH SCRUBBER
            ==================================================================== */}
        {activeTab === 'kyc_b2b' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {/* Left: Banking & Fintech KYC Proof-of-Location Pass */}
            <section
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ShieldCheck size={18} color="#10b981" />
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  GPS Location Verification Evidence
                </h2>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Captures device GPS coordinates, checks them against the resolved postcode, and issues an HMAC-SHA256 signed evidence record. Sandbox and fallback results are labelled explicitly.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Applicant / Merchant Ref</label>
                  <input
                    type="text"
                    value={kycApplicant}
                    onChange={(e) => setKycApplicant(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.55rem',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-card)',
                      color: '#f8fafc',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Claimed NIPOST Postcode</label>
                  <input
                    type="text"
                    value={kycClaimedCode}
                    onChange={(e) => setKycClaimedCode(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.55rem',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-card)',
                      color: '#34d399',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Hardware Latitude</label>
                  <input
                    type="text"
                    value={kycLat}
                    onChange={(e) => setKycLat(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.55rem',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-card)',
                      color: '#f8fafc',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Hardware Longitude</label>
                  <input
                    type="text"
                    value={kycLng}
                    onChange={(e) => setKycLng(e.target.value)}
                    className="mono"
                    style={{
                      width: '100%',
                      padding: '0.55rem',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-card)',
                      color: '#f8fafc',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  onClick={() => handleVerifyKyc(false)}
                  disabled={kycLoading}
                  style={{
                    flex: 1,
                    padding: '0.7rem',
                    borderRadius: 8,
                    border: 'none',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#04120c',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {kycLoading ? 'Verifying...' : 'Verify Coordinates & Sign KYC Pass'}
                </button>
                <button
                  onClick={() => handleVerifyKyc(true)}
                  disabled={kycLoading}
                  style={{
                    padding: '0.7rem 0.9rem',
                    borderRadius: 8,
                    border: '1px solid #38bdf8',
                    background: 'rgba(56, 189, 248, 0.12)',
                    color: '#38bdf8',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Use Live Device GPS
                </button>
              </div>

              {kycResult && (
                <div
                  className="mono"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: 10,
                    padding: '1rem',
                    fontSize: '0.78rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.4rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', fontWeight: 700 }}>
                    <span>STATUS: {kycResult.verification.verification_status}</span>
                    <span>ID: {kycResult.verification.id}</span>
                  </div>
                  <div>Reverse Geocoded Building: <strong>{kycResult.verification.reverse_geocoded_postcode}</strong></div>
                  <div>Distance to Building Pin: <strong>{kycResult.verification.distance_to_building_m}m</strong> (L3 Use: {kycResult.verification.building_use_status})</div>
                  <div>
                    Postcode evidence: <strong>{kycResult.evidence?.postcode_source || 'UNKNOWN'}</strong>
                    {!kycResult.evidence?.official_postcode_match && ' — local development fixture; not an official verification.'}
                  </div>
                  <div style={{ wordBreak: 'break-all', color: '#fbbf24', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                    HMAC-SHA256 Signature: {kycResult.verification.hmac_signature}
                  </div>
                </div>
              )}
            </section>

            {/* Right: B2B Merchant Bulk Address Scrubber */}
            <section
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Layers size={18} color="#38bdf8" />
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  B2B Logistics & Banking Bulk Address Scrubber
                </h2>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Paste multiple free-text Nigerian customer addresses (one per line) to batch-resolve canonical 11-character NIPOST postcodes and 6-digit legacy postal codes.
              </p>

              <textarea
                rows={5}
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                className="mono"
                style={{
                  width: '100%',
                  padding: '0.7rem',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-card)',
                  color: '#f8fafc',
                  fontSize: '0.78rem',
                }}
              />

              <button
                onClick={handleBatchResolve}
                disabled={batchLoading}
                style={{
                  padding: '0.7rem',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                  color: '#041019',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {batchLoading ? 'Scrubbing Batch via NIPOST Pipeline...' : 'Run Bulk NIPOST Resolution'}
              </button>

              {batchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                  {batchResults.map((br, idx) => (
                    <div
                      key={idx}
                      className="mono"
                      style={{
                        background: 'var(--bg-card)',
                        padding: '0.55rem 0.75rem',
                        borderRadius: 8,
                        fontSize: '0.75rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: '#cbd5e1', maxWidth: '58%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {br.query}
                      </span>
                      <span>
                        <strong style={{ color: '#34d399' }}>{br.primary_match?.postcode}</strong>{' '}
                        <span style={{ color: '#fbbf24' }}>({br.primary_match?.legacy_postal_code})</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
