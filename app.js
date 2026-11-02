"use strict";
/* =============================================================
   스마트보안학과 길잡이 · 사이트 동작 (Supabase 버전)
   - 읽기: 로그인 없이 누구나
   - 쓰기·좋아요·신고·교재 신청: 학교 메일(구글) 로그인
   - 진로 지도·연구실·과목 목록 같은 고정 내용은 이 파일 안의 데이터를 고치면 돼요.
   ============================================================= */
const CFG = window.HUB_CONFIG || {};
const CONFIGURED = !!(CFG.SUPABASE_URL && !/YOUR-/.test(CFG.SUPABASE_URL) &&
                      CFG.SUPABASE_ANON_KEY && !/YOUR-/.test(CFG.SUPABASE_ANON_KEY));
const sb = CONFIGURED && window.supabase
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
const DOMAIN = (CFG.SCHOOL_DOMAIN || "gachon.ac.kr").toLowerCase();
const RULES_VER = CFG.RULES_VERSION || "1";
const BUCKET = "notes";
const MAX_FILE = 5 * 1024 * 1024;
const STORAGE_LIMIT = 1024 * 1024 * 1024; // Supabase 무료 요금제 파일 저장 1GB

/* ---------- 공통 도구 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ts = t => new Date(t).getTime() || 0;
const z2 = n => String(n).padStart(2, "0");
const fullDate = t => { const d = new Date(t); return isNaN(d) ? "" : `${d.getFullYear()}.${z2(d.getMonth() + 1)}.${z2(d.getDate())}`; };
const reqTime = t => { const d = new Date(t); return isNaN(d) ? "" : `${fullDate(t)} ${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())}`; };
const fsize = b => b > 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(b / 1024)) + "KB";
const safeUrl = u => /^https?:\/\//i.test(u || "") ? u : "";
const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
let toastTimer = null;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
function errMsg(e) {
  const m = String(e?.message || e || "");
  if (/[가-힣]/.test(m)) return m;
  if (e?.code === "23505") return "이미 있는 항목이에요.";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) return "학교 계정으로 로그인해야 쓸 수 있어요.";
  if (/jwt|token/i.test(m)) return "로그인이 만료됐어요. 다시 로그인해 주세요.";
  if (/failed to fetch|network/i.test(m)) return "인터넷 연결을 확인해 주세요.";
  return "잠시 후 다시 시도해 주세요.";
}
function setHint(el, msg, isErr) { el.className = isErr ? "err" : "hint"; el.textContent = msg; }
/* 지우기 같은 버튼은 두 번 눌러야 실행돼요 */
function confirmTwice(btn, label = "한 번 더 누르면 삭제") {
  if (btn.dataset.confirm === "1") return true;
  btn.dataset.confirm = "1"; btn.textContent = label; return false;
}

/* ---------- 상태 ---------- */
const S = {
  session: null,
  me: { member: false, admin: false },
  mine: { post: new Set(), story: new Set(), question: new Set(), comment: new Set(), course: new Set() },
  liked: new Set(), reported: new Set(), rulesServer: null,
  courses: [], posts: [], stories: [], questions: [], comments: [], books: [], requests: [],
  reports: [], usage: null, loaded: false, lastLoad: 0,
};
const listOf = type => ({ post: S.posts, story: S.stories, question: S.questions, comment: S.comments }[type] || []);

/* ---------- 알림 띠 ---------- */
function showBanner(kind, html) { $("#banner").innerHTML = `<div class="banner ${kind}">${html}</div>`; }
function clearBanner() { $("#banner").innerHTML = ""; }

/* ---------- 탭 ---------- */
const TABS = [
  { id: "home", label: "홈", n: "00" },
  { id: "career", label: "진로 지도", n: "01" },
  { id: "seniors", label: "선배 이야기", n: "02" },
  { id: "opps", label: "연구실·활동", n: "03" },
  { id: "courses", label: "과목 가이드", n: "04" },
  { id: "qna", label: "QnA", n: "05" },
];
const tabrow = $("#tabrow");
tabrow.innerHTML = TABS.map(t => `<button class="tab" role="tab" id="tab-${t.id}" aria-controls="p-${t.id}" data-id="${t.id}"><span class="mono">${t.n}</span>${t.label}</button>`).join("");
function show(id) {
  if (!TABS.some(t => t.id === id)) id = "home";
  TABS.forEach(t => {
    const on = t.id === id;
    $("#p-" + t.id).hidden = !on;
    const b = $("#tab-" + t.id); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}
tabrow.addEventListener("click", e => { const b = e.target.closest(".tab"); if (b) location.hash = b.dataset.id; });
tabrow.addEventListener("keydown", e => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const i = Math.max(0, TABS.findIndex(t => "#" + t.id === location.hash));
  const n = (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
  location.hash = TABS[n].id; $("#tab-" + TABS[n].id).focus();
});
addEventListener("hashchange", () => show(location.hash.slice(1)));
show(location.hash.slice(1));

/* =============================================================
   로그인 (구글 · 학교 메일만)
   ============================================================= */
function renderAuth() {
  const box = $("#authbox");
  if (!sb) { box.innerHTML = ""; return; }
  if (S.session) {
    const email = S.session.user?.email || "";
    box.innerHTML = `${S.me.admin ? `<span class="adminchip">관리자</span>` : ""}<span class="who" title="${esc(email)}">${esc(email)}</span><button type="button" class="btn ghost rulesbtn" data-logout>로그아웃</button>`;
  } else {
    box.innerHTML = `<button type="button" class="btn rulesbtn loginbtn" data-login>학교 계정으로 로그인</button>`;
  }
}
async function login() {
  if (!sb) { toast("아직 사이트 설정이 끝나지 않았어요."); return; }
  try { sessionStorage.setItem("after-login-tab", location.hash.slice(1) || "home"); } catch (e) {}
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname, queryParams: { hd: DOMAIN, prompt: "select_account" } },
  });
  if (error) toast("로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-login]")) { e.preventDefault(); login(); }
  if (e.target.closest("[data-logout]")) { e.preventDefault(); sb?.auth.signOut(); }
});
/* 글쓰기 전에 확인: 로그인 → 학교 메일 → 규칙 동의 */
function needMember(hintEl) {
  const say = (html) => { if (hintEl) { hintEl.className = "hint"; hintEl.innerHTML = html; } else toast(html.replace(/<[^>]+>/g, "")); };
  if (!sb) { say("아직 사이트 설정이 끝나지 않았어요."); return false; }
  if (!S.session) { say(`학교 계정으로 로그인하면 쓸 수 있어요. <button type="button" class="linkbtn" data-login>로그인</button>`); return false; }
  if (!S.me.member) { say(`학교 메일(@${DOMAIN}) 계정만 쓸 수 있어요.`); return false; }
  if (!rulesAgreed()) { openRules("agree"); return false; }
  return true;
}

/* =============================================================
   데이터 불러오기
   ============================================================= */
const COLS = {
  courses: "id,name,year,descr,created_at",
  posts: "id,course_id,kind,title,body,semester,rating,link,file_path,file_size,file_type,like_count,created_at",
  stories: "id,type,field,place,title,body,like_count,created_at",
  questions: "id,category,title,body,like_count,created_at",
  comments: "id,target_type,target_id,parent_id,body,anon_no,by_author,deleted,like_count,created_at",
  books: "id,title,author,course_id,qty,remaining,cond,note,created_at",
};
async function reload(...tables) {
  if (!sb) return;
  const res = await Promise.all(tables.map(t => sb.from(t).select(COLS[t]).order("created_at", { ascending: false }).limit(1000)));
  const bad = res.find(r => r.error);
  if (bad) {
    showBanner("err", `<span>글을 불러오지 못했어요. 잠시 후 새로고침해 주세요.</span><span class="hint">운영자: Supabase 프로젝트가 일시 정지됐는지 확인해 주세요(안내서 '운영하기').</span>`);
    return false;
  }
  tables.forEach((t, i) => { S[t] = res[i].data || []; });
  if (tables.length > 2) { S.loaded = true; S.lastLoad = Date.now(); }
  return true;
}
async function loadMine() {
  S.me = { member: false, admin: false };
  Object.values(S.mine).forEach(s => s.clear());
  S.liked.clear(); S.reported.clear(); S.rulesServer = null;
  S.requests = []; S.reports = []; S.usage = null;
  if (!sb || !S.session) return;
  const { data, error } = await sb.rpc("my_activity");
  if (error || !data) return;
  S.me = { member: !!data.is_member, admin: !!data.is_admin };
  ["post", "story", "question", "comment", "course"].forEach(k => (data[k === "story" ? "stories" : k + "s"] || []).forEach(id => S.mine[k].add(id)));
  (data.likes || []).forEach(k => S.liked.add(k));
  (data.reports || []).forEach(k => S.reported.add(k));
  S.rulesServer = data.rules_version || null;
  const jobs = [];
  if (S.me.member) jobs.push(sb.from("book_requests").select("id,book_id,user_id,name,student_id,contact,memo,status,reply,created_at,updated_at").order("created_at").then(r => { S.requests = r.data || []; }));
  if (S.me.admin) {
    jobs.push(sb.rpc("admin_reports").then(r => { S.reports = r.data || []; }));
    jobs.push(sb.rpc("admin_storage_usage").then(r => { S.usage = r.error ? null : r.data; }));
  }
  await Promise.all(jobs);
  syncRulesWithServer();
}
async function refresh() {
  await Promise.all([reload(...Object.keys(COLS)), loadMine()]);
  renderAll();
}
function renderAll() {
  renderAuth(); renderFields(); renderSeniors(); renderCourses(); fillCourseSelect();
  if (curCourse) renderCourseDetail();
  renderBooks(); renderQ(); renderHome();
}

/* =============================================================
   이용 규칙 동의 (처음 한 번 · 로그인하면 계정에도 기록)
   ============================================================= */
