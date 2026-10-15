/**
 * Stand-in for src/services/supabase.ts while the help screenshots are taken: an approved teacher is
 * signed in and the sample questions live in memory. Nothing leaves the browser.
 */
import { TEACHER, sampleProjects } from './fixtures';

type Row = Record<string, any>;
const now = () => new Date().toISOString();
const tables: Record<string, Row[]> = {
  profiles: [{ id: TEACHER.id, email: TEACHER.email, name: TEACHER.name, role: 'teacher', status: 'approved', preferences: {}, created_at: now() }],
  projects: sampleProjects(),
  studio_settings: [],
  feedback: [],
  messages: [],
};

/** `alias:data->a->>b` items of a PostgREST select, read from one row. */
function pick(row: Row, select: string): Row {
  if (!select || select.trim() === '*') return structuredClone(row);
  const out: Row = {};
  for (const item of select.split(',').map(s => s.trim()).filter(Boolean)) {
    const [alias, path] = item.includes(':') ? item.split(':') : [item, item];
    const parts = path.split(/->>?/);
    let value: any = row;
    for (const key of parts) value = value == null ? undefined : value[key];
    if (path.includes('->>') && value != null && typeof value !== 'string') value = typeof value === 'object' ? JSON.stringify(value) : String(value);
    out[alias] = value ?? null;
  }
  return out;
}

/** A column or JSON path (`data->>kind`) of one row, as PostgREST compares it. */
function valueAt(row: Row, column: string): unknown {
  return Object.values(pick(row, `v:${column}`))[0];
}

class Query implements PromiseLike<any> {
  private filters: Array<(row: Row) => boolean> = [];
  private columns = '*';
  private action: 'select' | 'upsert' | 'update' | 'delete' | 'insert' = 'select';
  private payload: any;
  private one: 'single' | 'maybe' | null = null;
  private sortBy: { column: string; ascending: boolean } | null = null;
  private window: [number, number] | null = null;
  constructor(private table: string) {}
  select(columns = '*') { this.columns = columns; return this; }
  eq(column: string, value: unknown) { this.filters.push(row => valueAt(row, column) === value); return this; }
  is(column: string, value: null) { this.filters.push(row => (valueAt(row, column) ?? null) === value); return this; }
  in(column: string, values: unknown[]) { this.filters.push(row => values.includes(row[column])); return this; }
  order(column: string, options: { ascending?: boolean } = {}) { this.sortBy = { column, ascending: options.ascending ?? true }; return this; }
  range(from: number, to: number) { this.window = [from, to]; return this; }
  limit(count: number) { this.window = [0, count - 1]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  upsert(payload: any) { this.action = 'upsert'; this.payload = payload; return this; }
  insert(payload: any) { this.action = 'insert'; this.payload = payload; return this; }
  update(payload: any) { this.action = 'update'; this.payload = payload; return this; }
  delete() { this.action = 'delete'; return this; }
  private run(): { data: any; error: null } {
    const table = (tables[this.table] ||= []);
    let rows: Row[];
    if (this.action === 'upsert' || this.action === 'insert') {
      rows = [].concat(this.payload).map((p: Row) => {
        const existing = table.find(r => r.id === p.id);
        if (existing) { Object.assign(existing, p, { updated_at: now() }); return existing; }
        const row = { created_at: now(), updated_at: now(), ...p };
        table.unshift(row);
        return row;
      });
    } else {
      rows = table.filter(row => this.filters.every(f => f(row)));
      if (this.action === 'update') rows.forEach(row => Object.assign(row, this.payload, { updated_at: now() }));
      if (this.action === 'delete') tables[this.table] = table.filter(row => !rows.includes(row));
    }
    if (this.sortBy) { const { column, ascending } = this.sortBy; rows = [...rows].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)); }
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    const data = rows.map(row => pick(row, this.columns));
    return { data: this.one ? data[0] ?? null : data, error: null };
  }
  then<A, B>(resolve?: ((value: any) => A | PromiseLike<A>) | null, reject?: ((reason: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject);
  }
}

const bucket = {
  createSignedUrl: async (path: string) => ({ data: { signedUrl: `/__help-fixtures/${path}` }, error: null }),
  createSignedUrls: async (paths: string[]) => ({ data: paths.map(path => ({ path, signedUrl: `/__help-fixtures/${path}`, error: null })), error: null }),
  upload: async () => ({ data: {}, error: null }),
  list: async () => ({ data: [], error: null }),
  remove: async () => ({ data: [], error: null }),
};

const user = { id: TEACHER.id, email: TEACHER.email, email_confirmed_at: '2026-09-01T00:00:00Z' };
export const supabase: any = {
  auth: {
    getUser: async () => ({ data: { user }, error: null }),
    getSession: async () => ({ data: { session: { access_token: 'help-screenshots', user } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => ({ error: null }),
    updateUser: async () => ({ data: { user }, error: null }),
  },
  from: (table: string) => new Query(table),
  rpc: async (name: string, args: any) => {
    if (name === 'update_my_profile') Object.assign(tables.profiles[0], { name: args.new_name, preferences: args.new_preferences });
    return { data: null, error: null };
  },
  storage: { from: () => bucket },
};

export function database() { return supabase; }
export async function authHeaders() { return { Authorization: 'Bearer help-screenshots' }; }
export async function googleSignInEnabled() { return false; }
export function takeOAuthError() { return null; }
export function rememberMe() { return true; }
export function setRememberMe() {}

/** Browser errors are not recorded in the screenshots. */
export function reportClientError(..._args: unknown[]) {}
