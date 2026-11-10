import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { store, TENANT_PROFILES, INITIAL_AGENTS } from './config/datastore';
import { nipostClient } from './clients/nipostClient';
import { DispatchIdempotencyConflict, dispatchService } from './services/dispatchService';
import { verificationService } from './services/verificationService';
import { externalTelemetry } from './services/externalTelemetry';
import { fieldAuthService } from './services/fieldAuthService';
import { WorkspaceRole, workspaceAuthService } from './services/workspaceAuthService';
import { workspaceFieldTeamService } from './services/workspaceFieldTeamService';
import { taskLifecycleService } from './services/taskLifecycleService';

export const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// The web console reaches this API through a same-origin rewrite and the native
// field app sends no Origin header, so neither needs CORS. Other browser origins
// must be listed in CORS_ALLOWED_ORIGINS. Outside production an empty list stays
// open so local web and Expo development keep working.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use((_req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '2mb' }));

// Public demo surfaces only ever show the shared demo profiles and seed agents.
// Workspace plans and provisioned field agents stay behind their own sign-in.
const DEMO_AGENT_IDS = new Set(INITIAL_AGENTS.map((agent) => agent.id));
const isDemoTenant = (tenantId: string): boolean => Object.prototype.hasOwnProperty.call(TENANT_PROFILES, tenantId);

const writeRateWindows = new Map<string, { count: number; resetAt: number }>();

function enforceWriteRate(req: Request, res: Response, scope: string, limit: number, windowMs: number): boolean {
  const forwarded = req.header('X-Forwarded-For')?.split(',')[0]?.trim();
  const key = `${scope}:${forwarded || req.ip}`;
  const now = Date.now();
  const entry = writeRateWindows.get(key);
  const current = !entry || entry.resetAt <= now ? { count: 0, resetAt: now + windowMs } : entry;
  current.count += 1;
  writeRateWindows.set(key, current);
  if (current.count <= limit) return true;

  res.setHeader('Retry-After', Math.ceil((current.resetAt - now) / 1000));
  res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
  return false;
}

function extractNipostKey(req: Request): string | undefined {
  const headerKey = req.header('X-Nipost-Key') || req.header('X-API-Key');
  return headerKey ? headerKey.trim() : undefined;
}

