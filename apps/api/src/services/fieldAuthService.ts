import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { FieldAgentAccount, store } from '../config/datastore';

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface FieldSession {
  sub: string;
  agent_id: string;
  email: string;
  display_name: string;
  role: 'FIELD_AGENT';
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export class FieldAuthService {
  private get sessionSecret(): string | null {
    return process.env.FIELD_SESSION_SECRET?.trim() || null;
  }

  private sign(payload: Omit<FieldSession, 'exp'>): string {
    const secret = this.sessionSecret;
    if (!secret) throw new Error('Field-agent sessions are not configured on this server.');
    const body = encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }));
    const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${signature}`;
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

  public verifyAuthorization(header?: string): FieldSession | null {
    const secret = this.sessionSecret;
    if (!secret || !header?.startsWith('Bearer ')) return null;
    const [body, signature] = header.slice('Bearer '.length).split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
      return null;
    }
    try {
      const session = JSON.parse(decode(body)) as FieldSession;
      if (
        session.role !== 'FIELD_AGENT' ||
        !session.sub ||
        !session.agent_id ||
        !session.email ||
        session.exp <= Math.floor(Date.now() / 1000)
      ) {
        return null;
      }
      const account = store.fieldAgentById.get(session.sub);
      return account?.active && account.agent_id === session.agent_id ? session : null;
    } catch {
      return null;
    }
  }

  public async provision(params: {
    agentId: string;
    email: string;
    displayName: string;
    password: string;
  }): Promise<Omit<FieldAgentAccount, 'password_hash'>> {
    if (!store.mysqlConnected) {
      throw new Error('Field-agent provisioning requires an available MySQL database.');
    }
    const email = params.email.trim().toLowerCase();
    if (store.fieldAgentByEmail.has(email)) throw new Error('A field agent already uses this email.');
    if (!store.agentMap.has(params.agentId)) throw new Error('Provision a registered dispatch agent ID.');
    if (params.password.length < 12 || params.password.length > 128) {
      throw new Error('Field-agent passwords must be 12–128 characters.');
    }

    const account: FieldAgentAccount = {
      id: `fa_${crypto.randomUUID().slice(0, 18)}`,
      agent_id: params.agentId,
      email,
      display_name: params.displayName.trim(),
      password_hash: await this.hashPassword(params.password),
      active: true,
      created_at: new Date().toISOString(),
      last_login_at: null,
    };
    await store.saveFieldAgent(account);
    const { password_hash: _passwordHash, ...safeAccount } = account;
    return safeAccount;
  }

  public async login(emailInput: string, password: string): Promise<{
    access_token: string;
    expires_in_sec: number;
    agent: Omit<FieldAgentAccount, 'password_hash'>;
  } | null> {
    const email = emailInput.trim().toLowerCase();
    const account = store.fieldAgentByEmail.get(email);
    if (!account || !account.active || !(await this.passwordMatches(password, account.password_hash))) {
      return null;
    }
    await store.markFieldAgentLogin(account.id);
    const { password_hash: _passwordHash, ...agent } = account;
    return {
      access_token: this.sign({
        sub: account.id,
        agent_id: account.agent_id,
        email: account.email,
        display_name: account.display_name,
        role: 'FIELD_AGENT',
      }),
      expires_in_sec: SESSION_TTL_SECONDS,
      agent,
    };
  }
}

export const fieldAuthService = new FieldAuthService();
