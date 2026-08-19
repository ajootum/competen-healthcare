# COMP-ENG-002G §5 — journeys 4-7 blocked: the sign-in page does not hydrate locally

**2026-08-19.** The fixture is ready and the suite reaches the sign-in form. Authentication never
happens, and the cause is not the fixture, the credentials, or the app's own code.

## What the fixture achieved

```
3 passed  (credential-free journeys 1-3)
4 failed  (authenticated journeys 4-7)
```

Provisioning is complete: one ACTIVE workspace, exactly one membership so no chooser, 60 capability
grants from the owner role and nothing added, and `practice_sign_in` enabled on staging.

## The blocker, measured

| Probe | Result |
|---|---|
| URL after clicking "Sign in" | `/practice/sign-in?` — the bare `?` is a **native GET submit** |
| Button text after clicking | still "Sign in", never "Signing in…" — the React handler never ran |
| Hosts contacted | `127.0.0.1:3100` only — **no Supabase request is ever made** |
| Non-2xx responses | **`403` on `/_next/static/chunks/node_modules_next_dist_20wefz_._.js`** |
| Same chunk fetched by `curl` | **`200`** |
| HMR WebSocket | handshake fails, `ERR_INVALID_HTTP_RESPONSE` |

A Next.js runtime chunk is refused to the browser and served to curl. Without it React cannot hydrate,
so the form is inert markup and the click falls through to the browser's default submission.

**Reproduced on both ports (3000 and 3100), against both the production- and staging-pointed servers,
and a reload does not clear it.** It is therefore not staging-specific and not caused by the fixture.

## It is not the application's middleware

`src/proxy.ts` **excludes** `_next/static` in its matcher and contains no 403 path at all. Checked
rather than assumed.

## Most likely cause, and how to settle it

Local HTTP interception. The signature — a 403 to the browser but 200 to curl, plus a WebSocket upgrade
failing with `ERR_INVALID_HTTP_RESPONSE` — is what an intercepting security product produces. This
machine has a recorded history of exactly this class: TLS to the database port was being reset earlier
the same day, and changing network provider fixed it.

Two discriminating tests, in order of cost:

1. **Fully disable the local security product's web/HTTPS scanning** (not a temporary pause, which has
   already proved not to cover every component) and re-run `npm run smoke:staging`.
2. **Run a production build** — `next build` then `next start` — which serves pre-built chunks with no
   on-demand compilation and no HMR socket. If hydration works there, the fault is in the dev pipeline
   rather than in interception.

## What was NOT done, deliberately

⚠ **No assertion was weakened to obtain a green run**, per §5 and §10. The four journeys fail, and they
fail for a real reason that is now named.

⚠ **The production traffic block remains UNVERIFIED.** It has never fired, because no run has yet
produced a Supabase request at all. It is implemented and reviewed, not proven.
