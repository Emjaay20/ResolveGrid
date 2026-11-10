'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  Layers3,
  MapPinned,
  Route,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Workflow,
} from 'lucide-react';

type PublicPage = 'home' | 'docs' | 'start' | 'privacy';

// Set this to a monitored mailbox before a public launch; the contact line is hidden while empty.
const PRIVACY_CONTACT_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL || '';

const navigation = [
  { href: '/', label: 'Overview' },
  { href: '/docs', label: 'Documentation' },
  { href: '/start', label: 'How to use' },
];

function Header({ current }: { current: PublicPage }) {
  const active = current === 'home' ? '/' : `/${current}`;
  return (
    <header className="public-header">
      <Link href="/" className="public-brand" aria-label="ResolveGrid home"><span>RG</span> ResolveGrid</Link>
      <nav className="public-nav" aria-label="Public navigation">
        {navigation.map((item) => <Link key={item.href} href={item.href} className={active === item.href ? 'active' : ''}>{item.label}</Link>)}
      </nav>
      <Link href="/sign-in" className="public-header-cta">Pilot sign in <ArrowRight size={15} /></Link>
    </header>
  );
}

function Footer() {
  return <footer className="public-footer"><div><strong>ResolveGrid</strong><span>Structured locations for better delivery decisions.</span></div><div><Link href="/docs">Documentation</Link><Link href="/start">Access guide</Link><Link href="/privacy">Privacy</Link><Link href="/sign-in">Pilot sign in</Link></div></footer>;
}

const flow = [
  ['01', 'Describe a destination', 'A dispatcher pastes an address, landmark, delivery note, or available postcode.'],
  ['02', 'Resolve to a usable location', 'The resolver searches, checks nearby candidates and uses lookup data to create a standardised address record.'],
  ['03', 'Plan and verify responsibly', 'A demo dispatch plan can be created in the workspace; real arrival evidence belongs to an authenticated field workflow.'],
];

