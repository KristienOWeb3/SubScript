create table if not exists public.otp_codes (
    email text primary key,
    code text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists otp_codes_expires_at_idx
    on public.otp_codes (expires_at);

alter table public.otp_codes enable row level security;

drop policy if exists "Deny all public access on otp_codes" on public.otp_codes;
create policy "Deny all public access on otp_codes"
    on public.otp_codes
    for all
    using (false)
    with check (false);
