create table if not exists users (
  id text primary key,
  name text not null,
  role text not null,
  department text,
  created_at timestamptz not null default now()
);

create table if not exists settings (
  type text primary key,
  values jsonb not null,
  saved_by text references users(id),
  saved_at timestamptz not null default now()
);

create table if not exists projects (
  id text primary key,
  name text not null,
  client text,
  owner text,
  contract numeric not null default 0,
  cost_budget numeric not null default 0,
  cost_used numeric not null default 0,
  paid numeric not null default 0,
  receivable numeric not null default 0,
  status text not null default '草稿',
  risk text not null default '低',
  ai_summary text,
  next_milestone text,
  payment_due text,
  margin numeric not null default 0,
  tasks jsonb not null default '[]'::jsonb,
  costs jsonb not null default '[]'::jsonb,
  extracted_fields jsonb not null default '{}'::jsonb,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

alter table projects add column if not exists cost_budget numeric not null default 0;
alter table projects add column if not exists cost_used numeric not null default 0;
alter table projects add column if not exists paid numeric not null default 0;
alter table projects add column if not exists receivable numeric not null default 0;
alter table projects add column if not exists ai_summary text;
alter table projects add column if not exists next_milestone text;
alter table projects add column if not exists payment_due text;
alter table projects add column if not exists margin numeric not null default 0;
alter table projects add column if not exists tasks jsonb not null default '[]'::jsonb;
alter table projects add column if not exists costs jsonb not null default '[]'::jsonb;
alter table projects add column if not exists extracted_fields jsonb not null default '{}'::jsonb;

create table if not exists project_files (
  id bigserial primary key,
  project_id text references projects(id) on delete cascade,
  project_name text,
  name text not null,
  size bigint not null default 0,
  mime_type text,
  storage_url text,
  uploaded_by text references users(id),
  uploaded_at timestamptz not null default now()
);

create table if not exists parse_jobs (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  project_name text not null,
  status text not null,
  progress integer not null default 0,
  steps jsonb not null,
  files jsonb not null default '[]'::jsonb,
  source_values jsonb not null default '{}'::jsonb,
  extracted_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table parse_jobs add column if not exists source_values jsonb not null default '{}'::jsonb;
alter table parse_jobs add column if not exists extracted_fields jsonb not null default '{}'::jsonb;

create table if not exists suppliers (
  id bigserial primary key,
  supplier text not null,
  project_id text references projects(id) on delete set null,
  project text,
  type text,
  amount numeric not null default 0,
  status text not null default '待结算',
  created_at timestamptz not null default now()
);

create table if not exists alert_updates (
  id bigserial primary key,
  action text not null,
  project text,
  type text,
  mentions text,
  note text,
  user_name text,
  created_at timestamptz not null default now()
);

create table if not exists comments (
  id bigserial primary key,
  project text,
  body text,
  mentions text,
  user_name text,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id bigserial primary key,
  type text not null,
  target text,
  action text,
  user_name text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into users (id, name, role, department)
values
  ('u-admin', '中台管理员', 'admin', '中台'),
  ('u-pm', '项目经理', 'pm', '项目部'),
  ('u-sales', '销售成员', 'sales', '销售部'),
  ('u-finance', '财务成员', 'finance', '财务部')
on conflict (id) do nothing;
