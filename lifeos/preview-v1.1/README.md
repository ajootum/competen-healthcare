# LifeOS V1.1 Preview

The owner's prototype, hosted for review. It has no backend, database or API, so it shares no data or services with Competen production.

- **Hosting:** its own Vercel project, `lifeos-preview`, deployed from this folder only. Owner GO 6 Nov 2026. That GO covers this preview only.
- **Access:** one shared reviewer password, held only in the server-side variable `LIFEOS_PREVIEW_PASSWORD`. No password configured means nobody gets in.
- **Data:** the prototype's own sample data, kept in each browser's storage. Nothing syncs between devices.
- **Staging** stays separate: the API work runs on the staging project. Nothing here reaches it yet.

`public/index.html` is `Competen_LifeOS_V1_1_Prototype.html` with two additions: a permanent Preview Mode banner and a noindex tag. The sample text is unchanged, by owner decision.

**Later integration:** at step 5 this page's `localStorage` calls are replaced by calls to `/api/lifeos/v1`. See [LIFEOS-API-001](../../docs/LIFEOS-API-001-v1.2-architecture.md).