let localAgreed = false, rulesMode = "agree", lastFocus = null;
try { localAgreed = localStorage.getItem("rules-agreed") === RULES_VER; } catch (e) {}
const rulesAgreed = () => localAgreed || S.rulesServer === RULES_VER;
function rememberAgree() { localAgreed = true; try { localStorage.setItem("rules-agreed", RULES_VER); } catch (e) {} }
async function syncRulesWithServer() {
  if (!S.session || !S.me.member) return;
  if (S.rulesServer === RULES_VER) {
    if (!localAgreed) { rememberAgree(); if (!$("#rulesModal").hidden && rulesMode === "agree") closeRules(); }
    return;
  }
  if (localAgreed) { const { error } = await sb.rpc("agree_rules", { p_version: RULES_VER }); if (!error) S.rulesServer = RULES_VER; }
}
function openRules(mode) {
  rulesMode = mode; lastFocus = document.activeElement;
  $("#rulesAgree").hidden = mode !== "agree"; $("#rulesClose").hidden = mode === "agree";
  $("#rulesLead").hidden = mode !== "agree";
  $("#rulesModal").hidden = false; document.body.classList.add("locked");
  (mode === "agree" ? $("#rulesAgree") : $("#rulesClose")).focus();
}
function closeRules() { $("#rulesModal").hidden = true; document.body.classList.remove("locked"); lastFocus?.focus?.(); }
$("#rulesAgree").addEventListener("click", async () => {
  rememberAgree(); closeRules();
  if (sb && S.session && S.me.member) { const { error } = await sb.rpc("agree_rules", { p_version: RULES_VER }); if (!error) S.rulesServer = RULES_VER; }
});
$("#rulesClose").addEventListener("click", closeRules);
$("#rulesModal").addEventListener("click", e => { if (e.target.id === "rulesModal" && rulesMode !== "agree") closeRules(); });
document.addEventListener("keydown", e => {
  if ($("#rulesModal").hidden) return;
  if (e.key === "Escape" && rulesMode !== "agree") closeRules();
  if (e.key === "Tab") {
    const f = [...$("#rulesModal").querySelectorAll("button:not([hidden])")];
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
});
document.addEventListener("click", e => { if (e.target.closest("[data-rules]")) { e.preventDefault(); openRules("read"); } });

/* =============================================================
   좋아요 · 신고 · 삭제 (모든 글과 댓글 공통)
   ============================================================= */
function likeBtn(type, id, count, small) {
  const own = S.mine[type]?.has(id), on = S.liked.has(type + ":" + id);
  return `<button type="button" class="likebtn ${small ? "sm" : ""} ${own ? "own" : ""}" data-like="${type}:${id}" aria-pressed="${on}" ${own ? `disabled title="내 글에는 좋아요를 누를 수 없어요"` : ""} aria-label="좋아요 ${count}개">${on ? "♥" : "♡"} ${small ? "" : "좋아요 "}<b>${count || 0}</b></button>`;
}
const REPORT_REASONS = ["욕설·비방", "개인정보 노출", "저작권 침해", "광고·도배", "기타"];
function reportBtn(type, id) {
  if (S.mine[type]?.has(id)) return "";
  return S.reported.has(type + ":" + id) ? `<span class="hint">신고함</span>` : `<button type="button" class="linkbtn rep" data-report="${type}:${id}">신고</button>`;
}
async function deleteContent(type, id) {
  const { data, error } = await sb.rpc("delete_content", { p_type: type, p_id: id });
  if (error) throw error;
  if (data?.file_path) { try { await sb.storage.from(BUCKET).remove([data.file_path]); } catch (e) {} }
}
document.addEventListener("click", async e => {
  /* 좋아요 */
  const lb = e.target.closest("[data-like]");
  if (lb) {
    if (lb.dataset.busy || !needMember()) return;
    const [type, id] = lb.dataset.like.split(":");
    lb.dataset.busy = "1";
    const { data, error } = await sb.rpc("toggle_like", { p_type: type, p_id: id });
    delete lb.dataset.busy;
    if (error) { toast(errMsg(error)); return; }
    const key = type + ":" + id; data.liked ? S.liked.add(key) : S.liked.delete(key);
    const it = listOf(type).find(x => x.id === id); if (it) it.like_count = data.count;
    renderContentViews();
    return;
  }
  /* 신고 */
  const rb = e.target.closest("[data-report]");
  if (rb) {
    if (!needMember()) return;
    const old = document.querySelector(".repmenu"); if (old) { old.remove(); if (old.dataset.key === rb.dataset.report) return; }
    const m = document.createElement("div"); m.className = "repmenu"; m.dataset.key = rb.dataset.report;
    m.innerHTML = `<span class="hint">신고 사유</span>${REPORT_REASONS.map(r => `<button type="button" class="fbtn" data-rr="${r}">${r}</button>`).join("")}<button type="button" class="linkbtn" data-rr-cancel>취소</button>`;
    rb.closest(".meta").after(m); return;
  }
  if (e.target.closest("[data-rr-cancel]")) { e.target.closest(".repmenu")?.remove(); return; }
  const rr = e.target.closest("[data-rr]");
  if (rr) {
    const menu = rr.closest(".repmenu"), [type, id] = menu.dataset.key.split(":");
    menu.querySelectorAll("button").forEach(b => b.disabled = true);
    const { error } = await sb.rpc("report_content", { p_type: type, p_id: id, p_reason: rr.dataset.rr });
    if (error) { menu.innerHTML = `<span class="err">${esc(errMsg(error))}</span>`; return; }
    S.reported.add(type + ":" + id); menu.remove(); toast("신고했어요. 운영자가 확인할게요."); renderContentViews();
    return;
  }
  /* 삭제 */
  const db = e.target.closest("[data-delete]");
  if (db) {
    if (!confirmTwice(db)) return;
    const [type, id] = db.dataset.delete.split(":");
    db.disabled = true;
    try { await deleteContent(type, id); toast("지웠어요."); await refresh(); }
    catch (err) { db.disabled = false; db.textContent = "삭제 실패"; toast(errMsg(err)); }
  }
});
function renderContentViews() { renderSeniors(); renderQ(); if (curCourse) renderPosts(); renderHome(); }

/* =============================================================
   댓글 · 답글 (에브리타임식 익명: 익명1, 익명2, 익명(글쓴이))
   번호는 서버가 글마다 매겨요. 다른 글의 번호와는 연결되지 않아요.
   ============================================================= */
let openCm = new Set(), openReply = null;
function keepInputs(box, fn) {
  const v = {}; box.querySelectorAll('input[id^="cm-"],input[id^="rp-"]').forEach(i => v[i.id] = i.value);
  const f = document.activeElement?.id; fn();
  for (const k in v) { const el = document.getElementById(k); if (el) el.value = v[k]; }
  if (f && v[f] !== undefined) document.getElementById(f)?.focus();
}
const cmLabel = c => c.by_author ? "익명(글쓴이)" : "익명" + c.anon_no;
function cmItem(c, isReply) {
  const mine = S.mine.comment.has(c.id);
  return `<div class="cm ${isReply ? "reply" : ""}">
    <div class="cmhead">${c.deleted ? `<span class="hint">삭제됨</span>` : `<b class="${c.by_author ? "authname" : ""}">${cmLabel(c)}</b>${mine ? ` <span class="hint">(내 댓글)</span>` : ""}`}</div>
    <p class="body">${c.deleted ? `<span class="hint">삭제된 댓글입니다.</span>` : esc(c.body)}</p>
    ${c.deleted ? "" : `<div class="meta">${likeBtn("comment", c.id, c.like_count, true)}<span class="mono">${fullDate(c.created_at)}</span>
      ${!isReply ? `<button type="button" class="linkbtn" data-reply="${c.id}">${openReply === c.id ? "답글 취소" : "답글"}</button>` : ""}
      ${reportBtn("comment", c.id)}
      ${S.me.admin || mine ? `<button type="button" class="linkbtn del" data-delete="comment:${c.id}">삭제</button>` : ""}</div>`}
  </div>`;
}
function cmBlock(type, id, word = "댓글") {
  const key = type + ":" + id;
  const all = S.comments.filter(c => c.target_type === type && c.target_id === id).sort((a, b) => ts(a.created_at) - ts(b.created_at));
  let top = all.filter(c => !c.parent_id);
  const count = all.filter(c => !c.deleted).length;
  const open = openCm.has(key);
  /* QnA 베스트 답변: 글쓴이가 아닌 사람의 원댓글 중 좋아요가 가장 많은 것(1개 이상, 같으면 먼저 쓴 것) */
  let best = null;
  if (type === "question") {
    top.filter(c => !c.deleted && !c.by_author && c.like_count > 0).forEach(c => { if (!best || c.like_count > best.like_count) best = c; });
    if (best) top = [best, ...top.filter(c => c !== best)];
  }
  const loginNote = `<p class="hint">학교 계정으로 로그인하면 ${word}을 남길 수 있어요. <button type="button" class="linkbtn" data-login>로그인</button></p>`;
  const canPost = !!(S.session && S.me.member);
  return `<div class="cmwrap">
    ${best && !open ? `<div class="bestprev"><span class="bestbadge">베스트 답변</span><p class="body">${esc(best.body)}</p><span class="hint">${cmLabel(best)} · ♥ ${best.like_count}</span></div>` : ""}
    <button type="button" class="linkbtn cmtoggle" data-cm-toggle="${key}">${word} ${count}개 ${open ? "접기" : "보기"}</button>
    ${open ? `<div class="cmlist">
      ${top.length ? top.map(c => {
        const reps = all.filter(r => r.parent_id === c.id);
        return `<div class="cmthread ${c === best ? "best" : ""}">${c === best ? `<span class="bestbadge">베스트 답변</span>` : ""}
          ${cmItem(c, false)}
          ${reps.length ? `<div class="replies">${reps.map(r => cmItem(r, true)).join("")}</div>` : ""}
          ${openReply === c.id ? (canPost ? `<form class="cmform replyform" data-cm-form="${key}" data-parent="${c.id}"><input type="text" id="rp-${c.id}" maxlength="1000" placeholder="답글 남기기 (익명)" aria-label="답글 입력"><button class="btn" type="submit">등록</button></form>` : loginNote) : ""}
        </div>`; }).join("") : `<p class="hint">아직 ${word}이 없어요.</p>`}
      ${canPost ? `<form class="cmform" data-cm-form="${key}"><input type="text" id="cm-${type}-${id}" maxlength="1000" placeholder="${word} 남기기 (익명)" aria-label="${word} 입력"><button class="btn" type="submit">등록</button></form><p class="cmrule">익명 ${word}이에요. 욕설·비방과 개인정보는 쓰지 말아 주세요. <button type="button" class="linkbtn" data-rules>이용 규칙</button></p>` : loginNote}
    </div>` : ""}
  </div>`;
}
document.addEventListener("click", e => {
  const tg = e.target.closest("[data-cm-toggle]");
  if (tg) {
    const k = tg.dataset.cmToggle; openCm.has(k) ? openCm.delete(k) : openCm.add(k); renderContentViews();
    if (openCm.has(k)) document.getElementById("cm-" + k.replace(":", "-"))?.focus();
    return;
  }
  const rp = e.target.closest("[data-reply]");
  if (rp) { openReply = openReply === rp.dataset.reply ? null : rp.dataset.reply; renderContentViews(); if (openReply) document.getElementById("rp-" + openReply)?.focus(); }
});
document.addEventListener("submit", async e => {
  const f = e.target.closest("[data-cm-form]"); if (!f) return;
  e.preventDefault();
  if (!needMember()) return;
  const [type, id] = f.dataset.cmForm.split(":"), parent = f.dataset.parent || null;
  const inp = f.querySelector("input"), body = inp.value.trim();
  if (!body || f.dataset.busy) return;
  f.dataset.busy = "1"; const btn = f.querySelector("button"); btn.disabled = true;
  const { error } = await sb.from("comments").insert({ target_type: type, target_id: id, parent_id: parent, body });
  delete f.dataset.busy; btn.disabled = false;
  if (error) { toast(errMsg(error)); return; }
  inp.value = ""; if (parent) openReply = null;
  await Promise.all([reload("comments"), loadMine()]); renderContentViews();
});

/* =============================================================
   1. 진로 지도 (고정 내용: 아래 데이터를 고치면 바로 바뀌어요)
   ============================================================= */
const SECTORS=[
  {id:"firm",name:"보안 전문기업",desc:"모의해킹·컨설팅, 보안관제, 보안 솔루션 개발을 전문으로 하는 회사예요. 여러 고객사를 경험하며 실력을 빠르게 쌓을 수 있어 첫 직장으로 많이 선택해요."},
  {id:"fin",name:"금융권",desc:"은행·증권·보험·카드사, 금융보안 전문기관이 있어요. 전자금융 관련 규정을 지켜야 해서 관리체계와 내부 통제 업무 비중이 크고, 이상거래 탐지(FDS) 같은 금융 특화 업무도 있어요."},
  {id:"tech",name:"IT · 빅테크 · 핀테크",desc:"자체 서비스를 운영하는 회사의 보안팀이에요. 클라우드, 앱 보안, 개발 조직과의 협업 비중이 크고 보안 개발 역량을 중요하게 봐요."},
  {id:"public",name:"공공기관",desc:"정보보호 정책, 침해사고 대응, 인증 제도 등을 맡는 정부 산하 기관과 공기업 보안 부서예요. 공채로 들어가는 경우가 많아요."},
  {id:"gov",name:"수사 · 국방 · 정보기관",desc:"경찰 사이버수사, 군 사이버 부대, 국가 정보기관처럼 국가 안보와 범죄 수사를 다뤄요. 별도 채용 시험이나 특별 채용으로 들어가요."},
  {id:"ot",name:"제조 · 에너지 · 모빌리티",desc:"발전소, 공장, 자동차, 선박처럼 실제 설비를 제어하는 시스템(OT·ICS)을 지켜요. 우리 학과 CPS·자동차 보안 연구와 연결되는 분야예요."},
  {id:"lab",name:"연구소 · 학계",desc:"정부 출연연구소, 기업 연구소, 대학에서 새로운 보안 기술을 연구해요. 보통 석사 이상 학위가 필요해요."},
];
const FIELDS=[
  {id:"pentest",name:"모의해킹 · 취약점 진단",en:"Penetration Testing / Red Team",
   lead:"공격자의 시선으로 웹, 앱, 시스템, 네트워크를 점검해 취약점을 찾고 보고서로 정리합니다. 실제 공격처럼 침투하는 레드팀, 기업이 거는 상금을 받고 취약점을 찾는 버그바운티도 이 직무에 속해요.",
   work:["웹·모바일 앱 모의해킹과 진단 보고서 작성","서버·네트워크 장비 취약점 점검","레드팀 훈련(실제 공격 시나리오 수행)","개발팀과 조치 방안 검토, 재점검"],
   skill:["웹 구조와 HTTP 이해","리눅스·윈도우 운영체제","Python 등 스크립트 작성","취약점 분석과 문서화 능력"],
   cert:["정보보안기사","OSCP","리눅스마스터"],
   course:["웹프로그래밍","파이썬","운영체제","데이터통신","시스템보안"],
   where:["firm","fin","tech","public"]},
  {id:"soc",name:"보안관제 · 침해대응",en:"SOC / Incident Response",
   lead:"보안 장비와 로그를 실시간으로 지켜보다가 공격이 탐지되면 분석하고 대응합니다. 사고가 터졌을 때 원인을 찾고 복구를 이끄는 침해대응(CERT)까지 포함해요.",
   work:["방화벽·IDS/IPS·SIEM 이벤트 모니터링","탐지 룰 작성과 튜닝","침해사고 원인 분석과 대응, 재발 방지"],
   skill:["TCP/IP와 패킷 분석","로그 분석, SIEM 사용 경험","공격 기법(TTP) 이해","교대 근무에 맞는 꼼꼼함"],
   cert:["정보보안기사","네트워크관리사","CCNA"],
   course:["데이터통신","사이버테러대응기술","악성코드","운영체제"],
   where:["firm","fin","public","tech"]},
  {id:"malware",name:"악성코드 분석 · 위협 인텔리전스",en:"Malware Analysis / Threat Intelligence",
   lead:"악성코드를 역분석(리버싱)해 어떻게 동작하는지 밝히고, 공격 그룹의 수법과 동향을 추적해 보고서로 정리합니다. 백신·보안 회사와 대형 보안팀에 주로 있어요.",
   work:["악성코드 정적·동적 분석과 탐지 패턴 작성","공격 그룹 추적과 위협 인텔리전스 보고서 작성","침해사고 대응팀에 분석 결과 제공"],
   skill:["어셈블리와 리버싱 도구","윈도우 내부 구조","C·Python","영어 보고서 읽기"],
   cert:["정보보안기사","GREM"],
   course:["악성코드","컴퓨터구조","운영체제","시스템보안","C언어"],
   where:["firm","public","gov","tech"]},
  {id:"forensic",name:"디지털 포렌식",en:"Digital Forensics",
   lead:"PC, 모바일, 서버에 남은 흔적을 수집·분석해 사건의 사실관계를 밝힙니다. 수사기관, 포렌식 전문업체, 기업 감사·법무 조직에서 일해요.",
   work:["저장매체 이미징과 증거 무결성 확보","파일시스템·아티팩트 분석","분석 결과 보고서와 법적 절차 지원"],
   skill:["파일시스템과 운영체제 내부 구조","포렌식 도구 활용","증거 처리 절차 이해","논리적 글쓰기"],
   cert:["디지털포렌식전문가 2급","EnCE"],
   course:["운영체제","시스템보안","디지털 포렌식","데이터베이스"],
   where:["gov","firm","fin"]},
  {id:"consult",name:"보안 컨설팅 · 관리체계",en:"Security Consulting / GRC",
   lead:"기업의 보안 정책과 관리체계를 진단하고 인증 취득을 돕습니다. 위험 평가, 내부 감사처럼 기술보다 제도와 절차를 다루는 비중이 커요.",
   work:["ISMS-P 등 인증 준비 컨설팅","보안 정책·지침 수립과 위험 평가","보안 감사와 법규 준수 점검"],
   skill:["관련 법규와 인증 기준 이해","문서 작성","고객과의 커뮤니케이션"],
   cert:["정보보안기사","ISMS-P 인증심사원","CISA","CISSP(경력 필요)"],
   course:["정보보호개론","정보보호 관리체계","정보보호 법규"],
   where:["firm","fin","public"]},
  {id:"privacy",name:"개인정보보호",en:"Privacy",
   lead:"회사가 고객의 개인정보를 법에 맞게 수집·보관·파기하는지 관리합니다. 개인정보 영향평가, 유출 사고 대응, 서비스 기획 단계의 개인정보 검토를 맡아요.",
   work:["개인정보 처리 현황 점검과 법규 준수 관리","개인정보 영향평가","신규 서비스의 개인정보 검토","유출 사고 시 신고와 대응"],
   skill:["개인정보보호법 이해","데이터 흐름 파악","가명처리 등 프라이버시 기술"],
   cert:["CPPG","ISMS-P 인증심사원"],
   course:["정보보호 법규","데이터베이스","정보보호 관리체계"],
   where:["tech","fin","public","firm"]},
  {id:"infosec",name:"기업 정보보호 담당 · 보안 운영",en:"Corporate Security Operations",
   lead:"한 회사의 보안팀에서 방화벽·접근통제·백신 같은 보안 솔루션을 운영하고, 임직원 보안 교육과 내부 정책을 챙깁니다. 경력을 쌓으면 회사 보안을 총괄하는 정보보호최고책임자(CISO)로 이어질 수 있어요.",
   work:["보안 솔루션 도입과 운영","계정·권한 관리, 접근통제","임직원 보안 교육과 모의 훈련","보안 점검과 사고 대응 협업"],
   skill:["네트워크·서버 운영 기초","보안 솔루션 이해","여러 부서와의 조율 능력"],
   cert:["정보보안기사","정보처리기사","네트워크관리사"],
   course:["데이터통신","운영체제","정보보호 관리체계"],
   where:["fin","tech","ot","public"]},
  {id:"cloud",name:"클라우드 · 인프라 보안",en:"Cloud & Infrastructure Security",
   lead:"AWS 같은 클라우드와 서버·네트워크 인프라를 안전하게 설계하고, 잘못된 설정이나 과도한 권한을 찾아 고칩니다. 보안 점검을 자동화하는 일도 많아요.",
   work:["클라우드 계정·권한 설계와 보안 설정 점검","인프라 보안 아키텍처 설계","보안 점검 자동화(DevSecOps)"],
   skill:["리눅스와 네트워크","클라우드 서비스 구조","컨테이너·쿠버네티스","스크립트·자동화"],
   cert:["AWS Certified Security","리눅스마스터","정보보안기사"],
   course:["운영체제","데이터통신","클라우드 보안"],
   where:["tech","fin","firm"]},
  {id:"dev",name:"보안 개발 · 애플리케이션 보안",en:"Security Engineering / AppSec",
   lead:"보안 제품이나 사내 보안 도구를 직접 만들고, 개발 과정에서 코드의 보안 문제를 찾아 고칩니다. 개발 실력과 보안 지식을 함께 쓰는 직무예요.",
   work:["보안 솔루션·도구 개발","시큐어 코딩 가이드와 코드 리뷰","인증·암호 기능 설계와 구현"],
   skill:["C·Python·Java 등 개발 역량","자료구조와 알고리즘","웹·앱 구조 이해","암호 기초"],
   cert:["정보처리기사","정보보안기사"],
   course:["자료구조","알고리즘","운영체제","현대암호학","시큐어 코딩"],
   where:["firm","tech","fin"]},
  {id:"ot",name:"제어시스템(OT) · 임베디드 보안",en:"OT / ICS / Embedded Security",
   lead:"발전소·공장·자동차·선박처럼 실제 설비를 움직이는 제어시스템과 임베디드 기기의 보안을 맡습니다. 일반 IT 보안과 다른 장비와 통신 방식을 다뤄요.",
   work:["제어시스템 네트워크 보안 설계와 점검","산업용 장비·차량 취약점 분석","설비 환경에 맞는 탐지·대응 체계 구축"],
   skill:["네트워크와 산업용 통신 프로토콜","임베디드·하드웨어 기초","현장 설비에 대한 이해"],
   cert:["정보보안기사","GICSP"],
   course:["컴퓨터구조","데이터통신","시스템보안"],
   where:["ot","public","firm","lab"]},
  {id:"research",name:"보안 연구원 · 대학원",en:"Research / Graduate School",
   lead:"암호, 시스템 보안, AI 보안 등 한 주제를 깊게 파고들어 새로운 기술을 만들고 논문을 씁니다. 석·박사 후 연구소, 기업 연구조직, 교수 등으로 진출해요.",
   work:["연구 주제 설정과 실험","논문 작성과 학회 발표","정부·기업 연구과제 수행"],
   skill:["수학(이산수학·선형대수·확률)","영어 논문 읽기와 쓰기","끈기 있는 문제 해결"],
   cert:["자격증보다 연구 경험과 논문이 중요"],
   course:["이산수학","현대암호학","선형대수","학부연구생 활동"],
   where:["lab","public","tech"]},
];
const FIELD_EXTRA={
  pentest:{labs:["acims","ssa","cps"],progs:["pay1oad","bob","whitehat","dreamhack","ctftime","codegate"],
    path:["진단 담당(주니어)","모의해킹 컨설턴트","레드팀 · 프로젝트 리드","보안 연구 · 컨설팅 총괄"],moves:["malware","dev","consult"]},
  soc:{labs:["silab","cps"],progs:["pay1oad","bob","whitehat","codegateconf","poc"],
    path:["관제 요원","보안 분석가 · 탐지 룰 담당","침해대응(CERT) 담당","관제센터 · 대응팀 리드"],moves:["malware","forensic","infosec"]},
  malware:{labs:["silab","ssa"],progs:["pay1oad","bob","dreamhack","ctftime","codegate"],
    path:["악성코드 분석가","위협 인텔리전스 분석가","선임 분석가 · 연구원","위협 연구 조직 리드"],moves:["soc","forensic","research"]},
  forensic:{labs:[],progs:["pay1oad","bob","whitehat"],
    path:["포렌식 분석관","사건 분석 책임자","포렌식 조직 리드 · 전문 감정인"],moves:["soc","malware"]},
  consult:{labs:["isc"],progs:["codegateconf","poc"],
    path:["주니어 컨설턴트","프로젝트 매니저 · 인증심사원","컨설팅 총괄","CISO · 보안 임원"],moves:["privacy","infosec"]},
  privacy:{labs:["isp","splab"],progs:["codegateconf"],
    path:["개인정보보호 담당","개인정보 영향평가 · 컨설팅","개인정보보호책임자(CPO)"],moves:["consult","infosec"]},
  infosec:{labs:["isc"],progs:["pay1oad","codegateconf","poc"],
    path:["보안 운영 담당","보안팀 파트장","보안팀장","CISO"],moves:["cloud","consult","soc"]},
  cloud:{labs:["isc"],progs:["pay1oad","bob"],
    path:["인프라 · 클라우드 엔지니어","클라우드 보안 엔지니어","보안 아키텍트","보안 엔지니어링 리드"],moves:["dev","infosec"]},
  dev:{labs:["ssa","isp","isc"],progs:["pay1oad","bob","dreamhack"],
    path:["보안 개발자","시니어 보안 엔지니어","보안 아키텍트","보안 제품 개발 리드"],moves:["cloud","pentest","research"]},
  ot:{labs:["cps","splab","acims"],progs:["bob","codegateconf","poc"],
    path:["제어시스템 보안 담당","OT 보안 엔지니어 · 컨설턴트","OT 보안 아키텍트","기반시설 보안 책임자"],moves:["soc","research"]},
  research:{labs:["cps","isc","acims","silab","splab","ssa","isp"],progs:["codegateconf","poc"],
    path:["학부연구생","석사과정","박사과정 · 연구원","교수 · 책임연구원"],moves:["dev","malware"]},
};
let curField = FIELDS[0].id;
function careerPathHtml(f) {
  const x = FIELD_EXTRA[f.id]; if (!x) return "";
  return `<div class="cpath"><span class="label">커리어 경로</span>
    <ol class="steps-row">${x.path.map((p, i) => `<li><span class="mono">${z2(i + 1)}</span>${esc(p)}</li>`).join("")}</ol>
    <div class="moves"><span class="hint">경력을 쌓은 뒤 이런 직무로도 많이 옮겨요</span><div class="chips">${x.moves.map(m => `<button type="button" class="chip jobchip" data-job="${m}">${esc(FIELDS.find(z => z.id === m)?.name || m)}</button>`).join("")}</div></div>
    <p class="hint">대표적인 예시예요. 회사와 사람마다 경로는 달라요.</p></div>`;
}
function connectHtml(f) {
  const x = FIELD_EXTRA[f.id]; if (!x) return "";
  const byId = id => OPPS.find(o => o.id === id);
  const labs = x.labs.map(byId).filter(Boolean), progs = x.progs.map(byId).filter(Boolean);
  const st = S.stories.filter(s => s.field === f.id).sort((a, b) => ts(b.created_at) - ts(a.created_at));
  const oppBtn = o => `<button type="button" class="linkcard" data-goopp="${o.id}"><b>${esc(o.short || o.t)}</b><span>${esc(o.prof || (o.club ? "학과 동아리" : o.c === "edu" ? "교육 프로그램" : o.c === "ctf" ? "CTF" : "컨퍼런스"))}</span></button>`;
  return `<div class="connect"><h4>우리 학과에서 연결되는 것</h4>
    <div class="cgrid">
      <section><span class="label">관련 연구실</span>${labs.length ? `<div class="linkcards">${labs.map(oppBtn).join("")}</div>` : `<p class="hint">이 분야를 직접 다루는 학과 연구실은 아직 없어요.</p>`}</section>
      <section><span class="label">동아리 · 교육 · 대회</span><div class="linkcards">${progs.map(oppBtn).join("")}</div></section>
      <section class="full"><span class="label">이 분야 선배 이야기</span>
        ${st.length ? `<ul class="stlist">${st.slice(0, 3).map(s => `<li><button type="button" class="linkbtn" data-gostory="${f.id}">${esc(s.title)}</button> <span class="hint mono">${fullDate(s.created_at)}</span></li>`).join("")}</ul>
          <button type="button" class="btn ghost" data-gostory="${f.id}">선배 이야기 ${st.length}개 모두 보기</button>`
          : `<p class="hint">아직 이 분야 선배 이야기가 없어요. 선배 이야기에 글을 쓸 때 '관련 직무'를 고르면 여기에 모여요.</p>`}
      </section>
    </div></div>`;
}
const sectorName = id => SECTORS.find(s => s.id === id)?.name || id;
function renderFields() {
  $("#fieldlist").innerHTML = FIELDS.map((f, i) => `<button class="fieldbtn" role="listitem" data-id="${f.id}" aria-current="${f.id === curField}">${f.name}<span class="mono">${z2(i + 1)}</span></button>`).join("");
  const f = FIELDS.find(x => x.id === curField);
  const li = a => `<ul>${a.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
  $("#fielddoc").innerHTML = `
    <h3>${f.name}</h3><p class="en mono">${f.en}</p>
    <p class="lead">${f.lead}</p>
    <div class="fgrid">
      <section><span class="label">하는 일</span>${li(f.work)}</section>
      <section><span class="label">필요한 역량</span>${li(f.skill)}</section>
      <section><span class="label">관련 자격증</span><div class="chips">${f.cert.map(c => `<span class="chip cert">${esc(c)}</span>`).join("")}</div></section>
      <section><span class="label">관련 과목</span><div class="chips">${f.course.map(c => `<span class="chip">${esc(c)}</span>`).join("")}</div></section>
      <section class="full"><span class="label">주로 일하는 곳</span><div class="chips">${f.where.map(w => `<button type="button" class="chip sectorchip" data-sector="${w}">${esc(sectorName(w))}</button>`).join("")}</div></section>
    </div>
    ${careerPathHtml(f)}
    ${connectHtml(f)}`;
}
function renderSectors(hl) {
  $("#sectors").innerHTML = SECTORS.map(s => {
    const jobs = FIELDS.filter(f => f.where.includes(s.id));
    return `<article class="card sector ${hl === s.id ? "hl" : ""}" id="sector-${s.id}">
      <h4>${esc(s.name)}</h4><p>${esc(s.desc)}</p>
      <div class="chips">${jobs.map(f => `<button type="button" class="chip jobchip" data-job="${f.id}">${esc(f.name)}</button>`).join("")}</div>
    </article>`; }).join("");
}
$("#fielddoc").addEventListener("click", e => {
  const jb = e.target.closest("[data-job]"); if (jb) { curField = jb.dataset.job; renderFields(); $("#fielddoc").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  const go = e.target.closest("[data-goopp]");
  if (go) {
    const o = OPPS.find(x => x.id === go.dataset.goopp); oppCat = o.c; location.hash = "opps"; renderOpps();
    setTimeout(() => { const el = document.getElementById("opp-" + o.id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); } }, 60);
    return;
  }
  const gs = e.target.closest("[data-gostory]");
  if (gs) { seniorField = gs.dataset.gostory; seniorType = "all"; location.hash = "seniors"; syncSeniorFilter(); renderSeniors(); window.scrollTo({ top: 0 }); return; }
  const b = e.target.closest("[data-sector]"); if (!b) return;
  renderSectors(b.dataset.sector); document.getElementById("sector-" + b.dataset.sector)?.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#sectors").addEventListener("click", e => { const b = e.target.closest("[data-job]"); if (!b) return; curField = b.dataset.job; renderFields(); renderSectors(); $("#fielddoc").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("#fieldlist").addEventListener("click", e => { const b = e.target.closest(".fieldbtn"); if (b) { curField = b.dataset.id; renderFields(); } });
renderSectors();

/* =============================================================
   2. 선배 이야기 (익명 게시판)
   ============================================================= */
const STORY_TYPES = { job: "취업", grad: "대학원", intern: "인턴", etc: "대외활동·기타" };
let seniorType = "all", seniorField = "", openStory = new Set();
$("#sField").innerHTML += FIELDS.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
$("#seniorFilter").innerHTML = [["all", "전체"], ...Object.entries(STORY_TYPES)].map(([k, l]) => `<button class="fbtn" data-k="${k}" aria-pressed="${k === seniorType}">${l}</button>`).join("");
function syncSeniorFilter() {
  document.querySelectorAll("#seniorFilter .fbtn").forEach(x => x.setAttribute("aria-pressed", x.dataset.k === seniorType));
  let c = document.getElementById("fieldFilterChip");
  if (seniorField) {
    if (!c) { c = document.createElement("button"); c.type = "button"; c.id = "fieldFilterChip"; c.className = "fbtn fieldfilter"; $("#seniorFilter").appendChild(c); }
    c.setAttribute("aria-pressed", "true"); c.textContent = `직무: ${FIELDS.find(f => f.id === seniorField)?.name || ""} ✕`;
  } else if (c) c.remove();
}
$("#seniorFilter").addEventListener("click", e => {
  const b = e.target.closest(".fbtn"); if (!b) return;
  if (b.id === "fieldFilterChip") seniorField = ""; else seniorType = b.dataset.k;
  syncSeniorFilter(); renderSeniors();
});
const emptyBox = (title, sub) => `<div class="empty"><b>${title}</b>${sub}</div>`;
const notReady = () => !sb ? emptyBox("아직 데이터베이스가 연결되지 않았어요", "config.js 설정을 마치면 글이 보여요.") : !S.loaded ? emptyBox("불러오는 중이에요", "잠시만 기다려 주세요.") : "";
function renderSeniors() { keepInputs($("#seniors"), _renderSeniors); }
function _renderSeniors() {
  const box = $("#seniors");
  const nr = notReady(); if (nr) { box.innerHTML = nr; return; }
  const list = S.stories.filter(x => (seniorType === "all" || x.type === seniorType) && (!seniorField || x.field === seniorField)).sort((a, b) => ts(b.created_at) - ts(a.created_at));
  if (!list.length) { box.innerHTML = emptyBox("아직 올라온 이야기가 없어요", "선배라면 첫 이야기를 남겨 주세요."); return; }
  box.innerHTML = list.map(x => {
    const mine = S.mine.story.has(x.id), long = (x.body || "").length > 280, open = openStory.has(x.id);
    return `<article class="card q story">
      <div class="qhead"><h4>${esc(x.title)}</h4><span class="path ${x.type}">${STORY_TYPES[x.type] || "기타"}</span></div>
      ${x.field || x.place ? `<div class="chips">${x.field ? `<span class="chip">${esc(FIELDS.find(f => f.id === x.field)?.name || "")}</span>` : ""}${x.place ? `<span class="chip cert">${esc(x.place)}</span>` : ""}</div>` : ""}
      <p class="body ${long && !open ? "clamp" : ""}">${esc(x.body || "")}</p>
      ${long ? `<div><button type="button" class="linkbtn" data-more="${x.id}">${open ? "접기" : "더 보기"}</button></div>` : ""}
      <div class="meta">${likeBtn("story", x.id, x.like_count)}<span>익명${mine ? " (내 글)" : ""}</span><span class="mono">${fullDate(x.created_at)}</span>${reportBtn("story", x.id)}${S.me.admin || mine ? `<button class="linkbtn del" data-delete="story:${x.id}">삭제</button>` : ""}</div>
      ${cmBlock("story", x.id)}
    </article>`; }).join("");
}
$("#seniors").addEventListener("click", e => {
  const t = e.target.closest("[data-more]"); if (!t) return;
  openStory.has(t.dataset.more) ? openStory.delete(t.dataset.more) : openStory.add(t.dataset.more); renderSeniors();
});
$("#storyForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hint = $("#sHint");
  if (!needMember(hint)) return;
  const title = $("#sTitle").value.trim(), body = $("#sBody").value.trim();
  if (!title || !body) { setHint(hint, "제목과 내용을 적어 주세요.", true); return; }
  const btn = $("#sSubmit"); btn.disabled = true;
  const { error } = await sb.from("stories").insert({ type: $("#sType").value, field: $("#sField").value, place: $("#sWhere").value.trim(), title, body });
  btn.disabled = false;
  if (error) { setHint(hint, errMsg(error), true); return; }
  ["#sTitle", "#sBody", "#sWhere"].forEach(x => $(x).value = "");
  setHint(hint, "올렸어요. 고마워요!");
  await Promise.all([reload("stories"), loadMine()]); renderSeniors(); renderFields(); renderHome();
});

/* =============================================================
   3. 연구실 · 활동 (고정 내용)
   ============================================================= */
const OPP_CATS=[["all","전체"],["lab","학부연구생·연구실"],["club","학과 동아리"],["edu","교육 프로그램"],["ctf","CTF"],["conf","컨퍼런스"]];
const OPPS=[
  {id:"bob",c:"edu",t:"BoB (Best of the Best)",d:"정부가 지원하는 차세대 보안리더 양성 프로그램. 교육, 현업 멘토링, 프로젝트로 진행돼요. 운영 기관과 모집 방식은 해마다 바뀔 수 있어 공식 공지를 확인하세요.",who:"대학생·일반",link:""},
  {id:"whitehat",c:"edu",t:"화이트햇 스쿨",d:"화이트해커 양성 교육 과정. 입문부터 실전까지 단계별로 배웁니다.",who:"대학생",link:""},
  {id:"dreamhack",c:"ctf",t:"Dreamhack 워게임 · CTF",d:"웹, 리버싱, 포너블 문제를 단계별로 풀 수 있는 국내 플랫폼. 1학년 입문용으로 좋아요.",who:"누구나",link:"https://dreamhack.io"},
  {id:"ctftime",c:"ctf",t:"CTFtime 대회 일정",d:"전 세계 CTF 일정을 모아 보는 사이트. 팀으로 참가할 대회를 고를 때 확인하세요.",who:"누구나",link:"https://ctftime.org"},
  {id:"codegate",c:"ctf",t:"CODEGATE CTF",d:"국내 대표 국제 해킹방어대회. 예선과 본선으로 진행되고, 대학생 부문이 따로 열리기도 해요.",who:"대학생·일반",link:"https://www.codegate.org/"},
  {id:"codegateconf",c:"conf",t:"CODEGATE 컨퍼런스",d:"코드게이트 대회와 함께 열리는 보안 컨퍼런스. 최신 공격·방어 기술 발표를 들을 수 있어요.",who:"누구나",link:"https://www.codegate.org/"},
  {id:"poc",c:"conf",t:"POC (Power of Community)",d:"국내에서 열리는 국제 해킹·보안 컨퍼런스. 해외 연구자들의 기술 발표를 들을 수 있어요.",who:"누구나",link:"https://powerofcommunity.net/"},
  {c:"lab",tip:true,t:"학부연구생 컨택하는 법",d:"관심 있는 연구실 홈페이지와 아래 연구 주제를 먼저 읽고, 교수님께 학번·관심 분야·들은 과목을 적어 메일로 면담을 요청하세요. 연구실마다 모집 시기와 절차가 달라요. 연구실마다 참여 방법이 다르니 궁금한 점은 교수님께 직접 여쭤보세요.",who:"재학생",link:""},
  {id:"cps",c:"lab",t:"CPS 보안연구센터",short:"CPS Security Lab",prof:"서정택 교수님",room:"AI공학관 426호",email:"seojt@gachon.ac.kr",
   bg:"국가보안기술연구소 연구부장 출신 · 산업제어시스템 보안 분야를 오래 연구해 온 교수님",
   d:"발전소, 원자력 시설, 스마트그리드, 스마트선박, 스마트팩토리처럼 실제 설비를 제어하는 산업제어시스템(ICS)과 사이버물리시스템(CPS)의 보안을 연구합니다.",
   tags:["산업제어시스템(ICS)","원자력·발전 보안","스마트선박","제로트러스트","AI 기반 공격 탐지"],
   areas:["원자력·화력·신재생 발전소 대상 AI 기반 사이버공격 탐지","스마트선박·해양 인프라 암호화 트래픽 보안관제","테스트베드 대상 공격 시연과 취약점 분석","발전소 제로트러스트 아키텍처, 국가 망 보안체계(N2SF)"],
   link:"https://cpssecuritylab.web.app/"},
  {id:"isc",c:"lab",t:"Intelligence Security & Cryptography Lab",short:"ISC Lab",prof:"이석준 교수님",room:"AI관 321호",email:"junny@gachon.ac.kr",
   bg:"한국전자통신연구원(ETRI) 책임연구원 출신",
   d:"정책 보안과 양자내성암호 두 축으로 연구합니다. 제로트러스트 가이드라인과 국가 보안 프레임워크 같은 정책 연구, 양자컴퓨터에도 안전한 차세대 암호의 구현과 최적화를 다룹니다.",
   tags:["제로트러스트","N2SF·RMF","양자내성암호(PQC)","암호모듈 검증(K-CMVP)"],
   areas:["금융·발전·공공 분야의 제로트러스트 가이드라인과 도입 방안 연구","N2SF, RMF 등 보안 프레임워크와 AI 보안 정책 문서 연구","격자 기반 양자내성암호 구현과 최적화","암호모듈 구현과 K-CMVP 검증 문서 작성"],
   link:"https://sites.google.com/view/gachon-isc/home"},
  {id:"acims",c:"lab",t:"Autonomous Cybersecurity in Military Systems Lab",short:"ACiMS",prof:"김태규 교수님",room:"427호",email:"tkim@gachon.ac.kr",
   bg:"LIG넥스원 사이버전자전연구소 연구소장 출신",
   d:"국방 무기체계와 유·무인 복합 체계(MUM-T)를 대상으로 공격 표면을 분석하고, 자동화된 모의해킹과 사이버전자전 기술을 연구합니다.",
   tags:["자율 모의해킹","Anti-Tamper","무인체계 보안","사이버전자전"],
   areas:["Autonomous Pentesting: 모의해킹 자동화","Anti-Tamper: 무기체계 역공학·변조 방지","Cybersecurity for Unmanned Systems: 드론 등 무인체계 보안","Cyber Electronic Warfare: 사이버전자전"],
   link:"https://sites.google.com/gachon.ac.kr/tkim"},
  {id:"silab",c:"lab",t:"Security Intelligence Lab",short:"SILab",prof:"이태진 교수님",room:"AI관 418호",email:"kinjecs@gachon.ac.kr",
   bg:"한국인터넷진흥원(KISA) 출신 · 악성코드 분석, 침해대응, AI 보안 연구",
   d:"AI를 보안에 쓰는 연구(AI for Security)와 AI 자체를 지키는 연구(Security for AI)를 함께 합니다. LLM·AI 에이전트의 취약점 진단, 보안관제(SOC) 효율화, 침해공격 분석이 중심이에요.",
   tags:["LLM 탈옥·안전성 평가","AI 에이전트 레드티밍","SOC 알림 선별","TTP·공격 체인 분석"],
   areas:["LLM 탈옥(jailbreak) 공격 자동화와 안전 수준 평가","AI 에이전트 시스템의 공격 표면 관리와 레드티밍","분석가 피드백 기반 보안관제 알림 선별(Human-AI 협업)","로그 기반 공격 흐름 재구성과 TTP 매핑"],
   link:"https://silab.ai.kr/"},
  {id:"splab",c:"lab",t:"Security and Privacy Lab",short:"SPLab",prof:"오현영 교수님",room:"AI공학관 741호",email:"hyoh@gachon.ac.kr",
   bg:"컴퓨터·자동차·공급망 보안, AI/LLM 프라이버시, 하드웨어 아키텍처 연구",
   d:"퍼징, 자동차 보안, 하드웨어 보안을 연구합니다. LLM을 활용한 퍼징과 FPGA로 퍼징 속도를 높이는 연구, CPU 보안 기능을 이용한 AI 프라이버시 보호도 다룹니다.",
   tags:["퍼징 · LLM 퍼징","FPGA 가속","자동차 보안","하드웨어 보안(TrustZone)","부채널 공격 방어"],
   areas:["LLM을 활용한 퍼징, FPGA 기반 퍼징 가속","자동차용 보안 칩으로 부팅·업데이트·내부 통신 보호","ARM TrustZone 등 CPU 보안 기술, 마이크로아키텍처 부채널 공격 방어","AI 모델 파라미터 격리와 학습 데이터 유출 방지, PQC 관련 연구"],
   link:"https://sites.google.com/view/hyoh"},
  {id:"ssa",c:"lab",t:"Software Security Assessment Lab",short:"SSA Lab",prof:"전승호 교수님",room:"AI공학관 749호",email:"shjeon90@gachon.ac.kr",
   bg:"AI 기반 자동 버그 탐지, 소프트웨어 분석 연구 · 연구실에서 실제 취약점 제보 활동도 해요",
   d:"소프트웨어 버그와 취약점을 자동으로 찾는 기술을 연구합니다. 바이너리 역공학, 퍼징, 정적 분석에 AI를 결합하고, AI 모델 자체의 보안도 다룹니다.",
   tags:["바이너리 역공학","퍼징","정적 분석","AI 기반 취약점 분석","Security for AI"],
   areas:["바이너리 역공학 (바이너리 비교, 함수 이름 복원 등)","그레이박스·디렉티드 퍼징, 하이브리드 퍼징","AI 에이전트로 취약점 분석 효율 높이기","안드로이드 앱, macOS·iOS, 리눅스 커널 등 다양한 플랫폼 대상 퍼징과 취약점 분석"],
   link:"https://shjeon90.github.io/"},
  {id:"isp",c:"lab",t:"Information Security & Privacy Lab",short:"ISP Lab",prof:"박기성 교수님",room:"AI관 748호",email:"kisung@gachon.ac.kr",
   bg:"한국전자통신연구원(ETRI) 출신",
   d:"신뢰할 수 있는 AI, 프라이버시, 응용 암호, 블록체인·메타버스 보안을 연구합니다. 에이전틱 AI 시대에 사용자 프라이버시를 지키고 AI 시스템의 취약점을 막는 방법을 다뤄요.",
   tags:["Trustworthy AI","AI·에이전트 보안","프라이버시 보호","응용 암호·PQC","블록체인·Web3"],
   areas:["AI 시스템의 신뢰성 확보, 에이전틱 AI 취약점 방어","프라이버시 보호 기술과 데이터 주권","암호 프로토콜, 양자내성암호 등 응용 암호","블록체인·Web3·메타버스 보안","AI 기반 로그 이상 탐지와 TTP 분석"],
   link:"https://sites.google.com/view/isnplab"},
  {id:"pay1oad",c:"club",club:true,t:"Pay1oad (페이로드)",sub:"가천대학교 정보보호 동아리 · Hacking & Security",
   d:"정보보안에 관심은 있지만 혼자 공부하기 막막했던 학생, 보안 컨퍼런스나 스터디를 해 보고 싶은 학생, CTF와 공모전에 도전해 보고 싶은 학생을 위한 동아리예요.",
   tags:["CTF","보안·개발 스터디","프로젝트","세미나","연합 행사"],
   acts:["보안·개발 프로젝트와 스터디","동아리 내부 공모전과 세미나","보안 컨퍼런스 참여, 외부 CTF 대회와 공모전 참가","다른 대학 보안 동아리와의 연합 행사","MT 등 친목 활동"],
   insta:"pay1oad_gc",link:"https://www.instagram.com/pay1oad_gc/"},
];
let oppCat = "all";
function renderOpps() {
  $("#oppFilter").innerHTML = OPP_CATS.map(([k, l]) => `<button class="fbtn" data-k="${k}" aria-pressed="${oppCat === k}">${l}</button>`).join("");
  const name = k => OPP_CATS.find(c => c[0] === k)[1];
  const order = OPP_CATS.map(c => c[0]);
  const list = OPPS.filter(o => oppCat === "all" || o.c === oppCat).sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c));
  $("#opps").innerHTML = (oppCat === "lab" ? `<p class="hint" style="grid-column:1/-1">연구실 정보는 학과 홈페이지와 Open Lab Day 연구실 소개 자료를 바탕으로 정리했어요. 학부연구생 참여는 교수님께 직접 문의하세요.</p>` : "") + list.map(o => o.club ? `
    <article class="card opp lab" id="opp-${o.id}">
      <span class="cat">club</span>
      <div class="labhead"><h3>${esc(o.t)}</h3></div>
      <p class="bg">${esc(o.sub)}</p>
      <p>${esc(o.d)}</p>
      <div class="chips">${o.tags.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
      <details class="more"><summary>주요 활동 자세히</summary>
        <span class="label">주요 활동</span>
        <ul>${o.acts.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
      </details>
      <div class="meta"><span class="email mono">@${esc(o.insta)}</span><a href="${o.link}" target="_blank" rel="noopener">인스타그램 보기 ↗</a></div>
    </article>` : o.prof ? `
    <article class="card opp lab" id="opp-${o.id}">
      <span class="cat">lab</span>
      <div class="labhead"><h3>${esc(o.t)}</h3></div>
      <p class="prof"><b>${esc(o.prof)}</b> · ${esc(o.room)}</p>
      <p class="bg">${esc(o.bg)}</p>
      <p>${esc(o.d)}</p>
      <div class="chips">${o.tags.map(t => `<span class="chip">${esc(t)}</span>`).join("")}</div>
      <details class="more"><summary>주요 연구 주제 자세히</summary>
        <span class="label">주요 연구 주제</span>
        <ul>${o.areas.map(a => `<li>${esc(a)}</li>`).join("")}</ul>
      </details>
      <div class="meta"><span class="email mono">${esc(o.email)}</span><button type="button" class="linkbtn" data-copy="${esc(o.email)}">메일 주소 복사</button>
        <a href="${o.link}" target="_blank" rel="noopener">연구실 홈페이지 ↗</a></div>
    </article>` : `
    <article class="card opp ${o.tip ? "tip" : ""}" ${o.id ? `id="opp-${o.id}"` : ""}>
      <span class="cat">${o.tip ? "tip" : o.c}</span>
      <h3>${esc(o.t)}</h3>
      <p>${esc(o.d)}</p>
      ${o.tip ? "" : `<div class="meta"><span>${name(o.c)}</span><span>대상: ${o.who}</span>
        ${o.link ? `<a href="${o.link}" target="_blank" rel="noopener">사이트 열기 ↗</a>` : `<span>공식 공지 확인</span>`}</div>`}
    </article>`).join("");
}
$("#opps").addEventListener("click", async e => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "복사했어요"; }
  catch (err) { const s = b.previousElementSibling; const r = document.createRange(); r.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); b.textContent = "선택됨 · 복사해 주세요"; }
  setTimeout(() => { b.textContent = "메일 주소 복사"; }, 2000);
});
$("#oppFilter").addEventListener("click", e => { const b = e.target.closest(".fbtn"); if (b) { oppCat = b.dataset.k; renderOpps(); } });
renderOpps();

/* =============================================================
   4. 과목 가이드 (수강 후기 · 필기·정리본)
   ============================================================= */
const BASE_COURSES=[
  ["c1-0",1,"C언어",""],["c1-1",1,"정보보호개론",""],["c1-2",1,"이산수학",""],["c1-3",1,"인공지능수학",""],["c1-4",1,"컴퓨터구조",""],["c1-5",1,"파이썬",""],
  ["c2-0",2,"자료구조",""],["c2-1",2,"현대암호학",""],["c2-2",2,"시스템보안",""],["c2-3",2,"인공지능개론",""],["c2-4",2,"인공지능프로그래밍",""],["c2-5",2,"웹프로그래밍",""],["c2-6",2,"운영체제",""],["c2-7",2,"악성코드",""],["c2-8",2,"블록체인",""],["c2-9",2,"사이버테러대응기술",""],["c2-10",2,"데이터처리프로그래밍",""],["c2-11",2,"데이터통신",""],
  ["c3-0",3,"네트워크보안","",1],["c3-1",3,"웹보안","",1],["c3-2",3,"디지털포렌식","",1],["c3-3",3,"클라우드보안","",1],
  ["c4-0",4,"정보보호관리체계","",1],["c4-1",4,"시큐어코딩","",1],["c4-2",4,"캡스톤디자인","",1],
].map(([id,y,name,desc,ex])=>({id,y,name,desc,base:true,ex:!!ex}));
const KINDS = { review: "수강 후기", note: "필기 · 정리본" };
let curCourse = null, kindSel = "all", courseQuery = "", postSort = "new";
const userCourses = () => S.courses.map(c => ({ id: c.id, y: c.year, name: c.name, desc: c.descr, base: false }));
const allCourses = () => [...BASE_COURSES, ...userCourses()];
const yearName = y => y == 0 ? "교양·기타" : `${y}학년`;
const courseName = id => allCourses().find(c => c.id === id)?.name || "";
function renderCourses() {
  const q = courseQuery.trim().toLowerCase();
  const list = allCourses().filter(c => !q || c.name.toLowerCase().includes(q));
  const years = [1, 2, 3, 4, 0].filter(y => list.some(c => c.y == y));
  if (!years.length) { $("#courses").innerHTML = emptyBox("찾는 과목이 없어요", "'+ 과목 추가'로 직접 만들어 주세요."); return; }
  $("#courses").innerHTML = years.map(y => `
    <div class="yearsec"><h3><span class="mono" style="color:var(--accent)">${y ? `YEAR ${y}` : "ETC"}</span>${yearName(y)}${y >= 3 ? `<span class="hint">예시 과목이에요 · 실제 교육과정으로 바뀔 예정</span>` : ""}</h3>
    <div class="courses">${list.filter(c => c.y == y).map(c => {
      const cnt = k => S.posts.filter(p => p.course_id === c.id && p.kind === k).length;
      const st = k => { const n = cnt(k); return `<span class="st ${n ? "has" : ""}">${n ? n + "개" : "아직 없음"}</span>`; };
      return `<button type="button" class="card course" data-c="${c.id}">
        <div><h4>${esc(c.name)} ${c.ex ? `<span class="user-badge">예시</span>` : c.base ? "" : `<span class="user-badge">학생 추가</span>`}</h4><p class="sub">${esc(c.desc || "")}</p></div>
        <div class="slots">
          <div class="slot"><span>수강 후기</span>${st("review")}</div>
          <div class="slot"><span>필기 · 정리본</span>${st("note")}</div>
        </div></button>`; }).join("")}</div></div>`).join("");
}
$("#courseSearch").addEventListener("input", e => { courseQuery = e.target.value; renderCourses(); });
$("#courses").addEventListener("click", e => { const b = e.target.closest(".course"); if (b) openCourse(b.dataset.c); });
$("#addCourseToggle").addEventListener("click", () => { $("#addCourseForm").hidden = false; $("#acName").focus(); });
$("#acCancel").addEventListener("click", () => { $("#addCourseForm").hidden = true; });
$("#addCourseForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hint = $("#acHint");
  if (!needMember(hint)) return;
  const name = $("#acName").value.trim();
  if (!name) { setHint(hint, "과목명을 적어 주세요.", true); return; }
  if (allCourses().some(c => c.name.replace(/\s/g, "") === name.replace(/\s/g, ""))) { setHint(hint, "이미 있는 과목이에요. 검색해 보세요.", true); return; }
  $("#acSubmit").disabled = true;
  const { error } = await sb.from("courses").insert({ name, year: Number($("#acYear").value), descr: $("#acDesc").value.trim() });
  $("#acSubmit").disabled = false;
  if (error) { setHint(hint, error.code === "23505" ? "이미 있는 과목이에요." : errMsg(error), true); return; }
  $("#acName").value = ""; $("#acDesc").value = ""; $("#addCourseForm").hidden = true; setHint(hint, "");
  await reload("courses"); renderCourses(); fillCourseSelect();
});
function openCourse(id) {
  curCourse = id; kindSel = "all";
  $("#courseListView").hidden = true; $("#courseDetail").hidden = false;
  renderCourseDetail(); window.scrollTo({ top: 0 });
}
$("#courseBack").addEventListener("click", () => { curCourse = null; $("#courseDetail").hidden = true; $("#courseListView").hidden = false; renderCourses(); });
function renderCourseDetail() {
  const c = allCourses().find(x => x.id === curCourse);
  if (!c) { $("#courseBack").click(); return; }
  $("#cdYear").textContent = c.y ? `YEAR ${c.y}` : "ETC";
  $("#cdName").textContent = c.name;
  $("#cdDesc").textContent = c.desc || "";
  let adm = $("#cdAdmin");
  if (!adm) { adm = document.createElement("div"); adm.id = "cdAdmin"; $("#cdDesc").after(adm); }
  adm.innerHTML = S.me.admin && !c.base ? `<button type="button" class="linkbtn del" data-delete="course:${c.id}">이 과목 삭제 (관리자)</button>` : "";
  const cb = S.books.filter(b => b.course_id === c.id), avail = cb.filter(b => b.remaining > 0).length;
  $("#cdBooks").innerHTML = cb.length ? `<div class="card cdbooks"><p>이 과목 나눔 교재 <b>${cb.length}종</b>${avail ? ` · 지금 신청 가능 ${avail}종` : " · 모두 마감"}</p><button class="btn ghost" type="button" id="goBooks">교재 나눔 보기</button></div>` : "";
  $("#goBooks")?.addEventListener("click", () => { $("#bookSearch").value = c.name; bookQuery = c.name; setGuideView("books"); });
  const here = S.posts.filter(p => p.course_id === c.id);
  $("#kindFilter").innerHTML = [["all", "전체"], ...Object.entries(KINDS)].map(([k, l]) => {
    const n = k === "all" ? here.length : here.filter(p => p.kind === k).length;
    return `<button class="fbtn" data-k="${k}" aria-pressed="${kindSel === k}">${l} ${n}</button>`; }).join("")
    + `<span class="sortsep"></span>` + [["new", "최신순"], ["like", "좋아요순"]].map(([k, l]) => `<button class="fbtn sortbtn" data-sort="${k}" aria-pressed="${postSort === k}">${l}</button>`).join("");
  renderPosts();
}
$("#kindFilter").addEventListener("click", e => { const b = e.target.closest(".fbtn"); if (!b) return; if (b.dataset.sort) postSort = b.dataset.sort; else kindSel = b.dataset.k; renderCourseDetail(); });
const fileUrl = path => sb ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : "#";
const FILE_LABEL = { "application/pdf": "PDF", "text/plain": "텍스트", "text/markdown": "마크다운", "text/csv": "CSV" };
function renderPosts() { keepInputs($("#postList"), _renderPosts); }
function _renderPosts() {
  const box = $("#postList");
  const nr = notReady(); if (nr) { box.innerHTML = nr; return; }
  const list = S.posts.filter(p => p.course_id === curCourse && (kindSel === "all" || p.kind === kindSel))
    .sort((a, b) => postSort === "like" ? (b.like_count - a.like_count) || (ts(b.created_at) - ts(a.created_at)) : ts(b.created_at) - ts(a.created_at));
  if (!list.length) { box.innerHTML = emptyBox("아직 올라온 자료가 없어요", `첫 ${kindSel === "all" ? "자료" : KINDS[kindSel]}를 올려 주세요.`); return; }
  box.innerHTML = list.map(p => {
    const link = safeUrl(p.link), isImg = /^image\//.test(p.file_type || ""), mine = S.mine.post.has(p.id);
    return `<article class="card q">
      <div class="qhead"><h4>${esc(p.title)}</h4><span class="kind ${p.kind}">${KINDS[p.kind] || ""}</span></div>
      <div class="meta">${p.kind === "review" && p.rating ? `<span class="rating">추천도 ${"●".repeat(p.rating)}${"○".repeat(5 - p.rating)} ${p.rating}/5</span>` : ""}${p.semester ? `<span>${esc(p.semester)}</span>` : ""}</div>
      ${p.body ? `<p class="body">${esc(p.body)}</p>` : ""}
      ${p.file_path || link ? `<div class="attach">
        ${p.file_path ? (isImg ? `<a href="${esc(fileUrl(p.file_path))}" target="_blank" rel="noopener" style="padding:0;border:0"><img src="${esc(fileUrl(p.file_path))}" alt="첨부 이미지" loading="lazy"></a>` : `<a href="${esc(fileUrl(p.file_path))}" target="_blank" rel="noopener">📎 첨부 파일 · ${FILE_LABEL[p.file_type] || "파일"} · ${fsize(p.file_size || 0)}</a>`) : ""}
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">🔗 링크 열기</a>` : ""}</div>` : ""}
      <div class="meta postfoot">${likeBtn("post", p.id, p.like_count)}<span>익명${mine ? " (내 글)" : ""}</span><span class="mono">${fullDate(p.created_at)}</span>${reportBtn("post", p.id)}${S.me.admin || mine ? `<button class="linkbtn del" data-delete="post:${p.id}">삭제</button>` : ""}</div>
      ${cmBlock("post", p.id)}
    </article>`; }).join("");
}
$("#pKind").addEventListener("change", () => { $("#pRatingWrap").hidden = $("#pKind").value !== "review"; });
const TYPE_BY_EXT = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", txt: "text/plain", md: "text/markdown", csv: "text/csv" };
$("#postForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hint = $("#pHint");
  if (!needMember(hint)) return;
  const title = $("#pTitle").value.trim(), body = $("#pBody").value.trim(), link = $("#pLink").value.trim();
  const file = $("#pFile").files?.[0];
  if (!title) { setHint(hint, "제목을 적어 주세요.", true); $("#pTitle").focus(); return; }
  if (link && !safeUrl(link)) { setHint(hint, "링크는 https:// 로 시작해야 해요.", true); return; }
  let ext = "", type = "";
  if (file) {
    ext = (file.name.split(".").pop() || "").toLowerCase(); type = TYPE_BY_EXT[ext];
    if (!type) { setHint(hint, "PDF, 이미지, 텍스트 파일만 올릴 수 있어요. 다른 파일은 링크로 올려 주세요.", true); return; }
    if (file.size > MAX_FILE) { setHint(hint, "파일은 5MB까지 올릴 수 있어요. 더 큰 파일은 구글 드라이브 링크로 올려 주세요.", true); return; }
  }
  const btn = $("#pSubmit"); btn.disabled = true;
  let uploaded = null;
  try {
    if (file) {
      btn.textContent = "파일 올리는 중…";
      const path = `${newId()}.${ext === "jpeg" ? "jpg" : ext}`;
      const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: type, upsert: false, cacheControl: "31536000" });
      if (up.error) throw { message: /size/i.test(up.error.message) ? "파일은 5MB까지 올릴 수 있어요." : /mime/i.test(up.error.message) ? "이 형식의 파일은 올릴 수 없어요." : "파일을 올리지 못했어요. 링크로 올리거나 잠시 후 다시 시도해 주세요." };
      uploaded = path;
    }
    const kind = $("#pKind").value;
    const row = { course_id: curCourse, kind, title, body, semester: $("#pSem").value.trim(), link };
    if (kind === "review") row.rating = Number($("#pRating").value);
    if (uploaded) Object.assign(row, { file_path: uploaded, file_size: file.size, file_type: type });
    const { error } = await sb.from("posts").insert(row);
    if (error) { if (uploaded) await sb.storage.from(BUCKET).remove([uploaded]); throw error; }
    ["#pTitle", "#pBody", "#pLink", "#pSem"].forEach(s => $(s).value = ""); $("#pFile").value = "";
    setHint(hint, "올렸어요. 고마워요!");
    await Promise.all([reload("posts"), loadMine()]); renderCourseDetail(); renderHome();
  } catch (err) { setHint(hint, errMsg(err), true); }
  finally { btn.disabled = false; btn.textContent = "올리기"; }
});

