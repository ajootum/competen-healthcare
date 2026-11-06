// LifeOS V1.1 Preview: the access gate for authorised reviewers. A shared password held only as a server-side
// Vercel environment variable, LIFEOS_PREVIEW_PASSWORD, so no secret reaches client code.
// Fails closed: with no password configured, nobody gets in.

const COOKIE = "lifeos_preview";

async function tokenFor(password) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lifeos-preview-v1:${password}`));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const htmlHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Frame-Options": "DENY",
};

const page = (message, status) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Competen LifeOS Preview</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#183044;background:#f3f7f8}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}
main{background:#fff;border:1px solid #dfe8eb;border-radius:17px;padding:24px;width:min(400px,100%);box-sizing:border-box}h1{font-size:22px;margin:4px 0 8px}p{color:#526672;font-size:14px;margin:0 0 16px}
.eyebrow{color:#167f7b;font-size:11px;letter-spacing:1.5px;font-weight:800;text-transform:uppercase}label{display:block;font-size:14px;margin-bottom:6px}
input{font:inherit;width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbdade;border-radius:9px;margin-bottom:12px}button{font:inherit;width:100%;padding:12px;border-radius:10px;border:0;background:#116c72;color:#fff;cursor:pointer}
.err{color:#a33a22;font-weight:600}</style></head><body><main><div class="eyebrow">Preview Mode</div><h1>Competen LifeOS</h1><p>${message}</p>
<form method="post" action="/__preview-login"><label for="p">Reviewer password</label><input id="p" name="password" type="password" autocomplete="current-password" required autofocus><button>Open preview</button></form>
</main></body></html>`, { status, headers: htmlHeaders });

export default async function middleware(request) {
  const password = process.env.LIFEOS_PREVIEW_PASSWORD;
  if (!password) {
    return new Response("This preview is not available yet.", { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
  }
  const url = new URL(request.url);
  const expected = await tokenFor(password);

  if (url.pathname === "/__preview-login" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const given = String(form?.get("password") ?? "");
    if (!sameText(await tokenFor(given), expected)) {
      return page('<span class="err">That password was not right.</span>', 401);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Cache-Control": "no-store",
        "Set-Cookie": `${COOKIE}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      },
    });
  }

  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
  if (!sameText(cookie, expected)) {
    return page("Authorised reviewers only. This preview holds demonstration data.", 401);
  }
  // Continue to the static page.
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

export const config = { matcher: "/(.*)" };
