/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";

// A tiny in-memory stand-in for the Supabase client, for TESTS ONLY. It runs the real store modules' filters (eq, in, lte, gte, order, limit),
// so a test can prove that a store function cannot read or change another learner's rows. It is not a database: it checks no CHECK or foreign key.

type Row = Record<string, any>;
export type FakeTables = Record<string, Row[]>;

let tick = 0;
/** Strictly increasing timestamps, so two writes in one test are never tied. */
const stamp = () => new Date(Date.parse("2026-11-02T00:00:00Z") + ++tick).toISOString();

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any = null;
  private conflict: string[] | null = null;
  private returning = false;
  private order_: { col: string; asc: boolean } | null = null;
  private limit_ = Infinity;
  private single_: "one" | "maybe" | null = null;
  constructor(private tables: FakeTables, private table: string, private log: string[], private defaults: Row = {}) {}

  select() { if (this.op !== "select") this.returning = true; return this; }
  insert(row: Row | Row[]) { this.op = "insert"; this.payload = row; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; return this; }
  upsert(row: Row, o?: { onConflict?: string }) { this.op = "upsert"; this.payload = row; this.conflict = o?.onConflict?.split(",") ?? null; return this; }
  delete() { this.op = "delete"; return this; }
  eq(col: string, v: unknown) { this.filters.push(r => r[col] === v); return this; }
  in(col: string, vs: readonly unknown[]) { this.filters.push(r => vs.includes(r[col])); return this; }
  lte(col: string, v: any) { this.filters.push(r => r[col] <= v); return this; }
  gte(col: string, v: any) { this.filters.push(r => r[col] >= v); return this; }
  not(col: string, _op: string, v: unknown) { this.filters.push(r => r[col] !== v); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.order_ = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.limit_ = n; return this; }
  maybeSingle() { this.single_ = "maybe"; return this; }
  single() { this.single_ = "one"; return this; }

  private run(): { data: any; error: any } {
    const t = (this.tables[this.table] ??= []);
    this.log.push(`${this.op} ${this.table}`);
    const match = () => t.filter(r => this.filters.every(f => f(r)));
    let out: Row[] = [];
    if (this.op === "select") out = match();
    else if (this.op === "insert") {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const row = { id: randomUUID(), created_at: stamp(), updated_at: stamp(), ...this.defaults, ...p };
        t.push(row); out.push(row);
      }
    } else if (this.op === "update") { out = match(); for (const r of out) Object.assign(r, this.payload); }
    else if (this.op === "delete") { out = match(); for (const r of out) t.splice(t.indexOf(r), 1); }
    else if (this.op === "upsert") {
      const existing = this.conflict ? t.find(r => this.conflict!.every(c => r[c] === this.payload[c])) : undefined;
      if (existing) { Object.assign(existing, this.payload); out = [existing]; }
      else { const row = { id: randomUUID(), created_at: stamp(), ...this.payload }; t.push(row); out = [row]; }
    }
    if (this.order_) { const { col, asc } = this.order_; out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1)); }
    out = out.slice(0, this.limit_);
    const wantsRows = this.op === "select" || this.returning;
    if (this.single_) {
      if (!wantsRows) return { data: null, error: null };
      if (!out.length) return this.single_ === "one" ? { data: null, error: { code: "PGRST116", message: "no rows" } } : { data: null, error: null };
      return { data: out[0], error: null };
    }
    return { data: wantsRows ? out : null, error: null };
  }
  then<A, B>(ok?: ((v: { data: any; error: any }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    try { return Promise.resolve(this.run()).then(ok, bad); } catch (e) { return Promise.reject(e).then(ok, bad); }
  }
}

/** An in-memory admin client over `tables` (rows keyed by column name, as in the database). `defaults` are column defaults per table. `log` records "op table" for each statement. */
export function fakeAdmin(tables: FakeTables = {}, defaults: Record<string, Row> = {}): { from: (table: string) => Query; tables: FakeTables; log: string[] } {
  const log: string[] = [];
  return { from: (table: string) => new Query(tables, table, log, defaults[table]), tables, log };
}