function hasFieldAdminAccess(req: Request): boolean | null {
  const configuredKey = process.env.FIELD_ADMIN_KEY?.trim();
  if (!configuredKey) return null;
  const submittedKey = req.header('X-Field-Admin-Key')?.trim() || '';
  const expected = Buffer.from(configuredKey);
  const received = Buffer.from(submittedKey);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function requireFieldAdminAccess(req: Request, res: Response): boolean {
  const access = hasFieldAdminAccess(req);
  if (access === null) {
    res.status(503).json({ error: 'This protected operation is not configured on this server.' });
    return false;
  }
  if (!access) {
    res.status(401).json({ error: 'A valid field-admin credential is required for this operation.' });
    return false;
  }
  return true;
}

function setOperatorSessionCookie(res: Response, value: string): void {
  res.cookie('rg_operator_session', value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearOperatorSessionCookie(res: Response): void {
  res.clearCookie('rg_operator_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

async function requireWorkspaceAccess(
  req: Request,
  res: Response,
  workspaceId: string,
  roles?: WorkspaceRole[]
) {
  try {
    const session = await workspaceAuthService.authorize(req.header('Cookie'), workspaceId, roles);
    if (!session) {
      res.status(403).json({ error: 'You do not have access to this workspace action.' });
      return null;
    }
    return session;
  } catch {
    res.status(503).json({ error: 'Workspace access is temporarily unavailable.' });
    return null;
  }
}

// ============================================================================
// 1. System Health & Live Telemetry Status
// ============================================================================
app.get('/v1/health', (_req: Request, res: Response) => {
  res.json({
    service: 'resolvegrid-core-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    infrastructure: {
      mysql_connected: store.mysqlConnected,
      redis_connected: store.redisConnected,
      nipost_gateway: nipostClient.getMetrics(),
      active_agents_count: store.agentMap.size,
      verified_postcodes_count: store.postcodeMap.size,
      last_opensky_poll_at: externalTelemetry.lastTransponderPollAt,
      live_transponders_ingested: externalTelemetry.liveTransponderCount,
    },
  });
});

// ============================================================================
// 2. Official NIPOST API Endpoints (Search, Lookup L1-L5, Assembly, Reverse)
// ============================================================================
app.get('/v1/nipost/search/autocomplete', async (req: Request, res: Response) => {
  const q = String(req.query.q || '');
  const result = await nipostClient.autocompleteSearch(q, extractNipostKey(req));
  res.json({ data: result.results, meta: { latency_ms: result.latency_ms, upstream_queried: result.upstream_queried } });
});

app.get('/v1/nipost/search/reverse', async (req: Request, res: Response) => {
  const lat = Number(req.query.lat ?? req.query.latitude ?? 9.07874);
  const lng = Number(req.query.lng ?? req.query.longitude ?? 7.47018);
  const radius = Number(req.query.radius ?? req.query.max_distance ?? 2500);
  const result = await nipostClient.reverseGeocode(lat, lng, radius, extractNipostKey(req));
  res.json({ data: result });
});

app.get('/v1/nipost/search/nearby', async (req: Request, res: Response) => {
  const code = req.query.code ? String(req.query.code) : undefined;
  const lat = req.query.lat ? Number(req.query.lat) : undefined;
  const lng = req.query.lng ? Number(req.query.lng) : undefined;
  const radius = req.query.radius ? Number(req.query.radius) : 3000;
  const result = await nipostClient.nearbySearch({ code, lat, lng, radius }, extractNipostKey(req));
  res.json({ data: result });
});

app.get('/v1/nipost/lookup', async (req: Request, res: Response) => {
  const strict = req.query.strict === '1';
  if (strict) {
    res.set('Cache-Control', 'private, no-store');
    const secret = process.env.RESOLVEGRID_SERVICE_TOKEN?.trim();
    if (!secret) {
      res.status(503).json({ error: 'Verified lookup is not configured.' });
      return;
    }
    const expected = Buffer.from(secret);
    const provided = Buffer.from(req.header('X-ResolveGrid-Service-Token') || '');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      res.status(401).json({ error: 'A verified lookup service credential is required.' });
      return;
    }
  }
  const code = String(req.query.code || (strict ? '' : 'FC-02-A09-DB-09'));
  const level = Number(req.query.level || 3);
  if (!code || !Number.isInteger(level) || level < 1 || level > 5) {
    res.status(400).json({ error: 'A postcode and lookup level from 1 to 5 are required.' });
    return;
  }
  const positionProvided = strict && (req.query.lat !== undefined || req.query.lng !== undefined);
  const lat = typeof req.query.lat === 'string' && req.query.lat.trim() ? Number(req.query.lat) : NaN;
  const lng = typeof req.query.lng === 'string' && req.query.lng.trim() ? Number(req.query.lng) : NaN;
  if (positionProvided && (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180)) {
    res.status(400).json({ error: 'Valid pickup coordinates are required.' });
    return;
  }
  try {
    const result = positionProvided
      ? await nipostClient.verifyPickupPosition(code, lat, lng, extractNipostKey(req))
      : await nipostClient.lookupPostcode(code, level, extractNipostKey(req), strict);
    if (!result) {
      res.status(404).json({ error: positionProvided ? 'The device location does not match this postcode' : strict ? 'Upstream postcode geometry unavailable' : 'Invalid or unknown NIPOST postcode format', code });
      return;
    }
    res.json({ data: result, ...(strict ? {
      upstream_postcode_verified: true,
      upstream_geometry_verified: !positionProvided,
      coordinate_origin: positionProvided ? 'RESIDENT_DEVICE_REVERSE_MATCH' : 'NIPOST_GEOMETRY',
    } : {}) });
  } catch {
    res.status(502).json({ error: 'Postcode lookup is temporarily unavailable.' });
  }
});

app.post('/v1/nipost/assembly/assemble', async (req: Request, res: Response) => {
  const assembled = await nipostClient.assemble(req.body || {}, extractNipostKey(req));
  res.json({ data: assembled });
});

app.get('/v1/nipost/assembly/disassemble', async (req: Request, res: Response) => {
  const code = String(req.query.code || '');
  const disassembled = await nipostClient.disassemble(code, extractNipostKey(req));
  res.json({ data: disassembled });
});

app.get('/v1/nipost/reference', async (req: Request, res: Response) => {
  const state = req.query.state ? String(req.query.state) : undefined;
  const lga = req.query.lga ? String(req.query.lga) : undefined;
  const district = req.query.district ? String(req.query.district) : undefined;
  const refData = await nipostClient.getReferenceHierarchy(
    { state, lga, district },
    extractNipostKey(req)
  );
  res.json(refData);
});

app.get('/v1/nipost/registry', (_req: Request, res: Response) => {
  res.json({
    data: Array.from(store.postcodeMap.values()),
    gateway_metrics: nipostClient.getMetrics(),
  });
});

app.get('/v1/ml/status', async (_req: Request, res: Response) => {
  const mlEngineUrl = (process.env.ML_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${mlEngineUrl}/v1/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error('ML engine unavailable');
    const payload = (await response.json()) as { ml_engine?: Record<string, unknown> };
    res.json({ available: true, ...(payload.ml_engine || {}) });
  } catch {
    clearTimeout(timer);
    res.json({
      available: false,
      champion_model: 'ETA baseline status unavailable',
      challenger_model: 'Online residual learner status unavailable',
      online_samples_learned: 0,
      rolling_mae_sec: null,
      feature_importances: {},
    });
  }
});

app.post('/v1/field/observations', async (req: Request, res: Response) => {
  if (!process.env.FIELD_SESSION_SECRET?.trim()) {
    res.status(503).json({ error: 'Field-agent sessions are not configured on this server.' });
    return;
  }
  const session = fieldAuthService.verifyAuthorization(req.header('Authorization'));
  if (!session) {
    res.status(401).json({ error: 'A valid field-agent bearer token is required.' });
    return;
  }

  const body = req.body || {};
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const gpsAccuracyM = Number(body.gps_accuracy_m);
  const gateDelay = Number(body.measured_gate_delay_sec);
  const walkMeters = Number(body.compound_walk_meters ?? 0);
  const agentId = String(body.agent_id || '').trim();
  const postcode = String(body.postcode || '').trim();
  const taskId = body.task_id ? String(body.task_id).trim() : '';

  if (
    body.location_consent !== true ||
    !agentId || agentId !== session.agent_id ||
    !postcode ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(gpsAccuracyM) ||
    !Number.isFinite(gateDelay) ||
    !Number.isFinite(walkMeters) ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
    gpsAccuracyM <= 0 || gpsAccuracyM > 100 || gateDelay < 0 || gateDelay > 7200 ||
    walkMeters < 0 || walkMeters > 5000
  ) {
    res.status(400).json({
      error: 'Provide consent, your signed-in field identity, valid device GPS, and realistic access measurements.',
    });
    return;
  }

  const assignedTask = taskId ? store.taskMap.get(taskId) : undefined;
  if (taskId && !assignedTask) {
    res.status(404).json({ error: 'This assigned task is no longer available. Refresh your mobile inbox.' });
    return;
  }
  if (assignedTask && assignedTask.assigned_agent_id !== session.agent_id) {
    res.status(403).json({ error: 'This task is assigned to a different field agent.' });
    return;
  }
  if (assignedTask && assignedTask.resolved_postcode !== postcode) {
    res.status(422).json({ error: 'Submit evidence for the postcode attached to the assigned task.' });
    return;
  }

  const submitted = await verificationService.submitFieldObservation({
    agentId,
    postcode,
    latitude,
    longitude,
    gpsAccuracyM,
    gateClearanceRequired: Boolean(body.gate_clearance_required),
    measuredGateDelaySec: gateDelay,
    compoundWalkMeters: walkMeters,
    buildingAccessNotes:
      typeof body.building_access_notes === 'string'
        ? body.building_access_notes.slice(0, 500)
        : undefined,
    overrideNipostKey: extractNipostKey(req),
  });
  if (!submitted.accepted) {
    res.status(422).json(submitted);
    return;
  }
  const verified = assignedTask
    ? await verificationService.verifyTaskArrivalAndLearn({
        taskId: assignedTask.id,
        measuredGateDelaySec: gateDelay,
        buildingAccessNotes:
          typeof body.building_access_notes === 'string'
            ? body.building_access_notes.slice(0, 500)
            : undefined,
      })
    : null;
  res.status(201).json({ ...submitted, task: verified?.task || null });
});

// ============================================================================
// 3. Natural Language Multi-Tool Address Resolution & B2B Batch Scrubbing
// ============================================================================
app.post('/v1/resolve', async (req: Request, res: Response) => {
  const { query, lat, lng } = req.body || {};
  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Field "query" (natural language address) is required.' });
    return;
  }
  const resolved = await dispatchService.resolveAddressOrchestrated(
    query,
    lat !== undefined ? Number(lat) : undefined,
    lng !== undefined ? Number(lng) : undefined,
    extractNipostKey(req)
  );
  res.json(resolved);
});

app.post('/v1/resolve/batch', async (req: Request, res: Response) => {
  const addresses: string[] = Array.isArray(req.body?.addresses) ? req.body.addresses : [];
  if (addresses.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty "addresses" string array.' });
    return;
  }
  const nipostKey = extractNipostKey(req);
  const results = await Promise.all(
    addresses.slice(0, 25).map((addr) =>
      dispatchService.resolveAddressOrchestrated(String(addr), undefined, undefined, nipostKey)
    )
  );
  res.json({
    total_processed: results.length,
    results,
  });
});

// ============================================================================
// 4. Multi-Tenant Dispatch, Live Agents & Ground-Truth Self-Grading Loop
// ============================================================================
app.get('/v1/tenants', (_req: Request, res: Response) => {
  res.json({ data: Object.values(TENANT_PROFILES) });
});

app.get('/v1/agents', (_req: Request, res: Response) => {
  const demoAgents = Array.from(store.agentMap.values()).filter((agent) => DEMO_AGENT_IDS.has(agent.id));
  const demoCells = new Set(demoAgents.map((agent) => agent.h3_res8));
  res.json({
    data: demoAgents,
    data_origin: 'DEMO_SEED',
    h3_velocity_cells: Object.fromEntries(
      Array.from(store.h3VelocityMap.entries()).filter(([cell]) => demoCells.has(cell))
    ),
  });
});

// ============================================================================
// 4b. Field-Agent Identity and Session Management
// ============================================================================
app.post('/v1/field/agents', async (req: Request, res: Response) => {
  const adminAccess = hasFieldAdminAccess(req);
  if (adminAccess === null) {
    res.status(503).json({ error: 'Field-agent provisioning is not configured on this server.' });
    return;
  }
  if (!adminAccess) {
    res.status(401).json({ error: 'A valid field-admin credential is required.' });
    return;
  }

  const { agent_id, email, display_name, password } = req.body || {};
  if (
    !agent_id ||
    typeof email !== 'string' ||
    !email.includes('@') ||
    typeof display_name !== 'string' ||
    display_name.trim().length < 2 ||
    typeof password !== 'string'
  ) {
    res.status(400).json({ error: 'agent_id, a valid email, display_name, and password are required.' });
    return;
  }
  try {
    const agent = await fieldAuthService.provision({
      agentId: String(agent_id),
      email,
      displayName: display_name,
      password,
    });
    res.status(201).json({ agent });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to provision field agent.' });
  }
});

app.post('/v1/field/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required.' });
    return;
  }
  if (!process.env.FIELD_SESSION_SECRET?.trim()) {
    res.status(503).json({ error: 'Field-agent sessions are not configured on this server.' });
    return;
  }
  try {
    const session = await fieldAuthService.login(email, password);
    if (!session) {
      res.status(401).json({ error: 'Invalid field-agent email or password.' });
      return;
    }
    res.json(session);
  } catch {
    res.status(503).json({ error: 'Field-agent authentication is temporarily unavailable.' });
  }
});

