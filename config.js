/* =============================================================
   스마트보안학과 길잡이 · 설정 파일
   안내서 7단계에서 복사한 값 두 개만 아래에 붙여 넣으세요.
   (anon/publishable 키는 공개돼도 괜찮은 키예요. 데이터는 setup.sql의
    보안 규칙이 지켜요. 단, service_role / secret 키는 절대 넣지 마세요!)
   ============================================================= */
window.HUB_CONFIG = {
  // Supabase > Project Settings > Data API 의 Project URL
  SUPABASE_URL: "https://YOUR-PROJECT-ID.supabase.co",

  // Supabase > Project Settings > API Keys 의 anon public 키 (또는 publishable 키)
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",

  // 글쓰기를 허용할 학교 메일 도메인 (setup.sql 의 is_member() 와 같아야 해요)
  SCHOOL_DOMAIN: "gachon.ac.kr",

  // 이용 규칙을 바꾸면 이 값을 바꾸세요. 모든 사람에게 규칙 동의 창이 다시 떠요.
  RULES_VERSION: "2026-1",
};
