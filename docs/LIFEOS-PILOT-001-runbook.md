# LIFEOS-PILOT-001 — running one external organisation pilot

For when you choose a real organisation. Choosing it, and everything marked **Owner**, stays your decision. Run the commercial readiness assessment first if the organisation will pay ([ADR-018](adr/ADR-018-lifeos-sealed-product.md)).

## Before the pilot

| # | Step | Who |
|---|---|---|
| 1 | Merge the LifeOS PRs in order | Owner GO |
| 2 | Apply 901, 902, 903 and 904 to production, in that order | Owner, in the SQL editor |
| 3 | Agree pilot terms and data-processing terms with the organisation | Owner, legal |
| 4 | Publish the LifeOS terms, if Individuals will opt in. `insert into lifeos_terms (version, title, url) values (...)` | Owner |
| 5 | Turn on the gate. `insert into lifeos_flag (flag, enabled, note) values ('lifeos_core', true, 'pilot')` | Owner |

Steps 4 and 5 are production writes. To stop everything at any time, set `lifeos_core` to `enabled = false`. Every LifeOS page and API then answers 404, and no record is touched.

## Set up the organisation

1. **Create the organisation's accountable owner and the organisation.** The owner needs a signed-in account. Generate the SQL, read it, then run it in the SQL editor:

```bash
npx.cmd tsx scripts/lifeos-emit-provision.ts --subject <auth-user-id> --name "Their name" --slug acme --org "Acme Group" > provision.sql
```

2. **The organisation's owner signs in at `/lifeos`, opens Organisation, and sets their name and colour.**
3. **Custom domain, if wanted:**
   1. They add the hostname on the Organisation screen and publish the TXT record it shows.
   2. They press Check now. It must say Verified.
   3. Owner adds the hostname to the main Vercel project, and the organisation adds the CNAME Vercel gives.
   4. Owner sets `LIFEOS_TENANT_HOSTS=1` on that project and deploys. This needs a main-app deploy GO. **Before setting it, confirm every first-party host of the main app is under `competenhealthcare.com` or `vercel.app`, or list it in `src/lib/lifeos/host.ts`.**
   5. Owner adds the domain to Supabase Auth's allowed redirect URLs, so sign-up confirmation emails can return there.
4. **Invite people:** on the Organisation screen, one address at a time. The link is shown once and lasts 14 days. The organisation sends it itself. LifeOS sends no email.

## What to tell the organisation

- Administrators cannot read what a member keeps private. A member shares a record by choosing to.
- A person's personal workspace stays theirs if they leave.
- Someone whose only access came through the organisation loses access when they leave or the organisation is suspended. Their records are kept and return if they regain access.
- Sign-in has no password reset on the organisation's own domain yet.

## Measures for the pilot

Decide these with the organisation before it starts. LifeOS does not collect any of them yet, and nothing here measures them for you:

- Do people return weekly?
- How many weekly plans and reviews get finalised?
- Do delegations get closed?
- What do people say about privacy, in their own words?

## Ending it

1. Set the organisation's status to `suspended`. Its domain and access through it stop at once.
2. People with their own access keep working in their personal workspaces.
3. Hard deletion is not available through LifeOS. A deletion request needs a decided, recorded process, which the commercial readiness assessment covers.