app.get('/v1/field/me', (req: Request, res: Response) => {
  const session = fieldAuthService.verifyAuthorization(req.header('Authorization'));
  if (!session) {
    res.status(401).json({ error: 'A valid field-agent bearer token is required.' });
    return;
  }
  res.json({ agent: session });
});

app.get('/v1/field/tasks', (req: Request, res: Response) => {
  const session = fieldAuthService.verifyAuthorization(req.header('Authorization'));
  if (!session) {
    res.status(401).json({ error: 'A valid field-agent bearer token is required.' });
    return;
  }
  const tasks = Array.from(store.taskMap.values())
    .filter((task) => task.assigned_agent_id === session.agent_id && ['DISPATCHED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE'].includes(task.status))
    .sort((a, b) => new Date(b.dispatched_at).getTime() - new Date(a.dispatched_at).getTime());
  res.json({ data: tasks });
});

app.post('/v1/field/tasks/:taskId/:action', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'field-task-action', 30, 5 * 60 * 1000)) return;
  const session = fieldAuthService.verifyAuthorization(req.header('Authorization'));
  if (!session) {
    res.status(401).json({ error: 'A valid field-agent bearer token is required.' });
    return;
  }
  const action = String(req.params.action).toUpperCase();
  if (!['ACCEPTED', 'EN_ROUTE', 'DECLINED'].includes(action)) {
    res.status(400).json({ error: 'Choose ACCEPTED, EN_ROUTE, or DECLINED.' });
    return;
  }
  try {
    const task = await taskLifecycleService.fieldAction(
      String(req.params.taskId),
      session.agent_id,
      action as 'ACCEPTED' | 'EN_ROUTE' | 'DECLINED',
      typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined
    );
    res.json({ task });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to update this task.' });
  }
});

