import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Profile image upload → public "avatars" bucket → profiles.avatar_url.
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "An image file is required" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be under 2 MB" }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "Only PNG, JPEG or WebP images are accepted" }, { status: 400 });

  const admin = createAdminClient();
  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await admin.storage.from("avatars")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);

  // Remove the previous avatar file (best-effort) before pointing at the new one.
  const { data: me } = await admin.from("profiles").select("avatar_url").eq("id", user.id).single();
  const old = me?.avatar_url?.split("/avatars/")[1];
  if (old) await admin.storage.from("avatars").remove([old]).catch(() => {});

  const { error } = await admin.from("profiles").update({ avatar_url: pub.publicUrl }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, avatar_url: pub.publicUrl });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("avatar_url").eq("id", user.id).single();
  const old = me?.avatar_url?.split("/avatars/")[1];
  if (old) await admin.storage.from("avatars").remove([old]).catch(() => {});
  await admin.from("profiles").update({ avatar_url: null }).eq("id", user.id);
  return NextResponse.json({ ok: true });
}
