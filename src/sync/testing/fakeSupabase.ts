/**
 * An in-process Supabase client for the sync tests, backed by real Postgres
 * with the real migrations (see `pgRest.ts`). Test-only.
 *
 * It answers the calls the sync layer makes — `from().upsert()`,
 * `from().select().gt().order().range()` and the handful of auth methods —
 * through the same SQL a hosted project would run, as the signed-in user, with
 * row level security and the newest-write-wins trigger in force.
 */
import type { PGlite } from '@electric-sql/pglite';
import { RestError, createSupabaseDb, ensureUser, selectRows, serverRows, upsertRows, type SelectQuery } from './pgRest';

const migrationFiles = import.meta.glob('../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every migration, in the order the CLI would apply them. */
export const MIGRATIONS = Object.keys(migrationFiles)
  .sort()
  .map((path) => migrationFiles[path]!);

interface FakeUser {
  id: string;
  email: string;
}

type AuthListener = (event: string, session: { user: FakeUser } | null) => void;

export interface FakeSupabase {
  pg: PGlite;
  /** What `getClient()` hands the sync layer. */
  client: unknown;
  /** The code the last email to this address carried. */
  codeFor(email: string): string | undefined;
  /** Signs straight in, as entering the emailed code would. */
  signIn(email: string): Promise<string>;
  /** Forgets the session, as wiping the phone's storage would. */
  forgetSession(): void;
  /** The server's copy of a table, whoever owns the rows. */
  rows(table: string): Promise<Array<Record<string, unknown>>>;
  /** Makes uploads fail until cleared, as a dropped connection would. */
  failUploads(message: string | null): void;
  /** Every upload request, by table and size. */
  uploads: Array<{ table: string; rows: number }>;
}

export async function createFakeSupabase(): Promise<FakeSupabase> {
  const pg = await createSupabaseDb(MIGRATIONS);
  const codes = new Map<string, string>();
  const listeners = new Set<AuthListener>();
  const uploads: Array<{ table: string; rows: number }> = [];
  let session: { access_token: string; user: FakeUser } | null = null;
  let uploadFailure: string | null = null;

  const notify = (event: string) => {
    for (const listener of listeners) listener(event, session);
  };

  const startSession = async (email: string) => {
    const id = await ensureUser(pg, email);
    session = { access_token: `token-${id}`, user: { id, email } };
    notify('SIGNED_IN');
    return id;
  };

  const auth = {
    async getSession() {
      return { data: { session }, error: null };
    },
    async signInWithOtp({ email }: { email: string }) {
      codes.set(email, String(100000 + codes.size * 7919).slice(0, 6));
      return { data: { user: null, session: null }, error: null };
    },
    async verifyOtp({ email, token }: { email: string; token: string; type: string }) {
      if (!token || codes.get(email) !== token) {
        return {
          data: { user: null, session: null },
          error: { message: 'Token has expired or is invalid', status: 403 },
        };
      }
      await startSession(email);
      return { data: { user: session!.user, session }, error: null };
    },
    async signOut() {
      session = null;
      notify('SIGNED_OUT');
      return { error: null };
    },
    onAuthStateChange(listener: AuthListener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    },
  };

  const failure = (cause: unknown) => ({
    data: null,
    error: { message: cause instanceof Error ? cause.message : String(cause) },
  });

  const from = (table: string) => ({
    async upsert(rows: Array<Record<string, unknown>>, options: { onConflict?: string } = {}) {
      try {
        if (uploadFailure) throw new RestError(uploadFailure, 503);
        if (!session) throw new RestError('JWT expired', 401);
        uploads.push({ table, rows: rows.length });
        await upsertRows(pg, session.user.id, table, rows, options.onConflict ?? 'id');
        return { data: null, error: null };
      } catch (cause) {
        return failure(cause);
      }
    },
    // Lazy and chainable like the real builder: nothing runs until awaited.
    select(_columns = '*') {
      const query: SelectQuery = {};
      const chain = {
        gt(column: string, value: string) {
          (query.greaterThan ??= []).push([column, value]);
          return chain;
        },
        order(column: string, options: { ascending?: boolean } = {}) {
          (query.order ??= []).push({ column, ascending: options.ascending ?? true });
          return chain;
        },
        range(fromIndex: number, toIndex: number) {
          query.offset = fromIndex;
          query.limit = toIndex - fromIndex + 1;
          return chain;
        },
        then<T>(resolve: (value: { data: unknown; error: unknown }) => T, reject?: (reason: unknown) => T) {
          const run = async () => {
            try {
              if (!session) throw new RestError('JWT expired', 401);
              return { data: await selectRows(pg, session.user.id, table, query), error: null };
            } catch (cause) {
              return failure(cause);
            }
          };
          return run().then(resolve, reject);
        },
      };
      return chain;
    },
  });

  return {
    pg,
    client: { auth, from },
    codeFor: (email) => codes.get(email),
    signIn: startSession,
    forgetSession: () => {
      session = null;
    },
    rows: (table) => serverRows(pg, table),
    failUploads: (message) => {
      uploadFailure = message;
    },
    uploads,
  };
}