function Home() {
  return <div className="public-page">
    <Header current="home" />
    <main>
      <section className="public-hero">
        <div className="hero-copy">
          <p className="public-kicker"><span /> Address intelligence for Nigerian delivery</p>
          <h1>Every delivery starts with a location people can trust.</h1>
          <p className="hero-lede">ResolveGrid turns informal descriptions, landmarks and postcode references into structured, dispatch-ready location records—without hiding the source or certainty behind the result.</p>
          <div className="hero-actions"><Link href="/console" className="public-primary">Try the demo <ArrowRight size={17} /></Link><Link href="/sign-in" className="public-secondary">Pilot sign in</Link></div>
          <p className="hero-note"><ShieldCheck size={15} /> Built for controlled pilots. Test and fixture results are visibly labelled.</p>
        </div>
        <div className="hero-visual" aria-label="Illustration of address resolution">
          <div className="visual-topline"><span><span className="live-dot" /> Resolution path</span><span>01 / 03</span></div>
          <div className="visual-map"><div className="map-orbit orbit-one" /><div className="map-orbit orbit-two" /><div className="map-address a-one">Aminu Kano Cres.</div><div className="map-address a-two">Banex junction</div><div className="map-target"><MapPinned size={20} /><span>FC-02-A09-DB-09</span></div><div className="map-address a-three">Wuse II</div></div>
          <div className="visual-result"><div><span>INPUT</span><strong>“Yellow duplex near Banex”</strong></div><ChevronRight size={17} /><div><span>OUTPUT</span><strong>Structured postcode record</strong></div></div>
        </div>
      </section>

      <section className="proof-strip" aria-label="ResolveGrid principles"><div><BadgeCheck size={19} /><span>Source-aware results</span></div><div><Workflow size={19} /><span>Traceable resolution flow</span></div><div><ShieldCheck size={19} /><span>Consent-first field evidence</span></div></section>

      <section className="public-section" id="how-it-works"><div className="section-intro"><p className="public-kicker">How it works</p><h2>From a messy delivery note to a better operational decision.</h2><p>ResolveGrid is designed as an evidence chain, not just a map screen. Each step exposes what was used and what still needs a real-world check.</p></div><div className="flow-grid">{flow.map(([number, title, copy]) => <article className="flow-card" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

      <section className="public-section systems-section"><div className="section-intro"><p className="public-kicker">One connected system</p><h2>The public site explains the product. The workspace does the work.</h2></div><div className="systems-grid"><article><MapPinned size={22} /><h3>Address resolution</h3><p>Search, nearby context, postcode lookup and address assembly are combined into one inspectable record.</p><Link href="/console">Explore the resolver <ArrowRight size={15} /></Link></article><article><Route size={22} /><h3>Dispatch readiness</h3><p>Use a resolved location to create a rate-limited demo plan and inspect ETA factors before any real operation.</p><Link href="/docs#architecture">See the architecture <ArrowRight size={15} /></Link></article><article><Smartphone size={22} /><h3>Field verification</h3><p>Field arrivals are submitted from the authenticated mobile workflow, rather than through a public browser form.</p><Link href="/start#field-agent">Read the access guide <ArrowRight size={15} /></Link></article></div></section>

      <section className="public-section trust-section"><div><p className="public-kicker">Built with care</p><h2>Useful AI is accountable AI.</h2><p>ResolveGrid keeps official location resolution, operational decision-making and explanatory AI separate. It does not claim a trained ETA model until it has consented, verified arrival data.</p><Link href="/docs#trade-offs" className="inline-link">Review the decisions and trade-offs <ArrowRight size={16} /></Link></div><div className="trust-list"><div><Check size={17} /><span>Credentials stay on the server</span></div><div><Check size={17} /><span>Fixtures are labelled as fixtures</span></div><div><Check size={17} /><span>Field verification requires an authenticated identity</span></div><div><Check size={17} /><span>Model status is shown honestly</span></div></div></section>

      <section className="public-cta"><div><p className="public-kicker">Ready to explore?</p><h2>See ResolveGrid in action.</h2><p>Try a safe public demo, or sign in to an approved pilot workspace to create organisation-owned dispatch plans.</p></div><div><Link href="/console" className="public-primary">Open demo <ArrowRight size={17} /></Link><Link href="/sign-in" className="public-secondary light">Pilot sign in</Link></div></section>
    </main>
    <Footer />
  </div>;
}

function Docs() {
  return <div className="public-page">
    <Header current="docs" />
    <main className="docs-page">
      <section className="docs-hero"><p className="public-kicker">Technical documentation</p><h1>How ResolveGrid is designed—and why.</h1><p>These notes describe the current prototype honestly: what it does, what it does not yet do, and the decisions made to keep operational claims grounded.</p></section>
      <div className="docs-layout"><aside className="docs-toc"><span>On this page</span><a href="#architecture">Architecture</a><a href="#data-flow">Data flow</a><a href="#decisions">Key decisions</a><a href="#trade-offs">Trade-offs</a><a href="#status">Current status</a></aside><div className="docs-content">
        <section id="architecture"><p className="public-kicker">Architecture</p><h2>A layered system with clear boundaries.</h2><div className="architecture-diagram"><div><span>01</span><strong>Web workspace</strong><small>Resolution, demo planning, telemetry</small></div><ArrowRight /><div><span>02</span><strong>Core API</strong><small>Validation, source handling, dispatch orchestration</small></div><ArrowRight /><div><span>03</span><strong>Location & ML services</strong><small>Postcode tools, ETA baseline, verified-learning path</small></div><ArrowRight /><div><span>04</span><strong>Mobile field app</strong><small>Authenticated arrival evidence</small></div></div><p>The browser uses the core API through the same public origin. The API keeps sensitive credentials and protected operational actions off the public client. The field app signs in separately and submits evidence with its field identity.</p></section>
        <section id="data-flow"><p className="public-kicker">Data flow</p><h2>What happens when an address is resolved.</h2><ol className="docs-steps"><li><b>Input</b><span>A user submits a delivery description, landmark or known postcode.</span></li><li><b>Resolution</b><span>The service searches candidates, evaluates nearby context, retrieves lookup detail and assembles a standard address record.</span></li><li><b>Source label</b><span>The response retains its provenance. A local fixture is not presented as an official verification.</span></li><li><b>Optional dispatch planning</b><span>The workspace may create a demo dispatch plan with transparent ETA factors.</span></li><li><b>Field evidence</b><span>Only an authenticated, provisioned field agent can submit an arrival observation for protected verification.</span></li></ol></section>
        <section id="decisions"><p className="public-kicker">Architecture decisions</p><h2>Decisions that shape the prototype.</h2><div className="decision-grid"><article><Braces size={19} /><h3>Server-side integration</h3><p>Postcode credentials and verification controls remain on the server. The browser never receives a privileged service key.</p></article><article><Layers3 size={19} /><h3>Source-aware responses</h3><p>The UI labels fixture, test and official responses so operators can judge whether a result can support a real operation.</p></article><article><Sparkles size={19} /><h3>AI explains; it does not certify</h3><p>Provider-backed explanations are optional. They do not decide a postcode or override a source-backed resolution.</p></article><article><BookOpen size={19} /><h3>Evidence before learning</h3><p>ETA telemetry starts with an explainable baseline. Learning claims require consented, verified arrival data.</p></article></div></section>
        <section id="trade-offs"><p className="public-kicker">Trade-offs</p><h2>What we deliberately chose not to fake.</h2><div className="tradeoff-table"><div><strong>Choice</strong><strong>Why it matters</strong></div><div><span>No synthetic “trained model” claim</span><span>Simulated trips would make a dashboard look advanced, but would not prove real ETA accuracy.</span></div><div><span>No open field-agent sign-up</span><span>Field evidence needs accountable identities during a pilot; unrestricted public accounts would weaken that trust boundary.</span></div><div><span>No public browser KYC tool</span><span>Location verification and task completion are protected operational actions, not demo buttons.</span></div><div><span>Test environment disclosed</span><span>The product distinguishes a working prototype from approved production access.</span></div></div></section>
        <section id="status"><p className="public-kicker">Current status</p><h2>What you can use today.</h2><p>The public workspace demonstrates address resolution, source labelling, demo dispatch planning, quality checks and ETA telemetry. Approved pilot organisations can sign in, create protected workspace plans and issue one-time operator invitations. Field agents continue to use separately provisioned mobile accounts. Password recovery and managed email delivery are the next operational milestones.</p><Link href="/start" className="public-primary">Read the access guide <ArrowRight size={17} /></Link></section>
      </div></div>
    </main>
    <Footer />
  </div>;
}

function Start() {
  return <div className="public-page">
    <Header current="start" />
    <main className="start-page"><section className="docs-hero"><p className="public-kicker">Access guide</p><h1>Choose the right way to start.</h1><p>ResolveGrid separates public exploration, pilot operations and field evidence so each activity has the right level of access.</p></section><section className="role-grid"><article><span className="role-number">01</span><h2>Explorer or reviewer</h2><p>You do not need an account to understand the product or test the public demo workspace.</p><ul><li>Open the operations demo</li><li>Resolve a demonstration address</li><li>Inspect source labels and ETA telemetry</li></ul><Link href="/console" className="public-primary">Open demo <ArrowRight size={16} /></Link></article><article id="field-agent"><span className="role-number">02</span><h2>Field agent</h2><p>Field agents sign in on the mobile app with an account created by an administrator.</p><ul><li>Receive a provisioned email and password</li><li>Sign in on the ResolveGrid field app</li><li>Submit arrival evidence through the authenticated workflow</li></ul><span className="role-note"><ShieldCheck size={15} /> Self-sign-up is not enabled for field roles.</span></article><article><span className="role-number">03</span><h2>Pilot organisation</h2><p>Workspace owners and dispatchers sign in on the web to create protected plans and manage pilot access.</p><ul><li>Owner, dispatcher and reviewer roles</li><li>One-time, expiring operator invitations</li><li>Audit events and organisation boundaries</li></ul><Link href="/sign-in" className="inline-link">Sign in to a pilot workspace <ArrowRight size={16} /></Link></article></section><section className="auth-roadmap"><div><p className="public-kicker">Authentication roadmap</p><h2>What turns this into a full multi-user product.</h2></div><div className="roadmap-list"><div><span>Now</span><p>Provisioned field-agent login, operator workspaces, signed sessions, invitations and protected access.</p></div><div><span>Next</span><p>Verified email delivery, password reset and owner-managed account deactivation.</p></div><div><span>Pilot-ready</span><p>Organisation onboarding, audit review and production support procedures.</p></div></div></section><section className="start-callout"><BookOpen size={24} /><div><h2>Not sure where to begin?</h2><p>Read the documentation first, then use the public demo or sign in to an approved pilot workspace.</p></div><Link href="/docs" className="public-secondary">Read documentation</Link></section></main>
    <Footer />
  </div>;
}

function Privacy() {
  return <div className="public-page">
    <Header current="privacy" />
    <main className="docs-page legal-page">
      <section className="docs-hero"><p className="public-kicker">Privacy notice</p><h1>What ResolveGrid collects, and why.</h1><p>ResolveGrid is a pilot-stage product. This notice describes the data the current system handles. It will be updated before any wider launch.</p></section>
      <div className="legal-content">
        <section><h2>Public demo</h2><p>You can use the public demo without an account. Address text you submit is processed to produce a result and a demo plan. Demo plans are visible to other demo visitors, so do not enter a private home address or anyone&rsquo;s personal details there.</p></section>
        <section><h2>Pilot operators</h2><p>For an approved workspace we store your name, email address, role and a salted hash of your password. We never store the password itself. Signing in sets one essential session cookie that expires after eight hours. We do not use advertising or analytics cookies.</p></section>
        <section><h2>Field agents</h2><p>Field agents have a provisioned account with a name and email address. The mobile app records device location only after the agent gives consent for that visit. A submitted observation holds the postcode, GPS position and accuracy, gate delay, walking distance and any access note the agent writes.</p></section>
        <section><h2>How the data is used</h2><ul><li>To resolve addresses and plan dispatches for the workspace that asked.</li><li>To keep an append-only record of field evidence for review.</li><li>To limit abuse of the service, using the request&rsquo;s network address for a short period.</li></ul><p>Field evidence does not silently change trusted building records, and workspace plans are visible only to that workspace.</p></section>
        <section><h2>Services we rely on</h2><p>To answer a request, ResolveGrid sends the address text or postcode to the national digital postcode service operated by NIPOST. It sends coordinates, without names or account details, to a road-routing service and a weather service. Where an AI explanation provider is configured, the address text may be sent to that provider to describe the result.</p></section>
        <section><h2>Your choices</h2><p>You can ask to see, correct or delete the personal data held about you, or withdraw consent for location capture, in line with the Nigeria Data Protection Act 2023. Pilot data is kept for the length of the pilot unless you ask for it to be removed sooner.</p>{PRIVACY_CONTACT_EMAIL ? <p>Contact: <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a></p> : <p>To make a request, contact the workspace owner or pilot coordinator who issued your access.</p>}</section>
      </div>
    </main>
    <Footer />
  </div>;
}

export default function PublicSite({ page }: { page: PublicPage }) {
  if (page === 'privacy') return <Privacy />;
  if (page === 'docs') return <Docs />;
  if (page === 'start') return <Start />;
  return <Home />;
}
