-- =====================================================================
--  스마트보안학과 길잡이 · Supabase 데이터베이스 설정
--  사용법: Supabase 대시보드 > SQL Editor > New query 에 이 파일 전체를
--          붙여 넣고 Run 을 누르세요. 여러 번 실행해도 안전해요.
--  학교 메일 도메인을 바꾸려면 아래 is_member() 의 '@gachon.ac.kr' 만 고치세요.
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. 관리자(학생회) 목록 · 기본 함수
-- ---------------------------------------------------------------
create table if not exists public.admins (
  email    text primary key,
  added_at timestamptz not null default now()
);

create or replace function public.my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- 학교 메일로 로그인한 사람인지
create or replace function public.is_member() returns boolean
language sql stable as $$
  select auth.uid() is not null and public.my_email() like '%@gachon.ac.kr'
$$;

-- 학생회(관리자)인지
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.admins a where lower(a.email) = public.my_email())
$$;

-- 종류 이름 → 테이블 이름
create or replace function public.content_table(p_type text) returns text
language sql immutable as $$
  select case p_type when 'post' then 'posts' when 'story' then 'stories'
                     when 'question' then 'questions' when 'comment' then 'comments' end
$$;

-- ---------------------------------------------------------------
-- 2. 테이블
--    author_id(작성자)는 저장하지만 다른 사람은 읽을 수 없어요(아래 권한 설정).
-- ---------------------------------------------------------------
create table if not exists public.courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  year       int  not null check (year between 0 and 4),
  descr      text not null default '' check (char_length(descr) <= 60),
  created_at timestamptz not null default now(),
  author_id  uuid default auth.uid()
);
create unique index if not exists courses_name_uq on public.courses (lower(replace(name, ' ', '')));

create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  course_id  text not null check (char_length(course_id) between 1 and 64),
  kind       text not null check (kind in ('review', 'note')),
  title      text not null check (char_length(title) between 1 and 80),
  body       text not null default '' check (char_length(body) <= 4000),
  semester   text not null default '' check (char_length(semester) <= 30),
  rating     int  check (rating between 1 and 5),
  link       text not null default '' check (char_length(link) <= 500 and (link = '' or link ~* '^https?://')),
  file_path  text check (file_path is null or file_path ~ '^[0-9a-f-]{36}\.[a-z0-9]{1,5}$'),
  file_size  bigint,
  file_type  text,
  like_count int  not null default 0,
  created_at timestamptz not null default now(),
  author_id  uuid default auth.uid()
);
create index if not exists posts_course_idx on public.posts (course_id);

create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('job', 'grad', 'intern', 'etc')),
  field      text not null default '' check (char_length(field) <= 20),
  place      text not null default '' check (char_length(place) <= 40),
  title      text not null check (char_length(title) between 1 and 80),
  body       text not null check (char_length(body) between 1 and 6000),
  like_count int  not null default 0,
  created_at timestamptz not null default now(),
  author_id  uuid default auth.uid()
);

create table if not exists public.questions (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('진로', '수강·과목', '대회·활동', '자격증', '학교생활', '기타')),
  title      text not null check (char_length(title) between 1 and 80),
  body       text not null default '' check (char_length(body) <= 2000),
  like_count int  not null default 0,
  created_at timestamptz not null default now(),
  author_id  uuid default auth.uid()
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'story', 'question')),
  target_id   uuid not null,
  parent_id   uuid references public.comments (id) on delete cascade,
  body        text not null check (char_length(body) <= 1000),
  anon_no     int  not null default 0,      -- 익명1, 익명2 … (글마다 따로)
  by_author   boolean not null default false, -- 글쓴이가 단 댓글
  deleted     boolean not null default false, -- '삭제된 댓글입니다'
  like_count  int  not null default 0,
  created_at  timestamptz not null default now(),
  author_id   uuid default auth.uid()
);
create index if not exists comments_target_idx on public.comments (target_type, target_id);

create table if not exists public.likes (
  target_type text not null check (target_type in ('post', 'story', 'question', 'comment')),
  target_id   uuid not null,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, user_id)
);