// ============================================================================
// 4c. Invitation-only Operator Workspaces
// ============================================================================
// Bootstrap is deliberately server-admin controlled. Public registration would
// make a field operations pilot harder to audit before its organisation model is
// fully proven. Owners use invitations for every subsequent operator account.
app.post('/v1/workspaces/bootstrap', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'workspace-bootstrap', 3, 60 * 60 * 1000)) return;
  if (!requireFieldAdminAccess(req, res)) return;
  const { workspace_id, workspace_name, owner_email, owner_name, password } = req.body || {};
  if (
    typeof workspace_id !== 'string' ||
    typeof workspace_name !== 'string' ||
    typeof owner_email !== 'string' ||
    typeof owner_name !== 'string' ||
    typeof password !== 'string'
  ) {
    res.status(400).json({ error: 'workspace_id, workspace_name, owner_email, owner_name, and password are required.' });
    return;
  }
  try {
    const result = await workspaceAuthService.bootstrapWorkspace({
      workspaceId: workspace_id,
      workspaceName: workspace_name,
      ownerEmail: owner_email,
      ownerName: owner_name,
      password,
    });
    setOperatorSessionCookie(res, result.cookie);
    res.status(201).json({ session: result.session });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to create this workspace.' });
  }
});

app.post('/v1/auth/operator/login', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'operator-login', 10, 15 * 60 * 1000)) return;
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required.' });
    return;
  }
  try {
    const result = await workspaceAuthService.login(email, password);
    if (!result) {
      res.status(401).json({ error: 'Invalid operator email or password.' });
      return;
    }
    setOperatorSessionCookie(res, result.cookie);
    res.json({ session: result.session });
  } catch {
    res.status(503).json({ error: 'Operator sign-in is temporarily unavailable.' });
  }
});

