#!/usr/bin/env python3
"""assets/emoticon/ 에 이모티콘 그림을 넣거나 뺀 다음 실행하면 list.json 을 맞춰 줘.
이미 있는 이름표(label)는 그대로 두고, 새 그림은 파일 이름으로 이름표를 만들어 (나중에 list.json 에서 고치면 돼)."""
import json, unicodedata
from pathlib import Path

DIR = Path(__file__).resolve().parent / "assets" / "emoticon"
LIST = DIR / "list.json"
EXTS = {".png", ".gif", ".webp", ".jpg", ".jpeg"}

old = json.loads(LIST.read_text(encoding="utf-8")) if LIST.exists() else []
files = {unicodedata.normalize("NFC", p.name) for p in DIR.iterdir() if p.suffix.lower() in EXTS}
keep = [e for e in old if e["file"] in files]                     # 순서·이름표 유지
known = {e["file"] for e in keep}
new = [{"file": f, "label": Path(f).stem} for f in sorted(files - known)]
LIST.write_text(json.dumps(keep + new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"✅ 이모티콘 {len(keep) + len(new)}개 (새로 {len(new)}개, 빠진 것 {len(old) - len(keep)}개)")
for e in new:
    print(f"   + {e['file']}  → 이름표: {e['label']}  (list.json 에서 바꿔도 돼)")
