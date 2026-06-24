-- Run this in Supabase SQL Editor to fix profile creation

-- 1. Allow users to insert their own profile
do $$ begin
  create policy "Users insert own profile"
    on profiles for insert with check (auth.uid() = id);
exception when duplicate_object then null; end $$;

-- 2. More robust trigger that captures full_name and role from metadata
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1), 'New User'),
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'nurse')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email     = excluded.email,
    role      = excluded.role;
  return new;
exception when others then
  return new;
end;
$$ language plpgsql security definer;

-- 3. Fix existing accounts that have 'New User' as name
-- (skip if you don't want to touch existing data)
-- update profiles set full_name = split_part(email, '@', 1) where full_name = 'New User';