app.post('/v1/auth/operator/logout', async (req: Request, res: Response) => {
  try {
    await workspaceAuthService.logout(req.header('Cookie'));
  } catch {
    // Clear a stale browser session even if the backing database is unavailable.
  }
  clearOperatorSessionCookie(res);
  res.status(204).end();
});

app.get('/v1/auth/operator/me', async (req: Request, res: Response) => {
  try {
    const session = await workspaceAuthService.sessionFromCookie(req.header('Cookie'));
    if (!session) {
      res.status(401).json({ error: 'Sign in to access a pilot workspace.' });
      return;
    }
    res.json({ session });
  } catch {
    res.status(503).json({ error: 'Workspace access is temporarily unavailable.' });
  }
});

app.post('/v1/workspaces/:workspaceId/invitations', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'workspace-invite', 20, 60 * 60 * 1000)) return;
  const workspaceId = String(req.params.workspaceId);
  const session = await requireWorkspaceAccess(req, res, workspaceId, ['OWNER']);
  if (!session) return;
  const { email, role } = req.body || {};
  if (typeof email !== 'string' || (role !== 'DISPATCHER' && role !== 'REVIEWER')) {
    res.status(400).json({ error: 'A valid email and either DISPATCHER or REVIEWER role are required.' });
    return;
  }
  try {
    const invitation = await workspaceAuthService.createInvitation({
      actor: session,
      tenantId: workspaceId,
      email,
      role,
    });
    // Email delivery is intentionally separate. The owner can copy this one-time
    // URL into an approved channel until a verified sender domain is connected.
    res.status(201).json({
      invitation: {
        id: invitation.id,
        email: email.trim().toLowerCase(),
        role,
        expires_at: invitation.expires_at,
        accept_url: `/join?token=${encodeURIComponent(invitation.token)}`,
      },
    });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to create this invitation.' });
  }
});

app.post('/v1/workspace-invitations/accept', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'workspace-invite-accept', 10, 15 * 60 * 1000)) return;
  const { token, display_name, password } = req.body || {};
  if (typeof token !== 'string' || typeof display_name !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'token, display_name, and password are required.' });
    return;
  }
  try {
    const result = await workspaceAuthService.acceptInvitation({ token, displayName: display_name, password });
    setOperatorSessionCookie(res, result.cookie);
    res.json({ session: result.session });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to accept this invitation.' });
  }
});

app.get('/v1/workspaces/:workspaceId/tasks', async (req: Request, res: Response) => {
  const workspaceId = String(req.params.workspaceId);
  const session = await requireWorkspaceAccess(req, res, workspaceId);
  if (!session) return;
  const tasks = Array.from(store.taskMap.values())
    .filter((task) => task.tenant_id === workspaceId)
    .sort((a, b) => new Date(b.dispatched_at).getTime() - new Date(a.dispatched_at).getTime());
  res.json({ workspace: session.workspaces.find((workspace) => workspace.tenant_id === workspaceId), data: tasks });
});

app.get('/v1/workspaces/:workspaceId/field-agents', async (req: Request, res: Response) => {
  const workspaceId = String(req.params.workspaceId);
  const session = await requireWorkspaceAccess(req, res, workspaceId);
  if (!session) return;
  try {
    res.json({ data: await workspaceFieldTeamService.list(workspaceId) });
  } catch {
    res.status(503).json({ error: 'Field-team access is temporarily unavailable.' });
  }
});

app.post('/v1/workspaces/:workspaceId/field-agents', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'workspace-field-agent', 10, 60 * 60 * 1000)) return;
  const workspaceId = String(req.params.workspaceId);
  const session = await requireWorkspaceAccess(req, res, workspaceId, ['OWNER']);
  if (!session) return;
  const { agent_id, email, display_name, password } = req.body || {};
  if (
    typeof agent_id !== 'string' ||
    typeof email !== 'string' ||
    typeof display_name !== 'string' ||
    typeof password !== 'string'
  ) {
    res.status(400).json({ error: 'agent_id, email, display_name, and password are required.' });
    return;
  }
  try {
    const agent = await fieldAuthService.provision({
      agentId: agent_id,
      email,
      displayName: display_name,
      password,
    });
    await workspaceFieldTeamService.assign(workspaceId, agent.agent_id, session.user.id);
    res.status(201).json({ agent });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to provision this field agent.' });
  }
});

