/**
 * A stand-in for the two Supabase services sync talks to — Auth and the REST
 * API — running on real Postgres (PGlite) with the real migrations applied.
 *
 * Test-only: nothing in the app imports this. It exists because the Docker
 * daemon is not available here, so a full local Supabase cannot run, and a
 * hand-written fake accepts anything: it would let a column the server does
 * not have, a row-level security hole or a broken trigger straight through.
 * With the migrations on real Postgres, those fail here exactly as they would
 * in production.
 *
 * Used two ways: in-process by the sync unit tests (`fakeSupabase.ts`), and
 * behind a small HTTP server for the browser suite (`scripts/fake-supabase.ts`),
 * where the real supabase-js client talks to it.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';

/** What Supabase provides before any migration runs. */
const SUPABASE_STUBS = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text unique not null);
  -- PostgREST puts the verified JWT's claims in the session; auth.uid() reads the subject.
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

/** A request the real REST API would refuse, with the status it would use. */
export class RestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'RestError';
  }
}

export async function createSupabaseDb(migrations: readonly string[]): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(SUPABASE_STUBS);
  for (const sql of migrations) await pg.exec(sql);
  return pg;
}

/** The account for an email, created on first sign-in as Supabase Auth does. */
export async function ensureUser(pg: PGlite, email: string): Promise<string> {
  const found = await pg.query<{ id: string }>('select id from auth.users where email = $1', [email]);
  if (found.rows[0]) return found.rows[0].id;
  const created = await pg.query<{ id: string }>(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id',
    [email],
  );
  return created.rows[0]!.id;
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Runs as the signed-in user, the way PostgREST does: the `authenticated` role,
 * with the JWT's subject where auth.uid() reads it. Row level security applies.
 */
async function asUser<T>(pg: PGlite, userId: string, run: (tx: Transaction) => Promise<T>): Promise<T> {
  return pg.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return run(tx);
  });
}

async function columnsOf(pg: PGlite, table: string): Promise<Set<string>> {
  const result = await pg.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1",
    [table],
  );
  if (result.rows.length === 0) {
    throw new RestError(`Could not find the table 'public.${table}' in the schema cache`, 404);
  }
  return new Set(result.rows.map((row) => row.column_name));
}

/**
 * `POST /rest/v1/<table>?on_conflict=id` with `resolution=merge-duplicates`:
 * insert, or update the row with that id. A column the table does not have is
 * refused, as PostgREST refuses it, rather than silently dropped.
 */
export async function upsertRows(
  pg: PGlite,
  userId: string,
  table: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  onConflict = 'id',
): Promise<void> {
  if (rows.length === 0) return;
  const known = await columnsOf(pg, table);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const unknown = columns.find((column) => !known.has(column));
  if (unknown) {
    throw new RestError(`Could not find the '${unknown}' column of '${table}' in the schema cache`);
  }

  const list = columns.map(ident).join(', ');
  const updates = columns
    .filter((column) => column !== onConflict)
    .map((column) => `${ident(column)} = excluded.${ident(column)}`)
    .join(', ');
  const sql =
    `insert into public.${ident(table)} (${list}) ` +
    `select ${list} from json_populate_recordset(null::public.${ident(table)}, $1::json) ` +
    `on conflict (${ident(onConflict)}) do ${updates ? `update set ${updates}` : 'nothing'}`;

  try {
    await asUser(pg, userId, (tx) => tx.query(sql, [JSON.stringify(rows)]));
  } catch (cause) {
    if (cause instanceof RestError) throw cause;
    throw new RestError(cause instanceof Error ? cause.message : String(cause));
  }
}

export interface SelectQuery {
  /** `column=gt.value` filters. */
  greaterThan?: Array<[column: string, value: string]>;
  order?: Array<{ column: string; ascending: boolean }>;
  offset?: number;
  limit?: number;
}

/**
 * `GET /rest/v1/<table>?select=*`, answered the way PostgREST answers it:
 * through json_agg, so timestamps come back as Postgres writes them in JSON
 * ("2026-08-01T10:00:00+00:00", not the client's own format) and numbers as
 * numbers.
 */
export async function selectRows(
  pg: PGlite,
  userId: string,
  table: string,
  query: SelectQuery = {},
): Promise<Array<Record<string, unknown>>> {
  const known = await columnsOf(pg, table);
  const params: unknown[] = [];
  const where = (query.greaterThan ?? []).map(([column, value]) => {
    if (!known.has(column)) throw new RestError(`column ${table}.${column} does not exist`);
    params.push(value);
    return `${ident(column)} > $${params.length}`;
  });
  for (const { column } of query.order ?? []) {
    if (!known.has(column)) throw new RestError(`column ${table}.${column} does not exist`);
  }
  const order = query.order?.length
    ? `order by ${query.order.map(({ column, ascending }) => `${ident(column)} ${ascending ? 'asc' : 'desc'}`).join(', ')}`
    : '';
  params.push(query.offset ?? 0);
  const offset = `offset $${params.length}`;
  let limit = '';
  if (query.limit !== undefined) {
    params.push(query.limit);
    limit = `limit $${params.length}`;
  }
  const sql =
    `select coalesce(json_agg(t), '[]'::json) as data from (` +
    `select * from public.${ident(table)} ${where.length ? `where ${where.join(' and ')}` : ''} ${order} ${offset} ${limit}` +
    `) t`;

  const result = await asUser(pg, userId, (tx) => tx.query<{ data: Array<Record<string, unknown>> }>(sql, params));
  return result.rows[0]?.data ?? [];
}

/** Every row of a table, regardless of owner — for a test to look at the server's copy. */
export async function serverRows(pg: PGlite, table: string): Promise<Array<Record<string, unknown>>> {
  const result = await pg.query<{ data: Array<Record<string, unknown>> }>(
    `select coalesce(json_agg(t), '[]'::json) as data from (select * from public.${ident(table)}) t`,
  );
  return result.rows[0]?.data ?? [];
}
