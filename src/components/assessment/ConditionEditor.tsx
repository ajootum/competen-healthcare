"use client";
// The visual IF / AND / OR / NOT tree. Generic over the leaf predicate so scoring rules and progression rules share it.
// A group is "all of" (AND) or "any of" (OR), can nest, and a NOT wraps one condition. Leaves are drawn by the caller.
import { condKind, type Cond, type Issue, type ValidationResult } from "@/lib/assessment/core";
import { Btn, Inline, issuesUnder, touchSm, focusRing, mutedText } from "./ui";

export interface CondEditorProps<P> {
  cond: Cond<P>;
  onChange: (c: Cond<P>) => void;
  /** path of this node in the document, as the validator reports it, for example "rules[0].when" */
  path: string;
  validation: ValidationResult;
  makeLeaf: () => P;
  renderLeaf: (leaf: P, set: (p: P) => void, path: string) => React.ReactNode;
  readOnly?: boolean;
}

interface NodeProps<P> extends CondEditorProps<P> { onRemove?: () => void; depth: number }

function here(v: ValidationResult, path: string): { errors: Issue[]; warnings: Issue[] } {
  return { errors: v.errors.filter((i) => i.path === path), warnings: v.warnings.filter((i) => i.path === path) };
}

function Node<P>(props: NodeProps<P>) {
  const { cond, onChange, path, validation, makeLeaf, renderLeaf, readOnly, onRemove, depth } = props;
  const kind = condKind(cond);

  if (kind === "leaf") {
    const iss = { errors: issuesUnder(validation.errors, path), warnings: issuesUnder(validation.warnings, path) };
    return (
      <div className="rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3" data-cond-leaf>
        {renderLeaf(cond as P, (p) => onChange(p as Cond<P>), path)}
        <Inline errors={iss.errors} warnings={iss.warnings} />
        {!readOnly ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn size="sm" kind="ghost" onClick={() => onChange({ not: cond } as Cond<P>)}>Wrap in NOT</Btn>
            {onRemove ? <Btn size="sm" kind="danger" onClick={onRemove}>Remove condition</Btn> : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (kind === "not") {
    const inner = (cond as { not: Cond<P> }).not;
    return (
      <div className="rounded-lg border border-dashed border-[var(--cmp-app-control-border)] p-3" data-cond-not>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded bg-[var(--cmp-surface-warning)] px-2 py-0.5 text-xs font-bold text-[var(--cmp-text-warning)]">NOT</span>
          {!readOnly ? <Btn size="sm" kind="ghost" onClick={() => onChange(inner)}>Remove NOT</Btn> : null}
        </div>
        <Node<P> {...props} cond={inner} path={`${path}.not`} depth={depth + 1} onChange={(c) => onChange({ not: c } as Cond<P>)} onRemove={undefined} />
      </div>
    );
  }

  if (kind === "all" || kind === "any") {
    const list = (cond as unknown as Record<string, Cond<P>[]>)[kind];
    const word = kind === "all" ? "AND" : "OR";
    const setList = (l: Cond<P>[]) => onChange({ [kind]: l } as unknown as Cond<P>);
    const own = here(validation, `${path}.${kind}`);
    return (
      <div className="rounded-lg border border-[var(--cmp-app-border)] border-l-4 border-l-[var(--cmp-theme-accent)] bg-[var(--cmp-app-bg)] p-3" data-cond-group={kind}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className={`flex items-center gap-2 text-xs font-semibold ${mutedText}`}>
            <span>Combine with</span>
            <select
              aria-label={`Combine conditions ${path}`} value={kind} disabled={readOnly}
              onChange={(e) => onChange({ [e.target.value]: list } as unknown as Cond<P>)}
              className={`rounded-lg border border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] px-2 text-sm text-[var(--cmp-app-text)] ${touchSm} ${focusRing}`}
            >
              <option value="all">ALL of these (AND)</option>
              <option value="any">ANY of these (OR)</option>
            </select>
          </label>
          {onRemove && !readOnly ? <Btn size="sm" kind="danger" onClick={onRemove}>Remove group</Btn> : null}
        </div>
        <div className="flex flex-col gap-2">
          {list.map((c, i) => (
            <div key={i} className="flex flex-col gap-2">
              {i > 0 ? <span className={`self-start px-1 text-xs font-bold ${mutedText}`}>{word}</span> : null}
              <Node<P> {...props} cond={c} path={`${path}.${kind}[${i}]`} depth={depth + 1} onChange={(n) => setList(list.map((x, k) => (k === i ? n : x)))} onRemove={() => setList(list.filter((_x, k) => k !== i))} />
            </div>
          ))}
        </div>
        <Inline errors={own.errors} warnings={own.warnings} />
        {!readOnly ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn size="sm" onClick={() => setList([...list, makeLeaf() as Cond<P>])}>Add condition</Btn>
            <Btn size="sm" onClick={() => setList([...list, { all: [makeLeaf()] } as unknown as Cond<P>])}>Add group</Btn>
          </div>
        ) : null}
      </div>
    );
  }

  const own = here(validation, path);
  return (
    <div className="rounded-lg border border-[var(--cmp-color-critical)] p-3 text-sm">
      <p>This condition is not one the builder understands.</p>
      <Inline errors={own.errors} warnings={own.warnings} />
      {!readOnly ? <Btn size="sm" onClick={() => onChange(makeLeaf() as Cond<P>)}>Replace with a new condition</Btn> : null}
    </div>
  );
}

/** The root of a condition, labelled IF. The root can be a single condition or a group. */
export function ConditionEditor<P>(props: CondEditorProps<P>) {
  return (
    <div className="flex flex-col gap-1" data-cond-root>
      <span className="text-xs font-bold text-[var(--cmp-theme-ink)]">IF</span>
      <Node<P> {...props} depth={0} onRemove={undefined} />
      {!props.readOnly && condKind(props.cond) === "leaf" ? (
        <div className="mt-1 flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => props.onChange({ all: [props.cond, props.makeLeaf()] } as unknown as Cond<P>)}>Add AND</Btn>
          <Btn size="sm" onClick={() => props.onChange({ any: [props.cond, props.makeLeaf()] } as unknown as Cond<P>)}>Add OR</Btn>
        </div>
      ) : null}
    </div>
  );
}