app.post('/v1/workspaces/:workspaceId/dispatch', async (req: Request, res: Response, next: NextFunction) => {
  if (!enforceWriteRate(req, res, 'workspace-dispatch', 30, 5 * 60 * 1000)) return;
  const workspaceId = String(req.params.workspaceId);
  const session = await requireWorkspaceAccess(req, res, workspaceId, ['OWNER', 'DISPATCHER']);
  if (!session) return;
  const { raw_address, postcode } = req.body || {};
  const fieldAgentId = req.body?.field_agent_id ? String(req.body.field_agent_id) : undefined;
  let assignedFieldAgent: { agentId: string; displayName: string } | undefined;
  if (fieldAgentId) {
    const linked = await workspaceFieldTeamService.hasAgent(workspaceId, fieldAgentId);
    if (!linked) {
      res.status(422).json({ error: 'Choose an active field agent linked to this workspace.' });
      return;
    }
    const account = Array.from(store.fieldAgentById.values()).find((agent) => agent.agent_id === fieldAgentId);
    if (!account) {
      res.status(422).json({ error: 'That field-agent account is unavailable.' });
      return;
    }
    assignedFieldAgent = { agentId: account.agent_id, displayName: account.display_name };
  }
  await dispatchService.dispatchTask({
    idempotencyKey: req.header('Idempotency-Key') || `workspace_${crypto.randomUUID()}`,
    tenantId: workspaceId,
    rawAddress: raw_address ? String(raw_address) : undefined,
    postcode: postcode ? String(postcode) : undefined,
    overrideNipostKey: extractNipostKey(req),
    assignedFieldAgent,
  }).then((dispatched) => res.json({ ...dispatched, workspace_user: session.user }), next);
});

app.post('/v1/workspaces/:workspaceId/tasks/:taskId/cancel', async (req: Request, res: Response) => {
  const workspaceId = String(req.params.workspaceId);
  const session = await requireWorkspaceAccess(req, res, workspaceId, ['OWNER', 'DISPATCHER']);
  if (!session) return;
  try {
    const task = await taskLifecycleService.cancel(
      String(req.params.taskId),
      workspaceId,
      session.user.id,
      typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined
    );
    res.json({ task });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : 'Unable to cancel this task.' });
  }
});

app.post('/v1/tasks/dispatch', async (req: Request, res: Response, next: NextFunction) => {
  if (!enforceWriteRate(req, res, 'dispatch', 12, 5 * 60 * 1000)) return;
  const idempotencyKey =
    req.header('Idempotency-Key') ||
    req.body?.idempotency_key ||
    `idem_${crypto.randomUUID()}`;
  const { tenant_id, raw_address, postcode } = req.body || {};
  // This public demo route may only plan against a shared demo profile. A pilot
  // workspace's plans are created through its authenticated dispatch route.
  const requestedTenant = tenant_id ? String(tenant_id) : 'tenant_logistics_ng';
  if (!isDemoTenant(requestedTenant)) {
    res.status(403).json({ error: 'Demo planning is limited to the shared demo profiles. Sign in to plan for a workspace.' });
    return;
  }

  await dispatchService.dispatchTask({
    idempotencyKey: String(idempotencyKey),
    tenantId: requestedTenant,
    rawAddress: raw_address ? String(raw_address) : undefined,
    postcode: postcode ? String(postcode) : undefined,
    overrideNipostKey: extractNipostKey(req),
  }).then((dispatched) => res.json(dispatched), next);
});

app.post('/v1/tasks/:id/verify-arrival', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'arrival-verification', 10, 5 * 60 * 1000)) return;
  if (!requireFieldAdminAccess(req, res)) return;
  const taskId = String(req.params.id);
  const { actual_duration_sec, measured_gate_delay_sec, building_access_notes } = req.body || {};

  const verified = await verificationService.verifyTaskArrivalAndLearn({
    taskId,
    actualDurationSec:
      actual_duration_sec !== undefined ? Number(actual_duration_sec) : undefined,
    measuredGateDelaySec:
      measured_gate_delay_sec !== undefined ? Number(measured_gate_delay_sec) : undefined,
    buildingAccessNotes: building_access_notes ? String(building_access_notes) : undefined,
  });

  if (!verified) {
    res.status(404).json({ error: `Task ${taskId} not found.` });
    return;
  }

  res.json(verified);
});

