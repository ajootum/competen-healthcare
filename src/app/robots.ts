import type { MetadataRoute } from "next";

// WEB-STRAT-001 acceptance criteria: "SEO applied only to public pages" and "Authenticated workspaces
// excluded from search engine indexing."
//
// Both are one requirement in two sentences, and it is the kind that is never noticed as missing -- an
// authenticated workspace is not indexable in practice, because a crawler gets redirected to /login. But
// "in practice" is doing a lot of work there: a route that briefly ships without its auth gate, a shared
// link pasted into a public page, or a stray screenshot in a doc site, and workspace URLs start appearing
// in results. Declaring the exclusion costs nothing and does not depend on every gate being right forever.
//
// PUBLIC SURFACE, deliberately enumerated as an allow-list of what is crawlable rather than a guess:
//   /                          homepage
//   /students /professionals /practice /hospitals   the four Phase 1 landing pages
//   /quality                   secondary landing page (indexed; simply not in the primary menu)
//   /login /signup /forgot-password /reset-password  access pages
//   /verify/<token>            public passport verification -- see below
//
// /verify is DISALLOWED even though it is public and unauthenticated. The token is the access control, so
// a crawled and indexed share link would put a named clinician's competency record into search results.
// Unguessable is not the same as unpublished.
const AUTHENTICATED = [
  "/dashboard", "/healthcare-worker", "/supervisor", "/unit-manager", "/hospital-executive",
  "/competency-office", "/competency-studio", "/quality-accreditation", "/office-governance",
  "/enterprise-governance", "/human-resources", "/organisation-admin", "/platform-admin",
  "/super-admin", "/admin", "/assessor", "/educator", "/platform", "/actions", "/config-view",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        ...AUTHENTICATED.map(p => `${p}/`),
        ...AUTHENTICATED,
        "/api/",
        "/verify/",   // token-gated public page: reachable by link, never by search
      ],
    },
  };
}
