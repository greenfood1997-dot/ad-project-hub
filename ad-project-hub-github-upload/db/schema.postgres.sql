create table if not exists users (
  id text primary key,
  name text not null,
  email text,
  role text not null,
  department text,
  status text not null default 'active',
  pin text not null default '123456',
  created_at timestamptz not null default now()
);

alter table users add column if not exists email text;
alter table users add column if not exists status text not null default 'active';
alter table users add column if not exists pin text not null default '123456';
alter table users add column if not exists feishu_open_id text;
alter table users add column if not exists feishu_user_id text;
alter table users add column if not exists feishu_name text;
create unique index if not exists users_email_unique on users (lower(email)) where email is not null;

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
  alerts jsonb not null default '[]'::jsonb,
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
alter table projects add column if not exists alerts jsonb not null default '[]'::jsonb;
alter table projects add column if not exists extracted_fields jsonb not null default '{}'::jsonb;

create table if not exists project_files (
  id bigserial primary key,
  project_id text references projects(id) on delete cascade,
  project_name text,
  name text not null,
  size bigint not null default 0,
  mime_type text,
  storage_url text,
  data_url text,
  category text,
  uploaded_by text references users(id),
  uploaded_at timestamptz not null default now()
);

alter table project_files add column if not exists data_url text;
alter table project_files add column if not exists category text;

create table if not exists client_profiles (
  client text primary key,
  likes jsonb not null default '[]'::jsonb,
  dislikes jsonb not null default '[]'::jsonb,
  pitfalls jsonb not null default '[]'::jsonb,
  handoff_note text,
  contact_style text,
  updated_at timestamptz not null default now()
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

create table if not exists supplier_profiles (
  supplier text primary key,
  market text,
  contact text,
  note text,
  ratings jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  project_name text,
  client text,
  amount numeric not null default 0,
  payer text,
  method text,
  note text,
  received_at timestamptz not null default now(),
  recorded_by text references users(id),
  recorded_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists collection_scripts (
  id text primary key,
  project_id text references projects(id) on delete cascade,
  project_name text,
  client text,
  sales_id text references users(id),
  sales_name text,
  style text,
  tone text,
  amount numeric not null default 0,
  payment_due text,
  script text,
  reason text,
  outcome text,
  success boolean,
  score numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feishu_project_bindings (
  chat_id text primary key,
  chat_name text,
  project_id text references projects(id) on delete cascade,
  project_name text,
  bound_by text references users(id),
  bound_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feishu_events (
  id text primary key,
  event_id text,
  chat_id text,
  chat_name text,
  sender_id text,
  sender_name text,
  message_type text,
  text text,
  file_name text,
  file_key text,
  project_id text references projects(id) on delete set null,
  project_name text,
  action text,
  status text,
  reply text,
  created_at timestamptz not null default now()
);

create table if not exists feishu_pending_files (
  id text primary key,
  event_id text,
  chat_id text,
  chat_name text,
  sender_id text,
  sender_name text,
  project_id text references projects(id) on delete set null,
  project_name text,
  upload_type text,
  file jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  status text not null default '待确认',
  note text,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by text references users(id)
);

create table if not exists system_notifications (
  id text primary key,
  notice_key text unique,
  type text,
  title text,
  body text,
  severity text,
  role text,
  recipients jsonb not null default '[]'::jsonb,
  project_id text references projects(id) on delete set null,
  project_name text,
  source text,
  source_id text,
  action_label text,
  action_view text,
  status text not null default '待处理',
  note text,
  feishu_delivery jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by text references users(id),
  handled_by_name text
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

create table if not exists approvals (
  id text primary key,
  type text not null,
  type_label text,
  project_id text references projects(id) on delete cascade,
  project_name text,
  amount numeric not null default 0,
  reason text,
  payee text,
  category text,
  status text not null,
  current_role text,
  applicant_id text references users(id),
  applicant_name text,
  applicant_role text,
  steps jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb,
  applied_at timestamptz,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

insert into users (id, name, email, role, department, status, pin)
values
  ('u-shareholder', '公司股东', 'owner@company.local', 'shareholder', '管理层', 'active', '123456'),
  ('u-admin', '中台管理员', 'admin@company.local', 'admin', '中台', 'active', '123456'),
  ('u-director', '项目总监', 'director@company.local', 'director', '项目部', 'active', '123456'),
  ('u-pm', '项目经理', 'pm@company.local', 'pm', '项目部', 'active', '123456'),
  ('u-sales', '销售成员', 'sales@company.local', 'sales', '销售部', 'active', '123456'),
  ('u-finance', '财务成员', 'finance@company.local', 'finance', '财务部', 'active', '123456'),
  ('u-member', '普通员工', 'member@company.local', 'member', '执行部', 'active', '123456')
on conflict (id) do nothing;
