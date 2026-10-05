// ✏️ 사이트 들어올 때 누르는 4자리 비밀번호 (여기만 바꾸면 돼)
// ⚠️ 화면 잠금용이라 소스에서 보이는 값이야. 사진·버킷리스트는 문장 비밀번호로 따로 암호화돼 있어.
export const SITE_PIN = "0917";

// Firebase 콘솔 → 프로젝트 설정 → 내 앱(웹) 에서 복사한 값을 붙여 넣어 줘.
// apiKey는 공개돼도 괜찮은 값이야 (보안은 firestore.rules + 암호화가 담당).
// 비워 두면 버킷리스트가 이 기기에만 저장되는 테스트 모드로 동작해.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAi2AFy7uf3m5KtPQIXds1xjihFy--_n3g",
  authDomain: "zzing-couple.firebaseapp.com",
  projectId: "zzing-couple",
  storageBucket: "zzing-couple.firebasestorage.app",
  messagingSenderId: "543923130219",
  appId: "1:543923130219:web:a87d82082b6bfb3c36862e"
};

// 🔔 알림 서버(Cloudflare Worker) 주소. 예: "https://noti.내서브도메인.workers.dev"
// 비워 두면 알림 기능은 안 보여.
export const PUSH_URL = "https://noti.sweet-potato-cat.workers.dev";