create table if not exists public.reports (
  target_type text not null check (target_type in ('post', 'story', 'question', 'comment')),
  target_id   uuid not null,
  reason      text not null check (reason in ('욕설·비방', '개인정보 노출', '저작권 침해', '광고·도배', '기타')),
  reporter_id uuid not null,
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, reporter_id)
);

create table if not exists public.books (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 80),
  author     text not null default '' check (char_length(author) <= 60),
  course_id  text not null default '' check (char_length(course_id) <= 64),
  qty        int  not null check (qty between 1 and 999),
  remaining  int  not null check (remaining >= 0 and remaining <= qty),
  cond       text not null default '깨끗함' check (cond in ('깨끗함', '필기 조금', '필기 많음')),
  note       text not null default '' check (char_length(note) <= 100),
  created_at timestamptz not null default now()
);

create table if not exists public.book_requests (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid not null references public.books (id) on delete cascade,
  user_id    uuid not null,
  name       text not null check (char_length(name) between 1 and 20),
  student_id text not null check (char_length(student_id) between 1 and 12),
  contact    text not null check (char_length(contact) between 1 and 40),
  memo       text not null default '' check (char_length(memo) <= 100),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'done', 'rejected')),
  reply      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists book_requests_user_idx on public.book_requests (user_id);

create table if not exists public.rule_agreements (
  user_id   uuid primary key,
  version   text not null,
  agreed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 3. 댓글 자동 처리: 익명 번호, 글쓴이 표시, 답글 확인
-- ---------------------------------------------------------------
create or replace function public.tg_comment_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner  uuid;
  v_found  boolean := false;
  v_no     int;
  v_parent record;
begin
  if not public.is_member() then
    raise exception '학교 계정으로 로그인해야 해요';
  end if;
  new.author_id  := auth.uid();
  new.created_at := now();
  new.deleted    := false;
  new.like_count := 0;

  if new.parent_id is not null then
    select c.target_type, c.target_id, c.parent_id into v_parent
      from public.comments c where c.id = new.parent_id;
    if not found or v_parent.parent_id is not null then
      raise exception '답글을 달 수 없는 댓글이에요';
    end if;
    new.target_type := v_parent.target_type;
    new.target_id   := v_parent.target_id;
  end if;

  if new.target_type = 'post' then
    select author_id, true into v_owner, v_found from public.posts where id = new.target_id;
  elsif new.target_type = 'story' then
    select author_id, true into v_owner, v_found from public.stories where id = new.target_id;
  elsif new.target_type = 'question' then
    select author_id, true into v_owner, v_found from public.questions where id = new.target_id;
  end if;
  if not coalesce(v_found, false) then
    raise exception '원래 글을 찾을 수 없어요';
  end if;

  if v_owner = new.author_id then
    new.by_author := true;
    new.anon_no   := 0;
    return new;
  end if;

  new.by_author := false;
  -- 같은 글에 동시에 댓글이 달려도 번호가 겹치지 않게
  perform pg_advisory_xact_lock(hashtextextended(new.target_type || ':' || new.target_id::text, 0));
  select c.anon_no into v_no from public.comments c
   where c.target_type = new.target_type and c.target_id = new.target_id
     and c.author_id = new.author_id and not c.by_author
   limit 1;
  if v_no is null then
    select coalesce(max(c.anon_no), 0) + 1 into v_no from public.comments c
     where c.target_type = new.target_type and c.target_id = new.target_id;
  end if;
  new.anon_no := v_no;
  return new;
end $$;

drop trigger if exists comments_before_insert on public.comments;
create trigger comments_before_insert before insert on public.comments
  for each row execute function public.tg_comment_before_insert();

-- ---------------------------------------------------------------
-- 4. 사이트에서 부르는 기능(RPC)
-- ---------------------------------------------------------------

-- 내 활동: 내가 쓴 글·댓글, 누른 좋아요, 신고, 관리자 여부 (나에게만 보여요)
create or replace function public.my_activity() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'is_member', public.is_member(),
    'is_admin',  public.is_admin(),
    'email',     public.my_email(),
    'posts',     coalesce((select json_agg(id) from public.posts     where author_id = auth.uid()), '[]'::json),
    'stories',   coalesce((select json_agg(id) from public.stories   where author_id = auth.uid()), '[]'::json),
    'questions', coalesce((select json_agg(id) from public.questions where author_id = auth.uid()), '[]'::json),
    'comments',  coalesce((select json_agg(id) from public.comments  where author_id = auth.uid()), '[]'::json),
    'courses',   coalesce((select json_agg(id) from public.courses   where author_id = auth.uid()), '[]'::json),
    'likes',     coalesce((select json_agg(target_type || ':' || target_id) from public.likes   where user_id = auth.uid()), '[]'::json),
    'reports',   coalesce((select json_agg(target_type || ':' || target_id) from public.reports where reporter_id = auth.uid()), '[]'::json),
    'rules_version', (select version from public.rule_agreements where user_id = auth.uid())
  )