app.post('/v1/telemetry/ping', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'telemetry', 60, 60 * 1000)) return;
  if (!requireFieldAdminAccess(req, res)) return;
  const { agent_id, latitude, longitude, velocity_kmh, heading_deg, telemetry_source } =
    req.body || {};
  if (!agent_id || latitude === undefined || longitude === undefined) {
    res.status(400).json({ error: 'agent_id, latitude, and longitude are required.' });
    return;
  }

  const pingResult = await verificationService.processLiveGpsPing({
    agentId: String(agent_id),
    latitude: Number(latitude),
    longitude: Number(longitude),
    velocityKmh: velocity_kmh !== undefined ? Number(velocity_kmh) : undefined,
    headingDeg: heading_deg !== undefined ? Number(heading_deg) : undefined,
    telemetrySource: telemetry_source ? String(telemetry_source) : 'MOBILE_FIELD_APP_GPS',
  });

  res.json(pingResult);
});

app.get('/v1/telemetry/live-accuracy', (_req: Request, res: Response) => {
  const allTasks = Array.from(store.taskMap.values())
    .filter((task) => isDemoTenant(task.tenant_id))
    .sort((a, b) => new Date(b.dispatched_at).getTime() - new Date(a.dispatched_at).getTime());
  const verifiedTasks = allTasks.filter(
    (t) => t.status === 'ARRIVED_VERIFIED' && t.residual_error_sec !== null
  );

  const mae =
    verifiedTasks.length > 0
      ? verifiedTasks.reduce((acc, t) => acc + Math.abs(t.residual_error_sec || 0), 0) /
        verifiedTasks.length
      : 0;

  const rmse =
    verifiedTasks.length > 0
      ? Math.sqrt(
          verifiedTasks.reduce(
            (acc, t) => acc + Math.pow(t.residual_error_sec || 0, 2),
            0
          ) / verifiedTasks.length
        )
      : 0;

  res.json({
    rolling_24h_metrics: {
      total_tasks_dispatched: allTasks.length,
      verified_ground_truth_arrivals: verifiedTasks.length,
      mean_absolute_error_sec: Number(mae.toFixed(2)),
      rmse_sec: Number(rmse.toFixed(2)),
      online_river_updates_applied: verifiedTasks.filter((t) => t.online_model_updated).length,
    },
    nipost_gateway: nipostClient.getMetrics(),
    scope: 'SHARED_DEMO_PROFILES',
    tasks: allTasks.slice(0, 50).map(({ idempotency_key: _idempotencyKey, ...task }) => task),
  });
});

// ============================================================================
// 5. Cryptographically Signed KYC Proof-of-Location Pass
// ============================================================================
app.post('/v1/kyc/verify-location', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'kyc', 6, 5 * 60 * 1000)) return;
  if (!requireFieldAdminAccess(req, res)) return;
  if (!process.env.KYC_SIGNING_SECRET?.trim()) {
    res.status(503).json({ error: 'KYC signing is not configured on this server.' });
    return;
  }
  const { applicant_ref, latitude, longitude, gps_accuracy_m, claimed_postcode } = req.body || {};
  if (latitude === undefined || longitude === undefined) {
    res.status(400).json({ error: 'latitude and longitude from hardware GPS are required.' });
    return;
  }

  const parsedLat = Number(latitude);
  const parsedLng = Number(longitude);
  const parsedAccuracy = Number(gps_accuracy_m ?? 6.5);
  if (
    !Number.isFinite(parsedLat) ||
    !Number.isFinite(parsedLng) ||
    !Number.isFinite(parsedAccuracy) ||
    parsedLat < -90 ||
    parsedLat > 90 ||
    parsedLng < -180 ||
    parsedLng > 180 ||
    parsedAccuracy <= 0
  ) {
    res.status(400).json({ error: 'Provide valid latitude, longitude, and a positive GPS accuracy in metres.' });
    return;
  }

  const result = await verificationService.verifyKycLocation({
    applicantRef: String(applicant_ref || `KYC-NG-${Date.now().toString().slice(-6)}`),
    latitude: parsedLat,
    longitude: parsedLng,
    gpsAccuracyM: parsedAccuracy,
    claimedPostcode: claimed_postcode ? String(claimed_postcode) : undefined,
    overrideNipostKey: extractNipostKey(req),
  });

  res.json(result);
});

app.get('/v1/kyc/verifications', (req: Request, res: Response) => {
  // Verification records hold device coordinates and applicant references.
  if (!requireFieldAdminAccess(req, res)) return;
  res.json({ data: store.kycList });
});