/* =============================================================
   5. 교재 나눔 (신청 정보는 본인과 학생회만 볼 수 있어요)
   ============================================================= */
let reqBook = null, bookQuery = "", adminTab = "reqs";
const STATUS = { pending: ["신청됨", "st-pending"], approved: ["승인 · 수령 대기", "st-approved"], done: ["수령 완료", "st-done"], rejected: ["반려", "st-rejected"] };
const badge = s => `<span class="st-badge ${STATUS[s]?.[1] || ""}">${STATUS[s]?.[0] || s}</span>`;
const bookTitle = id => S.books.find(b => b.id === id)?.title || "(삭제된 교재)";
const myRequests = () => S.session ? S.requests.filter(r => r.user_id === S.session.user.id) : [];
const activeReqFor = bookId => myRequests().find(r => r.book_id === bookId && (r.status === "pending" || r.status === "approved"));
function setGuideView(v) {
  $("#segCourses").setAttribute("aria-pressed", v === "courses");
  $("#segBooks").setAttribute("aria-pressed", v === "books");
  $("#bookView").hidden = v !== "books";
  $("#courseListView").hidden = v !== "courses" || !!curCourse;
  $("#courseDetail").hidden = v !== "courses" || !curCourse;
  if (v === "books") renderBooks();
}
$("#segCourses").addEventListener("click", () => setGuideView("courses"));
$("#segBooks").addEventListener("click", () => setGuideView("books"));
$("#bookSearch").addEventListener("input", e => { bookQuery = e.target.value; renderBooks(); });
$("#bookAvail").addEventListener("change", renderBooks);
function renderBooks() {
  const box = $("#books");
  const nr = notReady(); if (nr) { box.innerHTML = `<div style="grid-column:1/-1">${nr}</div>`; renderMyReqs(); return; }
  const q = bookQuery.trim().toLowerCase(), onlyAvail = $("#bookAvail").checked;
  const list = S.books.filter(b => (!q || [b.title, b.author, courseName(b.course_id)].join(" ").toLowerCase().includes(q)) && (!onlyAvail || b.remaining > 0))
    .sort((a, b) => (b.remaining > 0) - (a.remaining > 0) || a.title.localeCompare(b.title, "ko"));
  if (!list.length) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><b>${S.books.length ? "조건에 맞는 교재가 없어요" : "아직 등록된 교재가 없어요"}</b>${S.books.length ? "검색어나 필터를 바꿔 보세요." : S.me.admin ? "아래 '학생회 관리 → 교재 등록'에서 모아 둔 교재를 등록해 주세요." : "학생회가 교재를 정리하는 중이에요."}</div>`;
  } else box.innerHTML = list.map(b => {
    const mine = activeReqFor(b.id), cn = courseName(b.course_id);
    const action = mine ? badge(mine.status) : b.remaining <= 0 ? `<button class="btn ghost" disabled>신청 마감</button>` : `<button class="btn" data-req="${b.id}">신청</button>`;
    return `<article class="card book">
      <div><h4>${esc(b.title)}</h4>${b.author ? `<p class="au">${esc(b.author)}</p>` : ""}</div>
      <div class="chips">${cn ? `<span class="chip">${esc(cn)}</span>` : ""}<span class="chip cert">${esc(b.cond || "")}</span></div>
      ${b.note ? `<p class="au">${esc(b.note)}</p>` : ""}
      <div class="row"><span class="stock ${b.remaining > 0 ? "" : "zero"}">남은 수량 <b>${Math.max(0, b.remaining)}</b> / ${b.qty}</span>${action}</div>
      ${S.me.admin ? `<div class="adminrow"><button class="linkbtn" data-edit-b="${b.id}">수정</button><button class="linkbtn del" data-del-b="${b.id}">삭제</button></div>` : ""}
    </article>`; }).join("");
  renderMyReqs();
  $("#adminSec").hidden = !S.me.admin;
  if (S.me.admin) renderAdmin();
}
$("#books").addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.req) {
    $("#reqPanel").hidden = false; $("#rHint").textContent = "";
    if (!S.session || !S.me.member) {
      $("#reqForm").hidden = true;
      $("#reqTitle").innerHTML = S.session ? `학교 메일(@${esc(DOMAIN)}) 계정만 신청할 수 있어요` : `교재를 신청하려면 학교 계정으로 로그인해 주세요 <button type="button" class="btn rulesbtn" data-login>로그인</button>`;
      return;
    }
    if (!rulesAgreed()) { openRules("agree"); return; }
    reqBook = S.books.find(b => b.id === t.dataset.req);
    $("#reqForm").hidden = false; $("#reqTitle").textContent = `『${reqBook.title}』 신청`;
    const last = myRequests().slice(-1)[0];
    if (last) { if (!$("#rName").value) $("#rName").value = last.name; if (!$("#rSid").value) $("#rSid").value = last.student_id; if (!$("#rContact").value) $("#rContact").value = last.contact; }
    $("#reqPanel").scrollIntoView({ block: "nearest", behavior: "smooth" }); $("#rName").focus();
  }
  if (t.dataset.editB) {
    const b = S.books.find(x => x.id === t.dataset.editB);
    adminTabSet("add");
    $("#bTitle").value = b.title; $("#bAuthor").value = b.author || ""; $("#bCourse").value = b.course_id || ""; $("#bQty").value = b.qty; $("#bCond").value = b.cond || "깨끗함"; $("#bNote").value = b.note || "";
    $("#bEditId").value = b.id; $("#bSubmit").textContent = "수정 저장"; $("#bReset").hidden = false;
    $("#adminSec").scrollIntoView({ behavior: "smooth" });
  }
  if (t.dataset.delB) {
    if (!confirmTwice(t, "한 번 더 누르면 삭제 (신청 기록도 지워져요)")) return;
    const { error } = await sb.from("books").delete().eq("id", t.dataset.delB);
    if (error) { toast(errMsg(error)); return; }
    await Promise.all([reload("books"), loadMine()]); renderBooks();
  }
});
$("#reqClose").addEventListener("click", () => { $("#reqPanel").hidden = true; reqBook = null; });
$("#reqForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hint = $("#rHint");
  if (!needMember(hint) || !reqBook) return;
  const name = $("#rName").value.trim(), sid = $("#rSid").value.trim(), contact = $("#rContact").value.trim();
  if (!name || !sid || !contact) { setHint(hint, "이름, 학번, 연락 방법을 모두 적어 주세요.", true); return; }
  $("#rSubmit").disabled = true;
  const { error } = await sb.rpc("request_book", { p_book: reqBook.id, p_name: name, p_sid: sid, p_contact: contact, p_memo: $("#rMemo").value.trim() });
  $("#rSubmit").disabled = false;
  if (error) { setHint(hint, errMsg(error), true); return; }
  $("#rMemo").value = ""; $("#reqPanel").hidden = true; reqBook = null; toast("신청했어요. 학생회가 확인하면 알려 드려요.");
  await Promise.all([reload("books"), loadMine()]); renderBooks();
});
function renderMyReqs() {
  const items = myRequests().slice().sort((a, b) => ts(b.created_at) - ts(a.created_at));
  $("#myReqSec").hidden = !items.length;
  $("#myReqs").innerHTML = items.map(r => `<article class="card q">
    <div class="qhead"><h4>${esc(bookTitle(r.book_id))}</h4>${badge(r.status)}</div>
    <div class="meta"><span class="mono">${reqTime(r.created_at)} 신청</span>${r.reply ? `<span>학생회: ${esc(r.reply)}</span>` : ""}
      ${r.status === "pending" ? `<button class="linkbtn del" data-cancel="${r.id}">신청 취소</button>` : ""}</div>
  </article>`).join("");
}
$("#myReqs").addEventListener("click", async e => {
  const b = e.target.closest("[data-cancel]"); if (!b) return;
  if (!confirmTwice(b, "한 번 더 누르면 취소")) return;
  const { error } = await sb.rpc("cancel_book_request", { p_id: b.dataset.cancel });
  if (error) { toast(errMsg(error)); return; }
  await loadMine(); renderBooks();
});
/* 학생회 관리 */
function adminTabSet(t) {
  adminTab = t;
  document.querySelectorAll("#adminSec [data-at]").forEach(b => b.setAttribute("aria-pressed", b.dataset.at === t));
  $("#adminReqs").hidden = t !== "reqs"; $("#bookForm").hidden = t !== "add";
}
$("#adminSec").addEventListener("click", e => { const b = e.target.closest("[data-at]"); if (b) adminTabSet(b.dataset.at); });
function fillCourseSelect() {
  const sel = $("#bCourse"), v = sel.value;
  sel.innerHTML = `<option value="">선택 안 함</option>` + allCourses().map(c => `<option value="${c.id}">${esc(yearName(c.y))} · ${esc(c.name)}</option>`).join("");
  sel.value = v;
}
function renderAdmin() {
  const rows = S.requests.map(r => ({ ...r }));
  const order = { pending: 0, approved: 1, done: 2, rejected: 3 };
  /* 교재별 신청 순번: 반려를 뺀 신청을 신청 시각 순으로 */
  const rank = {};
  [...rows].filter(r => r.status !== "rejected").sort((a, b) => ts(a.created_at) - ts(b.created_at)).forEach(r => { rank[r.book_id] = (rank[r.book_id] || 0) + 1; r.rank = rank[r.book_id]; });
  rows.sort((a, b) => (order[a.status] - order[b.status]) || ts(a.created_at) - ts(b.created_at));
  const pending = rows.filter(r => r.status === "pending").length;
  document.querySelector('#adminSec [data-at="reqs"]').textContent = `신청 관리${pending ? ` · 대기 ${pending}` : ""}`;
  const doneN = rows.filter(r => r.status === "done" || r.status === "rejected").length;
  $("#adminReqs").innerHTML = `<div class="purge"><span class="hint">처리가 끝난 신청(수령 완료·반려)의 이름·학번·연락처는 매년 6월 30일, 12월 31일에 자동으로 지워져요. 지금 바로 지우려면 버튼을 누르세요. 현재 ${doneN}건</span>${doneN ? `<button type="button" class="btn ghost" id="purgeReqs">처리 끝난 신청 정보 삭제</button>` : ""}</div>` + (rows.length ? `<div class="tablewrap"><table class="reqs">
    <thead><tr><th>교재</th><th>순번</th><th>신청 시각</th><th>신청자</th><th>학번</th><th>연락</th><th>메모</th><th>상태</th><th>처리</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td>${esc(bookTitle(r.book_id))}</td><td class="mono">${r.rank ? r.rank + "번째" : "—"}</td><td class="mono">${reqTime(r.created_at)}</td><td>${esc(r.name)}</td><td class="mono">${esc(r.student_id)}</td><td>${esc(r.contact)}</td><td>${esc(r.memo || "")}</td>
      <td>${badge(r.status)}</td>
      <td class="act">${r.status === "pending" ? `<button class="btn ghost" data-act="approved" data-r="${r.id}">승인</button> <button class="btn ghost" data-act="rejected" data-r="${r.id}">반려</button>`
        : r.status === "approved" ? `<button class="btn ghost" data-act="done" data-r="${r.id}">수령 완료</button> <button class="btn ghost" data-act="pending" data-r="${r.id}">승인 취소</button>` : "—"}</td>
    </tr>`).join("")}</tbody></table></div>`
    : emptyBox("아직 들어온 신청이 없어요", "학생이 신청하면 여기에 쌓여요."));
}
$("#adminReqs").addEventListener("click", async e => {
  const pg = e.target.closest("#purgeReqs");
  if (pg) {
    if (!confirmTwice(pg, "한 번 더 누르면 삭제 (되돌릴 수 없어요)")) return;
    pg.disabled = true;
    const { data, error } = await sb.rpc("admin_purge_requests");
    if (error) { toast(errMsg(error)); pg.disabled = false; return; }
    toast(`신청 정보 ${data}건을 지웠어요.`); await loadMine(); renderBooks(); return;
  }
  const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
  t.disabled = true;
  const { error } = await sb.rpc("admin_set_request_status", { p_id: t.dataset.r, p_status: t.dataset.act });
  if (error) { toast(errMsg(error)); t.disabled = false; return; }
  await Promise.all([reload("books"), loadMine()]); renderBooks();
});
$("#bReset").addEventListener("click", () => { $("#bookForm").reset(); $("#bEditId").value = ""; $("#bSubmit").textContent = "등록"; $("#bReset").hidden = true; $("#bQty").value = "1"; });
$("#bookForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hint = $("#bHint");
  const title = $("#bTitle").value.trim(), qty = parseInt($("#bQty").value, 10);
  if (!title) { setHint(hint, "교재 제목을 적어 주세요.", true); return; }
  if (!(qty >= 1 && qty <= 999)) { setHint(hint, "수량은 1 이상 숫자로 적어 주세요.", true); return; }
  const editId = $("#bEditId").value;
  const row = { title, author: $("#bAuthor").value.trim(), course_id: $("#bCourse").value, qty, cond: $("#bCond").value, note: $("#bNote").value.trim() };
  $("#bSubmit").disabled = true;
  let error;
  if (editId) {
    const old = S.books.find(b => b.id === editId), given = old ? old.qty - old.remaining : 0;
    ({ error } = await sb.from("books").update({ ...row, remaining: Math.max(0, qty - given) }).eq("id", editId));
  } else {
    ({ error } = await sb.from("books").insert({ ...row, remaining: qty }));
  }
  $("#bSubmit").disabled = false;
  if (error) { setHint(hint, errMsg(error), true); return; }
  setHint(hint, editId ? "수정했어요." : `『${title}』을 등록했어요.`);
  if (editId) $("#bReset").click(); else { ["#bTitle", "#bAuthor", "#bNote"].forEach(s => $(s).value = ""); $("#bQty").value = "1"; }
  await reload("books"); renderBooks();
});

