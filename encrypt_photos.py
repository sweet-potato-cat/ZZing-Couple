#!/usr/bin/env python3
"""
곰돌찡 ♥ 토끼찡 갤러리 암호화 스크립트

사용법
  1) pip install pillow cryptography      (아이폰 HEIC 사진이면 pillow-heif 도)
  2) photos_raw/ 폴더에 원본 사진을 넣는다
  3) python3 encrypt_photos.py
  4) gallery/ 폴더만 git add → commit → push

처음 실행하면 비밀번호를 정하고(8자 이상), 그 다음부터는 같은 비밀번호로 확인해.
photos_raw/ 는 .gitignore 에 들어 있어서 GitHub에 올라가지 않아.
photos_raw/ 에서 사진을 지우고 다시 실행하면 갤러리에서도 빠져.

캡션(선택): photos_raw/captions.json 에 {"파일이름.jpg": "첫 데이트"} 처럼 적으면 돼.
"""
import base64
import datetime
import getpass
import hashlib
import io
import json
import os
import sys
import unicodedata
from pathlib import Path

try:
    from PIL import Image, ImageOps
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print("먼저 설치해 줘:  pip install pillow cryptography")
    sys.exit(1)

try:  # 아이폰 HEIC 지원 (선택)
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "photos_raw"
OUT = ROOT / "gallery"
META = OUT / "meta.json"
MANIFEST = OUT / "manifest.enc"

ITERATIONS = 600_000          # index.html 과 반드시 같은 값이어야 함 (meta.json 에 저장됨)
CHECK_TEXT = b"gomdol-tokki-ok"
FULL_SIZE = 1600
THUMB_SIZE = 480
EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}


# ---------------- crypto ----------------
def derive(password: str, salt: bytes, iterations: int):
    pw = unicodedata.normalize("NFC", password).encode("utf-8")
    out = hashlib.pbkdf2_hmac("sha256", pw, salt, iterations, dklen=64)
    key = out[:32]
    doc_id = hashlib.sha256(out[32:]).hexdigest()
    return key, doc_id


def encrypt(key: bytes, data: bytes) -> bytes:
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, data, None)


def decrypt(key: bytes, blob: bytes) -> bytes:
    return AESGCM(key).decrypt(blob[:12], blob[12:], None)


# ---------------- password ----------------
def load_or_create_key():
    if META.exists():
        meta = json.loads(META.read_text())
        salt = base64.b64decode(meta["salt"])
        pw = getpass.getpass("비밀번호: ")
        key, _ = derive(pw, salt, meta["iter"])
        try:
            decrypt(key, base64.b64decode(meta["check"]))
        except Exception:
            print("❌ 비밀번호가 달라. (처음 정한 비밀번호를 입력해 줘)")
            sys.exit(1)
        return key

    print("🔐 처음 실행이야! 우리 페이지 비밀번호를 정해 줘.")
    print("   8자 이상, 둘만 아는 짧은 문장을 추천해. 예) 우리처음만난카페는어디")
    while True:
        pw = getpass.getpass("새 비밀번호: ")
        if len(pw) < 8:
            print("   8자 이상으로 해 줘.")
            continue
        if pw != getpass.getpass("한 번 더: "):
            print("   두 번 입력한 게 달라. 다시!")
            continue
        break
    salt = os.urandom(16)
    key, _ = derive(pw, salt, ITERATIONS)
    OUT.mkdir(exist_ok=True)
    META.write_text(json.dumps({
        "v": 1,
        "salt": base64.b64encode(salt).decode(),
        "iter": ITERATIONS,
        "check": base64.b64encode(encrypt(key, CHECK_TEXT)).decode(),
    }, indent=2))
    print("✅ 비밀번호 설정 완료 (gallery/meta.json 생성)")
    return key


# ---------------- photos ----------------
def photo_date(img: Image.Image, path: Path) -> str:
    try:
        exif = img.getexif()
        raw = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        if raw:
            d = datetime.datetime.strptime(str(raw)[:19], "%Y:%m:%d %H:%M:%S")
            return d.strftime("%Y.%m.%d")
    except Exception:
        pass
    return datetime.datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y.%m.%d")


def to_jpeg(img: Image.Image, size: int, quality: int) -> bytes:
    im = img.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True)  # EXIF(GPS 등)은 저장하지 않음
    return buf.getvalue()


def main():
    RAW.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    key = load_or_create_key()

    captions = {}
    cap_file = RAW / "captions.json"
    if cap_file.exists():
        captions = json.loads(cap_file.read_text(encoding="utf-8"))

    files = sorted(p for p in RAW.iterdir() if p.suffix.lower() in EXTS)
    entries, added = [], 0
    for p in files:
        pid = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
        try:
            src = Image.open(p)
            date = photo_date(src, p)
            full_path, thumb_path = OUT / f"{pid}.enc", OUT / f"{pid}_t.enc"
            if not (full_path.exists() and thumb_path.exists()):
                img = ImageOps.exif_transpose(src).convert("RGB")
                full_path.write_bytes(encrypt(key, to_jpeg(img, FULL_SIZE, 85)))
                thumb_path.write_bytes(encrypt(key, to_jpeg(img, THUMB_SIZE, 80)))
                added += 1
                print(f"  📷 {p.name}")
        except Exception as e:
            print(f"  ⚠️ {p.name} 건너뜀: {e}")
            continue
        entries.append({"id": pid, "date": date, "caption": captions.get(p.name, "")})

    entries.sort(key=lambda e: (e["date"], e["id"]), reverse=True)
    MANIFEST.write_bytes(encrypt(key, json.dumps(entries, ensure_ascii=False).encode("utf-8")))

    keep = {f"{e['id']}.enc" for e in entries} | {f"{e['id']}_t.enc" for e in entries}
    removed = 0
    for f in OUT.glob("*.enc"):
        if f.name != MANIFEST.name and f.name not in keep:
            f.unlink()
            removed += 1

    print(f"\n✅ 완료: 전체 {len(entries)}장 (새로 {added}장, 삭제 {removed}장)")
    print("   이제 gallery/ 폴더를 commit & push 하면 돼!")


if __name__ == "__main__":
    main()