// ============================================================================
// 6. Golden Nigerian Address Benchmark & Evaluation Suite Proxy
// ============================================================================
app.post('/v1/evals/run', async (req: Request, res: Response) => {
  if (!enforceWriteRate(req, res, 'evaluation', 6, 5 * 60 * 1000)) return;
  const mlEngineUrl = (process.env.ML_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const upstream = await fetch(`${mlEngineUrl}/v1/evals/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (upstream.ok) {
      const data = await upstream.json();
      res.json(data);
      return;
    }
  } catch {
    // Fallback to local benchmark execution
  }

  // Run Golden Benchmark locally against dispatchService.resolveAddressOrchestrated
  const goldenCases = [
    {
      id: 'eval_abj_01',
      city: 'Abuja (Wuse II)',
      messy_input: 'Yellow duplex opposite AP filling station near Banex Junction off Aminu Kano Crescent Wuse 2',
      expected_postcode: 'FC-02-A09-DB-09',
      expected_legacy: '900288',
    },
    {
      id: 'eval_abj_02',
      city: 'Abuja (Garki Area 11)',
      messy_input: 'Yellow building opposite Central Mosque gate near NNPC station Gimbiya St Area 11 Garki',
      expected_postcode: 'FC-02-A04-GK-11',
      expected_legacy: '900241',
    },
    {
      id: 'eval_los_01',
      city: 'Lagos (Lekki Phase 1)',
      messy_input: '14B Admiralty Way opposite Ebeano Supermarket near Lekki Ikoyi Link Bridge',
      expected_postcode: 'LA-08-C01-LK-04',
      expected_legacy: '106104',
    },
    {
      id: 'eval_los_02',
      city: 'Lagos (Victoria Island)',
      messy_input: 'Beside Zenith Bank HQ 290 Akin Adesola Street off Adeola Odeku VI Lagos',
      expected_postcode: 'LA-08-A02-VI-19',
      expected_legacy: '101241',
    },
    {
      id: 'eval_ekt_01',
      city: 'Ado-Ekiti (Official NIPOST Sandbox)',
      messy_input: 'NTA Road at the back of Fabian Hotel Basiri axis Ado Ekiti',
      expected_postcode: 'EK-01-A03-FK-01',
      expected_legacy: '360101',
    },
    {
      id: 'eval_los_03',
      city: 'Lagos (Sabo Yaba)',
      messy_input: '294 Herbert Macaulay Way near Sabo Bus Stop and CcHUB tech zone Yaba',
      expected_postcode: 'LA-19-D03-YB-12',
      expected_legacy: '101212',
    },
  ];

  const results = [];
  let matches = 0;
  for (const tc of goldenCases) {
    const resolved = await dispatchService.resolveAddressOrchestrated(tc.messy_input);
    const exactMatch = resolved.primary_match.postcode === tc.expected_postcode;
    if (exactMatch) matches += 1;
    results.push({
      ...tc,
      predicted_postcode: resolved.primary_match.postcode,
      predicted_legacy: resolved.primary_match.legacy_postal_code,
      exact_match: exactMatch,
      confidence: resolved.confidence,
      tool_calls: resolved.agent_trace.total_tool_calls,
      latency_ms: resolved.agent_trace.total_latency_ms,
      provider: resolved.agent_trace.provider_used,
      source: resolved.primary_match.source,
    });
  }

  const officialCases = results.filter((item) => item.source !== 'LOCAL_DEVELOPMENT_FIXTURE').length;
  const totalToolCalls = results.reduce((sum, item) => sum + (Number(item.tool_calls) || 0), 0);

  res.json({
    summary: {
      total_cases: goldenCases.length,
      exact_building_matches: matches,
      accuracy_pct: Number(((matches / goldenCases.length) * 100).toFixed(1)),
      official_source_cases: officialCases,
      fixture_backed_cases: results.length - officialCases,
      avg_tool_calls: Number((totalToolCalls / results.length).toFixed(1)),
      note:
        officialCases === results.length
          ? 'Every case was answered from an official NIPOST source.'
          : 'Cases answered from the local development fixture check the resolution pipeline only. They are not a measure of real-world accuracy.',
    },
    cases: results,
  });
});

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof DispatchIdempotencyConflict) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
});

// ============================================================================
// Server Startup & Background OpenSky Live Transponder Poller
// ============================================================================
const PORT = Number(process.env.PORT || 4000);

if (require.main === module) {
  store.initialize().then(async () => {
    try {
      await workspaceAuthService.ensureSchema();
      await workspaceFieldTeamService.ensureSchema();
      await taskLifecycleService.ensureSchema();
    } catch (error) {
      console.error('[ResolveGrid API] Workspace access schema unavailable:', error instanceof Error ? error.message : error);
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `[ResolveGrid API] Listening on http://0.0.0.0:${PORT} | MySQL: ${store.mysqlConnected} | Redis: ${store.redisConnected}`
      );
    });

    if (process.env.ENABLE_LIVE_TELEMETRY_WORKER !== 'false') {
      externalTelemetry.pollLiveOpenSkyTransponders().catch(() => {});
      const intervalMs = Number(process.env.TELEMETRY_POLL_INTERVAL_MS || 20000);
      setInterval(() => {
        externalTelemetry.pollLiveOpenSkyTransponders().catch(() => {});
      }, intervalMs);
    }
  });
}