/* =============================================================
   6. QnA (익명 질문 · 답변)
   ============================================================= */
const Q_CATS = ["전체", "진로", "수강·과목", "대회·활동", "자격증", "학교생활", "기타"];
let qCat = "전체";
$("#qFilter").innerHTML = Q_CATS.map(c => `<button class="fbtn" data-k="${c}" aria-pressed="${c === qCat}">${c}</button>`).join("");
$("#qFilter").addEventListener("click", e => {
  const b = e.target.closest(".fbtn"); if (!b) return; qCat = b.dataset.k;
  document.querySelectorAll("#qFilter .fbtn").forEach(x => x.setAttribute("aria-pressed", x.dataset.k === qCat)); renderQ();
});
const answerCount = qid => S.comments.filter(c => c.target_type === "question" && c.target_id === qid && !c.deleted && !c.by_author).length;
function renderQ() { keepInputs($("#qlist"), _renderQ); }
function _renderQ() {
  const box = $("#qlist");
  const nr = notReady(); if (nr) { box.innerHTML = nr; return; }
  const list = S.questions.filter(q => qCat === "전체" || q.category === qCat).sort((a, b) => ts(b.created_at) - ts(a.created_at));
  if (!list.length) { box.innerHTML = emptyBox("아직 질문이 없어요", "첫 질문을 남겨 보세요."); return; }
  box.innerHTML = list.map(q => {
    const n = answerCount(q.id), mine = S.mine.question.has(q.id);
    return `<article class="card q" id="q-${q.id}">
      <div class="qhead"><h4>${esc(q.title)}</h4><span class="status ${n ? "done" : "open"}">${n ? `답변 ${n}` : "답변 대기"}</span></div>
      ${q.body ? `<p class="body">${esc(q.body)}</p>` : ""}
      <div class="meta">${likeBtn("question", q.id, q.like_count)}<span class="chip">${esc(q.category)}</span><span>익명${mine ? " (내 글)" : ""}</span><span class="mono">${fullDate(q.created_at)}</span>
        ${reportBtn("question", q.id)}
        ${S.me.admin || mine ? `<button type="button" class="linkbtn del" data-delete="question:${q.id}">삭제</button>` : ""}</div>
      ${cmBlock("question", q.id, "답변")}
    </article>`; }).join("");
}
$("#askForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hint = $("#askHint");
  if (!needMember(hint)) return;
  const title = $("#qTitle").value.trim();
  if (!title) { setHint(hint, "제목을 적어 주세요.", true); $("#qTitle").focus(); return; }
  const btn = $("#qSubmit"); btn.disabled = true;
  const { error } = await sb.from("questions").insert({ category: $("#qCat").value, title, body: $("#qBody").value.trim() });
  btn.disabled = false;
  if (error) { setHint(hint, errMsg(error), true); return; }
  $("#qTitle").value = ""; $("#qBody").value = ""; setHint(hint, "질문을 등록했어요.");
  await Promise.all([reload("questions"), loadMine()]); renderQ(); renderHome();
});

