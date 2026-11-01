import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { RowDataPacket } from 'mysql2/promise';
import { store } from '../config/datastore';

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const INVITE_TTL_HOURS = 72;

export type WorkspaceRole = 'OWNER' | 'DISPATCHER' | 'REVIEWER';

export interface WorkspaceUser {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  created_at: string;
}

export interface WorkspaceMembership {
  tenant_id: string;
  tenant_name: string;
  role: WorkspaceRole;
}

export interface WorkspaceSession {
  id: string;
  user: WorkspaceUser;
  workspaces: WorkspaceMembership[];
  expires_at: string;
}

interface OperatorAccount {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  active: number | boolean;
  created_at: Date | string;
}

interface UserRow extends RowDataPacket, OperatorAccount {}

function asIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

export class WorkspaceAuthService {
  private get pool() {
    if (!store.mysqlPool || !store.mysqlConnected) throw new Error('Workspace access requires an available MySQL database.');
    return store.mysqlPool;
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${derived.toString('hex')}`;
  }

  private async passwordMatches(password: string, encoded: string): Promise<boolean> {
    const [salt, stored] = encoded.split(':');
    if (!salt || !stored) return false;
    const derived = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(stored, 'hex');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  }

  private tokenHash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  public async ensureSchema(): Promise<void> {
    if (!store.mysqlPool || !store.mysqlConnected) return;
    const pool = store.mysqlPool;
    await pool.execute(`CREATE TABLE IF NOT EXISTS operator_users (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(254) NOT NULL UNIQUE,
      display_name VARCHAR(120) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_operator_active (active, email)
    ) ENGINE=InnoDB`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS workspace_memberships (
      user_id VARCHAR(64) NOT NULL,
      tenant_id VARCHAR(64) NOT NULL,
      role ENUM('OWNER', 'DISPATCHER', 'REVIEWER') NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tenant_id),
      CONSTRAINT fk_workspace_member_user FOREIGN KEY (user_id) REFERENCES operator_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_workspace_member_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      INDEX idx_workspace_member_tenant (tenant_id, role)
    ) ENGINE=InnoDB`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS workspace_invitations (
      id VARCHAR(64) PRIMARY KEY,
      tenant_id VARCHAR(64) NOT NULL,
      email VARCHAR(254) NOT NULL,
      role ENUM('DISPATCHER', 'REVIEWER') NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      invited_by_user_id VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      accepted_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_workspace_invite_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      CONSTRAINT fk_workspace_invite_sender FOREIGN KEY (invited_by_user_id) REFERENCES operator_users(id) ON DELETE CASCADE,
      INDEX idx_workspace_invite_email (email, expires_at)
    ) ENGINE=InnoDB`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS operator_sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_operator_session_user FOREIGN KEY (user_id) REFERENCES operator_users(id) ON DELETE CASCADE,
      INDEX idx_operator_session_lookup (token_hash, expires_at)
    ) ENGINE=InnoDB`);
    await pool.execute(`CREATE TABLE IF NOT EXISTS auth_audit_events (
      id VARCHAR(64) PRIMARY KEY,
      actor_user_id VARCHAR(64) DEFAULT NULL,
      tenant_id VARCHAR(64) DEFAULT NULL,
      event_type VARCHAR(64) NOT NULL,
      metadata JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_auth_audit_tenant (tenant_id, created_at),
      INDEX idx_auth_audit_actor (actor_user_id, created_at)
    ) ENGINE=InnoDB`);
  }

  private async audit(eventType: string, actorUserId?: string, tenantId?: string, metadata?: Record<string, unknown>): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO auth_audit_events (id, actor_user_id, tenant_id, event_type, metadata)
         VALUES (?, ?, ?, ?, ?)`,
        [
          `audit_${crypto.randomUUID().slice(0, 22)}`,
          actorUserId || null,
          tenantId || null,
          eventType,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
    } catch {
      // Audit writes must not turn a completed access action into a false failure.
    }
  }

  private toSafeUser(row: OperatorAccount): WorkspaceUser {
    return {
      id: row.id,
      email: row.email.toLowerCase(),
      display_name: row.display_name,
      active: Boolean(row.active),
      created_at: asIso(row.created_at),
    };
  }

  private async membershipsFor(userId: string): Promise<WorkspaceMembership[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT m.tenant_id, t.name AS tenant_name, m.role
         FROM workspace_memberships m
         INNER JOIN tenants t ON t.id = m.tenant_id
        WHERE m.user_id = ? AND t.active = TRUE
        ORDER BY t.created_at ASC`,
      [userId]
    );
    return rows.map((row) => ({
      tenant_id: String(row.tenant_id),
      tenant_name: String(row.tenant_name),
      role: row.role as WorkspaceRole,
    }));
  }

  private async createSession(user: WorkspaceUser): Promise<{ cookie: string; session: WorkspaceSession }> {
    const token = crypto.randomBytes(32).toString('base64url');
    const id = `ops_${crypto.randomUUID().slice(0, 22)}`;
    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
    await this.pool.execute(
      `INSERT INTO operator_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
      [id, user.id, this.tokenHash(token), expiresAt]
    );
    return {
      cookie: `${id}.${token}`,
      session: { id, user, workspaces: await this.membershipsFor(user.id), expires_at: expiresAt.toISOString() },
    };
  }

  public async bootstrapWorkspace(params: {
    workspaceId: string;
    workspaceName: string;
    ownerEmail: string;
    ownerName: string;
    password: string;
  }): Promise<{ session: WorkspaceSession; cookie: string }> {
    const workspaceId = params.workspaceId.trim().toLowerCase();
    const email = params.ownerEmail.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(workspaceId)) throw new Error('Workspace ID must use lowercase letters, numbers, or underscores and start with a letter.');
    if (!email.includes('@')) throw new Error('Provide a valid owner email.');
    if (params.ownerName.trim().length < 2) throw new Error('Provide the owner’s display name.');
    if (params.password.length < 12 || params.password.length > 128) throw new Error('Passwords must be 12–128 characters.');

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [existingWorkspace] = await connection.execute<RowDataPacket[]>('SELECT id FROM tenants WHERE id = ? LIMIT 1', [workspaceId]);
      if (existingWorkspace.length) throw new Error('That workspace ID already exists.');
      const [existingUser] = await connection.execute<RowDataPacket[]>('SELECT id FROM operator_users WHERE email = ? LIMIT 1', [email]);
      if (existingUser.length) throw new Error('That email already has an operator account.');
      const userId = `ou_${crypto.randomUUID().slice(0, 22)}`;
      await connection.execute(
        `INSERT INTO tenants (id, name, industry_vertical, max_search_radius_m, required_lookup_level, sla_target_sec, ml_profile, active)
         VALUES (?, ?, 'LOGISTICS', 6000, 3, 1800, 'logistics_eta_v1', TRUE)`,
        [workspaceId, params.workspaceName.trim()]
      );
      await connection.execute(
        `INSERT INTO operator_users (id, email, display_name, password_hash, active) VALUES (?, ?, ?, ?, TRUE)`,
        [userId, email, params.ownerName.trim(), await this.hashPassword(params.password)]
      );
      await connection.execute(
        `INSERT INTO workspace_memberships (user_id, tenant_id, role) VALUES (?, ?, 'OWNER')`,
        [userId, workspaceId]
      );
      await connection.commit();
      const user: WorkspaceUser = { id: userId, email, display_name: params.ownerName.trim(), active: true, created_at: new Date().toISOString() };
      const result = await this.createSession(user);
      await this.audit('WORKSPACE_BOOTSTRAPPED', userId, workspaceId, { workspace_name: params.workspaceName.trim() });
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async login(emailInput: string, password: string): Promise<{ session: WorkspaceSession; cookie: string } | null> {
    const email = emailInput.trim().toLowerCase();
    const [rows] = await this.pool.execute<UserRow[]>('SELECT id, email, display_name, password_hash, active, created_at FROM operator_users WHERE email = ? LIMIT 1', [email]);
    const row = rows[0];
    if (!row || !Boolean(row.active) || !(await this.passwordMatches(password, row.password_hash))) return null;
    const user = this.toSafeUser(row);
    await this.pool.execute('UPDATE operator_users SET last_login_at = NOW() WHERE id = ?', [user.id]);
    const result = await this.createSession(user);
    await this.audit('OPERATOR_SIGNED_IN', user.id);
    return result;
  }

  public async sessionFromCookie(header?: string): Promise<WorkspaceSession | null> {
    const raw = readCookie(header, 'rg_operator_session');
    if (!raw) return null;
    const dot = raw.indexOf('.');
    if (dot < 1) return null;
    const id = raw.slice(0, dot);
    const token = raw.slice(dot + 1);
    const [rows] = await this.pool.execute<UserRow[]> (
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.active, u.created_at, s.expires_at
         FROM operator_sessions s INNER JOIN operator_users u ON u.id = s.user_id
        WHERE s.id = ? AND s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > NOW() LIMIT 1`,
      [id, this.tokenHash(token)]
    );
    const row = rows[0] as (UserRow & { expires_at: Date | string }) | undefined;
    if (!row || !Boolean(row.active)) return null;
    return { id, user: this.toSafeUser(row), workspaces: await this.membershipsFor(row.id), expires_at: asIso(row.expires_at) };
  }

  public async logout(cookieHeader?: string): Promise<void> {
    const raw = readCookie(cookieHeader, 'rg_operator_session');
    if (!raw) return;
    const dot = raw.indexOf('.');
    if (dot < 1) return;
    await this.pool.execute('UPDATE operator_sessions SET revoked_at = NOW() WHERE id = ? AND token_hash = ?', [raw.slice(0, dot), this.tokenHash(raw.slice(dot + 1))]);
  }

  public async authorize(cookieHeader: string | undefined, tenantId: string, roles?: WorkspaceRole[]): Promise<WorkspaceSession | null> {
    const session = await this.sessionFromCookie(cookieHeader);
    if (!session) return null;
    const membership = session.workspaces.find((workspace) => workspace.tenant_id === tenantId);
    if (!membership || (roles && !roles.includes(membership.role))) return null;
    return session;
  }

  public async createInvitation(params: { actor: WorkspaceSession; tenantId: string; email: string; role: WorkspaceRole }): Promise<{ id: string; token: string; expires_at: string }> {
    if (!['DISPATCHER', 'REVIEWER'].includes(params.role)) throw new Error('Only dispatcher and reviewer invitations are available from the web workspace.');
    const membership = params.actor.workspaces.find((workspace) => workspace.tenant_id === params.tenantId);
    if (!membership || membership.role !== 'OWNER') throw new Error('Only a workspace owner can invite an operator.');
    const email = params.email.trim().toLowerCase();
    if (!email.includes('@')) throw new Error('Provide a valid invitation email.');
    const id = `inv_${crypto.randomUUID().slice(0, 22)}`;
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    await this.pool.execute(
      `INSERT INTO workspace_invitations (id, tenant_id, email, role, token_hash, invited_by_user_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, params.tenantId, email, params.role, this.tokenHash(token), params.actor.user.id, expiresAt]
    );
    await this.audit('WORKSPACE_INVITE_CREATED', params.actor.user.id, params.tenantId, { email, role: params.role });
    return { id, token, expires_at: expiresAt.toISOString() };
  }

  public async acceptInvitation(params: { token: string; displayName: string; password: string }): Promise<{ session: WorkspaceSession; cookie: string }> {
    if (params.displayName.trim().length < 2) throw new Error('Provide a display name.');
    if (params.password.length < 12 || params.password.length > 128) throw new Error('Passwords must be 12–128 characters.');
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, tenant_id, email, role FROM workspace_invitations
          WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
        [this.tokenHash(params.token)]
      );
      const invite = rows[0];
      if (!invite) throw new Error('This invitation is invalid, expired, or already used.');
      const [existingUsers] = await connection.execute<UserRow[]>('SELECT id, email, display_name, password_hash, active, created_at FROM operator_users WHERE email = ? LIMIT 1', [invite.email]);
      let user: OperatorAccount | undefined = existingUsers[0];
      if (!user) {
        const id = `ou_${crypto.randomUUID().slice(0, 22)}`;
        await connection.execute(
          `INSERT INTO operator_users (id, email, display_name, password_hash, active) VALUES (?, ?, ?, ?, TRUE)`,
          [id, invite.email, params.displayName.trim(), await this.hashPassword(params.password)]
        );
        user = { id, email: invite.email, display_name: params.displayName.trim(), password_hash: '', active: true, created_at: new Date() };
      }
      if (!Boolean(user.active)) throw new Error('This operator account is inactive.');
      // An invitation is a capability to join a workspace, not a substitute for
      // authenticating an account that already exists. New users establish their
      // password above; existing users must prove theirs before we issue a session.
      if (existingUsers.length && !(await this.passwordMatches(params.password, user.password_hash))) {
        throw new Error('Use the password for your existing ResolveGrid operator account.');
      }
      await connection.execute(
        `INSERT INTO workspace_memberships (user_id, tenant_id, role) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE role = VALUES(role)`,
        [user.id, invite.tenant_id, invite.role]
      );
      await connection.execute('UPDATE workspace_invitations SET accepted_at = NOW() WHERE id = ?', [invite.id]);
      await connection.commit();
      const safeUser = this.toSafeUser(user);
      const result = await this.createSession(safeUser);
      await this.audit('WORKSPACE_INVITE_ACCEPTED', safeUser.id, String(invite.tenant_id), { role: invite.role });
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const workspaceAuthService = new WorkspaceAuthService();
