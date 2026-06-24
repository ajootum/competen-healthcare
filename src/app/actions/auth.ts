"use server";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signUp(_prevState: unknown, formData: FormData) {
  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.signUp({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      options: {
        data: {
          full_name: formData.get("full_name") as string,
          role: formData.get("role") as string,
        },
      },
    });

    if (error) return { error: error.message };
    return { success: true };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function signIn(_prevState: unknown, formData: FormData) {
  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    });

    if (error) return { error: error.message };
    return { success: true };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