/* =============================================================
   홈 · 운영 관리
   ============================================================= */
function renderHome() {
  const empty = t => `<p class="hint">${!sb ? "데이터베이스를 연결하면 새 소식이 보여요." : !S.loaded ? "불러오는 중이에요." : t}</p>`;
  const st = [...S.stories].sort((a, b) => ts(b.created_at) - ts(a.created_at)).slice(0, 3);
  const qs = [...S.questions].sort((a, b) => ts(b.created_at) - ts(a.created_at)).slice(0, 3);
  const ids = new Set(allCourses().map(c => c.id));
  const hot = S.posts.filter(p => ids.has(p.course_id)).sort((a, b) => (b.like_count - a.like_count) || (ts(b.created_at) - ts(a.created_at))).slice(0, 3);
  $("#homeStories").innerHTML = st.length ? `<ul class="newslist">${st.map(s => `<li><button type="button" class="newsitem" data-go="seniors"><b>${esc(s.title)}</b><span class="hint">${STORY_TYPES[s.type] || ""} · ${fullDate(s.created_at)}</span></button></li>`).join("")}</ul>` : empty("아직 올라온 이야기가 없어요.");
  $("#homeQna").innerHTML = qs.length ? `<ul class="newslist">${qs.map(q => { const n = answerCount(q.id); return `<li><button type="button" class="newsitem" data-go="qna"><b>${esc(q.title)}</b><span class="hint">${n ? `답변 ${n}` : "답변 대기"} · ${fullDate(q.created_at)}</span></button></li>`; }).join("")}</ul>` : empty("아직 올라온 질문이 없어요.");
  $("#homeHot").innerHTML = hot.length ? `<ul class="newslist">${hot.map(p => `<li><button type="button" class="newsitem" data-go-course="${p.course_id}"><b>${esc(p.title)}</b><span class="hint">${esc(courseName(p.course_id))} · ${KINDS[p.kind]} · ♥ ${p.like_count}</span></button></li>`).join("")}</ul>` : empty("아직 올라온 자료가 없어요.");
  const avail = S.books.filter(b => b.remaining > 0).length;
  $("#homeBooks").textContent = S.loaded ? (S.books.length ? `지금 신청할 수 있는 나눔 교재 ${avail}종` : "교재 나눔을 준비하고 있어요") : "";
  renderReports();
}
$("#p-home").addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { location.hash = g.dataset.go; window.scrollTo({ top: 0 }); return; }
  const c = e.target.closest("[data-go-course]"); if (c) { location.hash = "courses"; setGuideView("courses"); openCourse(c.dataset.goCourse); return; }
  const bk = e.target.closest("[data-go-books]"); if (bk) { location.hash = "courses"; setGuideView("books"); window.scrollTo({ top: 0 }); }
});
const TYPE_KO = { post: "과목 자료", story: "선배 이야기", question: "QnA", comment: "댓글" };
function renderReports() {
  const box = $("#reportAdmin");
  box.hidden = !S.me.admin; if (!S.me.admin) return;
  if (S.usage) {
    const pct = Math.min(100, (S.usage.bytes / STORAGE_LIMIT) * 100);
    $("#usage").innerHTML = `<div class="usage"><span>첨부 파일 ${S.usage.files}개 · ${fsize(S.usage.bytes)} 사용 중 (무료 용량 1GB의 ${pct.toFixed(1)}%)</span><div class="bar"><i style="width:${pct}%"></i></div>${pct > 80 ? `<span class="err">용량이 얼마 남지 않았어요. 오래된 큰 파일을 정리하거나 링크로 올리도록 안내해 주세요.</span>` : ""}</div>`;
  } else $("#usage").innerHTML = "";
  $("#reportList").innerHTML = S.reports.length ? S.reports.map(r => {
    const reasons = {}; String(r.reasons || "").split(",").filter(Boolean).forEach(x => reasons[x] = (reasons[x] || 0) + 1);
    const key = r.target_type + ":" + r.target_id;
    return `<div class="reprow">
      <div class="reptext"><span class="chip">${r.preview == null ? "이미 삭제됨" : TYPE_KO[r.target_type]}</span> <b>신고 ${r.report_count}건</b>
        <span class="hint">${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(" · ")}</span>
        ${r.preview != null ? `<p class="body">${esc(String(r.preview).slice(0, 140))}${String(r.preview).length > 140 ? "…" : ""}</p>` : ""}</div>
      <div class="repact">${r.preview != null ? `<button type="button" class="btn ghost" data-rep-del="${key}">글 삭제</button>` : ""}<button type="button" class="btn ghost" data-rep-clear="${key}">${r.preview != null ? "신고 기각" : "기록 정리"}</button></div>
    </div>`; }).join("") : `<p class="hint">들어온 신고가 없어요.</p>`;
}
$("#reportList").addEventListener("click", async e => {
  const b = e.target.closest("[data-rep-del],[data-rep-clear]"); if (!b) return;
  if (!confirmTwice(b, "한 번 더 누르면 실행")) return;
  b.disabled = true;
  const [type, id] = (b.dataset.repDel || b.dataset.repClear).split(":");
  try {
    if (b.dataset.repDel) await deleteContent(type, id);
    const { error } = await sb.rpc("admin_dismiss_reports", { p_type: type, p_id: id }); if (error) throw error;
    await refresh();
  } catch (err) { b.disabled = false; b.textContent = "실패"; toast(errMsg(err)); }
});

