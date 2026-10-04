# 곰돌찡 ♥ 토끼찡

## 폴더 구조
```
couple/
├─ index.html          페이지
├─ app.js              잠금 · 갤러리 · 버킷리스트 로직
├─ config.js           Firebase 설정 (직접 채우기)
├─ firestore.rules     Firebase 보안 규칙 (콘솔에 붙여넣기)
├─ encrypt_photos.py   사진 암호화 스크립트
├─ assets/             배경 그림 (art by @_umeus_)
├─ gallery/            🔐 암호화된 사진 → GitHub에 올라감
└─ photos_raw/         📷 원본 사진 → GitHub에 안 올라감 (.gitignore)
```

## 0. 비밀번호는 두 개야
- **4자리 (사이트 입장, 매번)**: `config.js`의 `SITE_PIN` 값을 바꾸면 돼. 화면 잠금용이라 소스에서 보이는 값이야.
- **문장 비밀번호 (사진·버킷리스트 열쇠)**: `encrypt_photos.py` 처음 실행 때 정해. 기기마다 처음 한 번만 입력해.

## 1. 문장 비밀번호 정하기 + 사진 넣기
```bash
pip install pillow cryptography        # 아이폰 HEIC면 pillow-heif 도
python3 encrypt_photos.py              # 처음 실행 때 비밀번호(8자 이상) 설정
```
사진 추가/삭제: `photos_raw/`에서 넣고 빼고 → 다시 실행 → `gallery/` push.

## 2. Firebase (버킷리스트 공유)
1. console.firebase.google.com → 프로젝트 만들기 (Analytics 꺼도 됨)
2. 빌드 → Firestore Database → 데이터베이스 만들기 (프로덕션 모드)
3. Firestore → 규칙 탭 → `firestore.rules` 내용 붙여넣고 게시
4. 프로젝트 설정 → 내 앱 → 웹(</>) 앱 추가 → 나오는 값을 `config.js`에 복사
5. (권장) Google Cloud 콘솔에서 apiKey 제한: HTTP 리퍼러를 `https://chanyoung-roh.github.io/*` 로

## 3. 로컬 테스트
```bash
python3 -m http.server 8000      # → http://localhost:8000
```
(파일을 더블클릭해서 열면 동작하지 않아. 꼭 서버로!)

## 4. GitHub Pages
`couple` repo에 push → Settings → Pages → Branch: main / root
→ `https://chanyoung-roh.github.io/couple/`

## ⚠️ 주의
- 비밀번호를 바꾸면: 모든 사진을 다시 암호화해야 하고, 버킷리스트도 새로 시작돼.
  (`gallery/` 비우고 스크립트 재실행)
- 원본 사진을 한 번이라도 commit 하면 git 기록에 영원히 남아. `git status`로 꼭 확인!
- 비밀번호를 잊으면 아무도 복구할 수 없어 (원본은 photos_raw에 보관).
