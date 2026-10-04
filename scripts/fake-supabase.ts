/**
 * A stand-in Supabase project over HTTP, for the backup browser suite.
 *
 * Serves the slice of Auth and the REST API the app's real supabase-js client
 * calls — password sign-in, sessions, upsert and select — on real Postgres
 * (PGlite) with the real migrations applied, so row level security and the
 * newest-write-wins trigger are in force. Not for anything but tests: accounts
 * are made through /__test as the dashboard's Add user would, passwords are
 * held in memory, and tokens are not signed.
 *
 *   npx tsx scripts/fake-supabase.ts --port 54329
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RestError,
  createSupabaseDb,
  ensureUser,
  selectRows,
  serverRows,
  upsertRows,
  type SelectQuery,
} from '../src/sync/testing/pgRest';

const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > -1 ? process.argv[portArg + 1] : (process.env['PORT'] ?? 54329));

const dir = resolve(import.meta.dirname, '../supabase/migrations');
const migrations = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(resolve(dir, file), 'utf8'));
const pg = await createSupabaseDb(migrations);

/** Accounts and their passwords, as Authentication → Users → Add user makes them. */
const passwords = new Map<string, string>();
/** Access and refresh tokens to the account they belong to. */
const sessions = new Map<string, { id: string; email: string }>();

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function issueSession(user: { id: string; email: string }) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: user.id,
    email: user.email,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 3600,
    session_id: crypto.randomUUID(),
  };
  const accessToken = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(claims)}.stand-in`;
  const refreshToken = crypto.randomUUID();
  sessions.set(accessToken, user);
  sessions.set(refreshToken, user);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: claims.exp,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

function bearerUser(request: IncomingMessage) {
  const header = request.headers['authorization'] ?? '';
  const token = header.replace(/^Bearer\s+/i, '');
  return sessions.get(token) ?? null;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

function send(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

/** PostgREST's query string, the parts the sync pull uses. */
function parseSelect(params: URLSearchParams): SelectQuery {
  const query: SelectQuery = {};
  for (const [key, value] of params) {
    if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(key)) continue;
    const match = /^gt\.(.*)$/.exec(value);
    if (!match) throw new RestError(`unsupported filter ${key}=${value}`);
    (query.greaterThan ??= []).push([key, match[1]!]);
  }
  const order = params.get('order');
  if (order) {
    query.order = order.split(',').map((part) => {
      const [column, direction] = part.split('.');
      return { column: column!, ascending: direction !== 'desc' };
    });
  }
  if (params.has('offset')) query.offset = Number(params.get('offset'));
  if (params.has('limit')) query.limit = Number(params.get('limit'));
  return query;
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // ---- What a test reads instead of an inbox and a dashboard ----
  if (path === '/__test/users' && request.method === 'POST') {
    const { email, password } = (await readBody(request)) as { email: string; password: string };
    passwords.set(email, password);
    return send(response, 201, { id: await ensureUser(pg, email) });
  }
  if (path === '/__test/rows') {
    return send(response, 200, await serverRows(pg, url.searchParams.get('table') ?? ''));
  }

  // ---- Auth ----
  if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const { email, password } = (await readBody(request)) as { email: string; password: string };
    // One answer for an unknown account and a wrong password, as Supabase gives.
    if (!passwords.has(email) || passwords.get(email) !== password) {
      return send(response, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    return send(response, 200, issueSession({ id: await ensureUser(pg, email), email }));
  }
  if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const { refresh_token: refresh } = (await readBody(request)) as { refresh_token: string };
    const user = sessions.get(refresh);
    if (!user) return send(response, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    return send(response, 200, issueSession(user));
  }
  if (path === '/auth/v1/user') {
    const user = bearerUser(request);
    return user ? send(response, 200, issueSession(user).user) : send(response, 401, { msg: 'invalid JWT' });
  }
  if (path === '/auth/v1/logout') return send(response, 204);

  // ---- REST ----
  const rest = /^\/rest\/v1\/([a-z_]+)$/.exec(path);
  if (rest) {
    const table = rest[1]!;
    const user = bearerUser(request);
    if (!user) return send(response, 401, { code: 'PGRST301', message: 'JWT expired' });
    if (request.method === 'POST') {
      const body = await readBody(request);
      const rows = (Array.isArray(body) ? body : [body]) as Array<Record<string, unknown>>;
      await upsertRows(pg, user.id, table, rows, url.searchParams.get('on_conflict') ?? 'id');
      return send(response, 201);
    }
    if (request.method === 'GET') {
      return send(response, 200, await selectRows(pg, user.id, table, parseSelect(url.searchParams)));
    }
  }

  send(response, 404, { message: `stand-in has no ${request.method} ${path}` });
}

createServer((request, response) => {
  // The app is served from another port, so every answer is cross-origin.
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.setHeader(
    'Access-Control-Allow-Headers',
    request.headers['access-control-request-headers'] ?? 'authorization, apikey, content-type, prefer',
  );
  response.setHeader('Access-Control-Max-Age', '600');
  if (request.method === 'OPTIONS') return send(response, 204);

  handle(request, response).catch((cause: unknown) => {
    const status = cause instanceof RestError ? cause.status : 500;
    send(response, status, { message: cause instanceof Error ? cause.message : String(cause) });
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`stand-in Supabase listening on http://127.0.0.1:${PORT}`);
});