/* =============================================================
   시작
   ============================================================= */
renderAll();
if (!localAgreed) openRules("agree");
if (!sb) {
  showBanner("warn", `<span><b>아직 데이터베이스가 연결되지 않았어요.</b> config.js 에 Supabase 주소와 키를 넣으면 게시판이 작동해요. (안내서 6단계)</span>`);
} else {
  let first = true;
  sb.auth.onAuthStateChange((event, session) => {
    /* 이 콜백 안에서 바로 Supabase를 부르면 멈출 수 있어서 한 박자 뒤에 처리해요 */
    setTimeout(async () => {
      if (event === "TOKEN_REFRESHED") { S.session = session; return; }
      S.session = session;
      if (session) {
        const email = (session.user?.email || "").toLowerCase();
        if (!email.endsWith("@" + DOMAIN)) {
          await sb.auth.signOut();
          S.session = null;
          showBanner("warn", `<span>학교 메일(<b>@${esc(DOMAIN)}</b>) 계정으로만 로그인할 수 있어요. 로그인 창에서 학교 계정을 골라 주세요.</span>`);
        }
        if (event === "SIGNED_IN") {
          try { const t = sessionStorage.getItem("after-login-tab"); if (t) { sessionStorage.removeItem("after-login-tab"); location.hash = t; } } catch (e) {}
        }
      }
      if (first) { first = false; await refresh(); } else { await loadMine(); renderAll(); }
    }, 0);
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - S.lastLoad > 60000) refresh(); });
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 180000);
}
