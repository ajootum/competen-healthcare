// HQ navigation search -- THE ONE MATCHER (owner SCHOLAR-SQIE-CLOSE-01, P2, 30 Oct 2026).
//
// The sidebar filter (WorkspaceSidebar.sidebarMatches) and Search HQ (search-catalogue.matchHqDestinations)
// both call matchNavSubject, so they cannot disagree about what a query finds. Pure: no I/O, no React.
//
// A destination is found by, in order of rank:
//   0  its label                 "Individual Policy"
//   1  its label + where it lives (workspace, group, parent)
//   2  + its optional `keywords`  synonyms and configuration terms ("configuration", "pubmed")
//   3  + its route words          /super-admin/individual/configuration -> "individual configuration"
// Every whitespace/slash/hyphen/underscore-separated term of the query must be found somewhere in that
// text. This decides what is FOUND, never what is REACHABLE: callers pass in only the entries the viewer's
// capabilities already allow (canSeeHqLink), so a page the viewer cannot open is never a candidate and its
// keywords never reach the browser.

export type NavSearchSubject = {
  label: string;
  href: string;
  /** Where it lives: workspace, group, parent. Null/undefined parts are skipped. */
  trail: (string | null | undefined)[];
  keywords?: string[];
};

export type NavSearchHit = {
  /** Lower is better: 0 label, 1 label+location, 2 needed keywords, 3 needed the route. */
  rank: number;
  /** Keywords that carried the match (only when rank is 2 or 3), for a subtle "matches: ..." note. */
  via: string[];
};

const SEPARATORS = /[\s/\_\-.]+/;

/** "/super-admin/individual/configuration?x=1" -> "individual configuration". The shared prefix is dropped. */
export function routeWords(href: string): string {
  return href.split("?")[0].split("#")[0].split("/").filter(Boolean)
    .filter(seg => seg !== "super-admin")
    .join(" ").replace(/[_\-.]+/g, " ").toLowerCase();
}

/** Query -> terms. Slashes, hyphens and underscores split like spaces, so "individual/configuration" works. */
export function navSearchTerms(query: string): string[] {
  return query.toLowerCase().split(SEPARATORS).filter(Boolean);
}

const plain = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ");

/** null when the subject does not match every term. */
export function matchNavSubject(subject: NavSearchSubject, terms: string[]): NavSearchHit | null {
  if (terms.length === 0) return null;
  const label = plain(subject.label);
  const base = [label, ...subject.trail.filter((t): t is string => !!t).map(plain)].join(" ");
  const all = (text: string) => terms.every(t => text.includes(t));
  if (all(label)) return { rank: 0, via: [] };
  if (all(base)) return { rank: 1, via: [] };

  const keywords = (subject.keywords ?? []).map(k => ({ raw: k, low: plain(k) }));
  const withKeywords = `${base} ${keywords.map(k => k.low).join(" ")}`;
  const rank = all(withKeywords) ? 2 : all(`${withKeywords} ${routeWords(subject.href)}`) ? 3 : null;
  if (rank === null) return null;

  // The terms the label and location did not carry are the ones a keyword carried: name the fewest keywords
  // that cover them (the one covering most of the remaining terms first).
  let unmet = terms.filter(t => !base.includes(t));
  const via: string[] = [];
  while (unmet.length) {
    let best: { raw: string; covers: string[] } | null = null;
    for (const k of keywords) {
      const covers = unmet.filter(t => k.low.includes(t));
      if (covers.length && (!best || covers.length > best.covers.length)) best = { raw: k.raw, covers };
    }
    if (!best) break; // the rest came from the route
    via.push(best.raw);
    unmet = unmet.filter(t => !best!.covers.includes(t));
  }
  return { rank, via };
}