$$;

-- 이용 규칙 동의 기록
create or replace function public.agree_rules(p_version text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  insert into public.rule_agreements (user_id, version) values (auth.uid(), left(p_version, 20))
  on conflict (user_id) do update set version = excluded.version, agreed_at = now();
end $$;

-- 좋아요 누르기/취소
create or replace function public.toggle_like(p_type text, p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
  v_liked boolean;
  v_count int;
begin
  if not public.is_member() then raise exception '학교 계정으로 로그인해야 해요'; end if;
  if public.content_table(p_type) is null then raise exception '잘못된 요청이에요'; end if;
  execute format('select author_id from public.%I where id = $1', public.content_table(p_type))
    into v_owner using p_id;
  if v_owner is null then raise exception '글을 찾을 수 없어요'; end if;
  if v_owner = v_uid then raise exception '내 글에는 좋아요를 누를 수 없어요'; end if;

  delete from public.likes where target_type = p_type and target_id = p_id and user_id = v_uid;
  if found then
    v_liked := false;
  else
    insert into public.likes (target_type, target_id, user_id) values (p_type, p_id, v_uid);
    v_liked := true;
  end if;
  execute format(
    'update public.%I set like_count = (select count(*) from public.likes where target_type = $1 and target_id = $2) where id = $2 returning like_count',
    public.content_table(p_type)) into v_count using p_type, p_id;
  return json_build_object('liked', v_liked, 'count', v_count);
end $$;

-- 신고하기
create or replace function public.report_content(p_type text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception '학교 계정으로 로그인해야 해요'; end if;
  if public.content_table(p_type) is null then raise exception '잘못된 요청이에요'; end if;
  insert into public.reports (target_type, target_id, reason, reporter_id)
  values (p_type, p_id, p_reason, auth.uid())
  on conflict do nothing;
end $$;

-- 삭제하기 (내 글 또는 관리자). 과목 자료는 첨부 파일 경로를 돌려줘요.
create or replace function public.delete_content(p_type text, p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean := public.is_admin();
  v_owner   uuid;
  v_file    text;
  v_parent  uuid;
begin
  if v_uid is null then raise exception '로그인이 필요해요'; end if;

  if p_type = 'course' then
    if not v_admin then raise exception '관리자만 과목을 지울 수 있어요'; end if;
    if exists (select 1 from public.posts where course_id = p_id::text) then
      raise exception '자료가 있는 과목은 지울 수 없어요';
    end if;
    delete from public.courses where id = p_id;
    return json_build_object('ok', true);
  end if;

  if public.content_table(p_type) is null then raise exception '잘못된 요청이에요'; end if;
  execute format('select author_id from public.%I where id = $1', public.content_table(p_type))
    into v_owner using p_id;
  if v_owner is null then raise exception '이미 지워졌거나 없는 글이에요'; end if;
  if v_owner <> v_uid and not v_admin then raise exception '내가 쓴 글만 지울 수 있어요'; end if;

  if p_type = 'comment' then
    select parent_id into v_parent from public.comments where id = p_id;
    delete from public.likes   where target_type = 'comment' and target_id = p_id;
    delete from public.reports where target_type = 'comment' and target_id = p_id;
    if exists (select 1 from public.comments where parent_id = p_id) then
      -- 답글이 달린 댓글은 자리만 남겨요
      update public.comments set deleted = true, body = '', like_count = 0 where id = p_id;
    else
      delete from public.comments where id = p_id;
      -- 지워진 원댓글에 남은 답글이 없으면 그 자리도 정리
      if v_parent is not null
         and exists (select 1 from public.comments where id = v_parent and deleted)
         and not exists (select 1 from public.comments where parent_id = v_parent) then
        delete from public.comments where id = v_parent;
      end if;
    end if;
    return json_build_object('ok', true);
  end if;

  -- 글(과목 자료·선배 이야기·질문)과 그 댓글, 좋아요, 신고를 함께 지워요
  delete from public.likes   where target_type = 'comment' and target_id in
    (select id from public.comments where target_type = p_type and target_id = p_id);
  delete from public.reports where target_type = 'comment' and target_id in
    (select id from public.comments where target_type = p_type and target_id = p_id);
  delete from public.comments where target_type = p_type and target_id = p_id;
  delete from public.likes   where target_type = p_type and target_id = p_id;
  delete from public.reports where target_type = p_type and target_id = p_id;
  if p_type = 'post' then
    select file_path into v_file from public.posts where id = p_id;
  end if;
  execute format('delete from public.%I where id = $1', public.content_table(p_type)) using p_id;
  return json_build_object('ok', true, 'file_path', v_file);
end $$;

-- 교재 신청
create or replace function public.request_book(p_book uuid, p_name text, p_sid text, p_contact text, p_memo text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_member() then raise exception '학교 계정으로 로그인해야 해요'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_sid), '') = '' or coalesce(trim(p_contact), '') = '' then
    raise exception '이름, 학번, 연락 방법을 모두 적어 주세요';
  end if;
  if not exists (select 1 from public.books where id = p_book and remaining > 0) then
    raise exception '남은 수량이 없어요';
  end if;
  if exists (select 1 from public.book_requests
              where book_id = p_book and user_id = auth.uid() and status in ('pending', 'approved')) then
    raise exception '이미 신청한 교재예요';
  end if;
  insert into public.book_requests (book_id, user_id, name, student_id, contact, memo)
  values (p_book, auth.uid(), trim(p_name), trim(p_sid), trim(p_contact), coalesce(trim(p_memo), ''))
  returning id into v_id;
  return v_id;
end $$;

-- 내 신청 취소 (승인 전까지만)
create or replace function public.cancel_book_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.book_requests where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception '취소할 수 없는 신청이에요'; end if;
end $$;

-- [관리자] 신청 상태 바꾸기 (승인하면 남은 수량이 1 줄어요)
create or replace function public.admin_set_request_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.book_requests;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  select * into r from public.book_requests where id = p_id for update;
  if not found then raise exception '신청을 찾을 수 없어요'; end if;

  if r.status = 'pending' and p_status = 'approved' then
    update public.books set remaining = remaining - 1 where id = r.book_id and remaining > 0;
    if not found then raise exception '남은 수량이 없어요'; end if;
    update public.book_requests set status = 'approved', reply = '승인됐어요. 수령 일정은 따로 연락드려요.', updated_at = now() where id = p_id;
  elsif r.status = 'pending' and p_status = 'rejected' then
    update public.book_requests set status = 'rejected', reply = '이번에는 전달이 어려워요.', updated_at = now() where id = p_id;
  elsif r.status = 'approved' and p_status = 'done' then
    update public.book_requests set status = 'done', updated_at = now() where id = p_id;
  elsif r.status = 'approved' and p_status = 'pending' then
    update public.books set remaining = least(qty, remaining + 1) where id = r.book_id;
    update public.book_requests set status = 'pending', reply = '', updated_at = now() where id = p_id;
  else
    raise exception '바꿀 수 없는 상태예요';
  end if;
end $$;

-- [관리자] 학기 말: 처리 끝난 신청(수령 완료·반려) 정보 일괄 삭제
create or replace function public.admin_purge_requests() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  delete from public.book_requests where status in ('done', 'rejected');
  get diagnostics n = row_count;
  return n;
end $$;

-- [관리자] 신고 모아 보기
create or replace function public.admin_reports()
returns table (target_type text, target_id uuid, report_count bigint, reasons text, last_at timestamptz, preview text)
language sql stable security definer set search_path = public as $$
  select r.target_type, r.target_id, count(*), string_agg(r.reason, ','), max(r.created_at),
         case r.target_type
           when 'post'     then (select p.title || ' — ' || p.body from public.posts p where p.id = r.target_id)
           when 'story'    then (select s.title || ' — ' || s.body from public.stories s where s.id = r.target_id)
           when 'question' then (select q.title || ' — ' || q.body from public.questions q where q.id = r.target_id)
           when 'comment'  then (select c.body from public.comments c where c.id = r.target_id)
         end
    from public.reports r
   where public.is_admin()
   group by r.target_type, r.target_id
   order by count(*) desc, max(r.created_at) desc
$$;

-- [관리자] 신고 기각(기록 지우기)
create or replace function public.admin_dismiss_reports(p_type text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  delete from public.reports where target_type = p_type and target_id = p_id;
end $$;

-- [관리자] 첨부 파일 사용량
create or replace function public.admin_storage_usage() returns json
language plpgsql stable security definer set search_path = public as $$
declare v json;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  select json_build_object('files', count(*), 'bytes', coalesce(sum((metadata ->> 'size')::bigint), 0))
    into v from storage.objects where bucket_id = 'notes';
  return v;
end $$;

-- ---------------------------------------------------------------
-- 5. 권한: 누구나 읽기 · 학교 계정만 쓰기 · 작성자 정보는 숨김
-- ---------------------------------------------------------------
alter table public.admins          enable row level security;
alter table public.courses         enable row level security;
alter table public.posts           enable row level security;
alter table public.stories         enable row level security;
alter table public.questions       enable row level security;
alter table public.comments        enable row level security;
alter table public.likes           enable row level security;
alter table public.reports         enable row level security;
alter table public.books           enable row level security;
alter table public.book_requests   enable row level security;
alter table public.rule_agreements enable row level security;

revoke all on public.admins, public.courses, public.posts, public.stories, public.questions,
              public.comments, public.likes, public.reports, public.books, public.book_requests,
              public.rule_agreements
  from anon, authenticated;

-- 읽기: 작성자(author_id)를 뺀 칸만
grant select (id, name, year, descr, created_at) on public.courses to anon, authenticated;
grant select (id, course_id, kind, title, body, semester, rating, link, file_path, file_size, file_type, like_count, created_at)
  on public.posts to anon, authenticated;
grant select (id, type, field, place, title, body, like_count, created_at) on public.stories to anon, authenticated;
grant select (id, category, title, body, like_count, created_at) on public.questions to anon, authenticated;
grant select (id, target_type, target_id, parent_id, body, anon_no, by_author, deleted, like_count, created_at)
  on public.comments to anon, authenticated;
grant select on public.books to anon, authenticated;
grant select on public.book_requests to authenticated;

-- 쓰기: 학교 계정만, 정해진 칸만 (작성자는 자동 기록)
grant insert (name, year, descr) on public.courses to authenticated;
grant insert (course_id, kind, title, body, semester, rating, link, file_path, file_size, file_type)
  on public.posts to authenticated;
grant insert (type, field, place, title, body) on public.stories to authenticated;
grant insert (category, title, body) on public.questions to authenticated;
grant insert (target_type, target_id, parent_id, body) on public.comments to authenticated;
grant insert, update, delete on public.books to authenticated;  -- 아래 규칙으로 관리자만

drop policy if exists "누구나 읽기" on public.courses;
drop policy if exists "누구나 읽기" on public.posts;
drop policy if exists "누구나 읽기" on public.stories;
drop policy if exists "누구나 읽기" on public.questions;
drop policy if exists "누구나 읽기" on public.comments;
drop policy if exists "누구나 읽기" on public.books;
create policy "누구나 읽기" on public.courses   for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.posts     for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.stories   for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.questions for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.comments  for select to anon, authenticated using (true);
create policy "누구나 읽기" on public.books     for select to anon, authenticated using (true);

drop policy if exists "학교 계정만 쓰기" on public.courses;
drop policy if exists "학교 계정만 쓰기" on public.posts;
drop policy if exists "학교 계정만 쓰기" on public.stories;
drop policy if exists "학교 계정만 쓰기" on public.questions;
drop policy if exists "학교 계정만 쓰기" on public.comments;
create policy "학교 계정만 쓰기" on public.courses   for insert to authenticated with check (public.is_member());
create policy "학교 계정만 쓰기" on public.posts     for insert to authenticated with check (public.is_member());
create policy "학교 계정만 쓰기" on public.stories   for insert to authenticated with check (public.is_member());
create policy "학교 계정만 쓰기" on public.questions for insert to authenticated with check (public.is_member());
create policy "학교 계정만 쓰기" on public.comments  for insert to authenticated with check (public.is_member());

drop policy if exists "관리자만 교재 관리" on public.books;
create policy "관리자만 교재 관리" on public.books for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "본인과 관리자만 신청 보기" on public.book_requests;
create policy "본인과 관리자만 신청 보기" on public.book_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 사이트에서 부를 수 있는 기능은 로그인한 사람만
revoke execute on function
  public.my_activity(), public.agree_rules(text), public.toggle_like(text, uuid),
  public.report_content(text, uuid, text), public.delete_content(text, uuid),
  public.request_book(uuid, text, text, text, text), public.cancel_book_request(uuid),
  public.admin_set_request_status(uuid, text), public.admin_purge_requests(),
  public.admin_reports(), public.admin_dismiss_reports(text, uuid), public.admin_storage_usage(),
  public.tg_comment_before_insert()
  from public, anon;
grant execute on function
  public.my_activity(), public.agree_rules(text), public.toggle_like(text, uuid),
  public.report_content(text, uuid, text), public.delete_content(text, uuid),
  public.request_book(uuid, text, text, text, text), public.cancel_book_request(uuid),
  public.admin_set_request_status(uuid, text), public.admin_purge_requests(),
  public.admin_reports(), public.admin_dismiss_reports(text, uuid), public.admin_storage_usage()
  to authenticated;

-- ---------------------------------------------------------------
-- 6. 첨부 파일 저장소 (파일당 5MB, PDF·이미지·텍스트만)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notes', 'notes', true, 5242880,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
              'text/plain', 'text/markdown', 'text/csv'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "notes 학교 계정 업로드" on storage.objects;
drop policy if exists "notes 본인·관리자 보기" on storage.objects;
drop policy if exists "notes 본인·관리자 삭제" on storage.objects;
create policy "notes 학교 계정 업로드" on storage.objects for insert to authenticated
  with check (bucket_id = 'notes' and public.is_member());
create policy "notes 본인·관리자 보기" on storage.objects for select to authenticated
  using (bucket_id = 'notes' and (owner_id = (select auth.uid())::text or public.is_admin()));
create policy "notes 본인·관리자 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'notes' and (owner_id = (select auth.uid())::text or public.is_admin()));

-- =====================================================================
--  끝! 이제 아래 한 줄로 관리자(학생회) 메일을 등록하세요 (안내서 5단계).
--  insert into public.admins (email) values ('내학교메일@gachon.ac.kr');
-- =====================================================================

-- ---------------------------------------------------------------
-- 7. (추가) 교재 신청 정보 자동 삭제
--    매년 6월 30일, 12월 31일 밤 11시(한국 시간)에 수령 완료·반려된
--    신청의 이름·학번·연락처를 지워요. 진행 중인 신청은 그대로 둬요.
--    (시간은 UTC 기준이라 14시 = 한국 23시)
-- ---------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule('purge-book-requests-1', '0 14 30 6 *',
  $$ delete from public.book_requests where status in ('done', 'rejected') $$);
select cron.schedule('purge-book-requests-2', '0 14 31 12 *',
  $$ delete from public.book_requests where status in ('done', 'rejected') $$);
