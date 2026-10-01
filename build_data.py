"""Chuyển file Excel bình luận minigame sang data.json gọn nhẹ cho web.

Chạy lại mỗi khi cập nhật Excel:  python3 build_data.py
"""
import json
import re
from collections import OrderedDict

import openpyxl

SRC = "binh_luan_minigame_K12_3.xlsx"
OUT = "data.json"
WINNERS = 100


def fb_slug(url):
    """Lấy định danh tài khoản từ URL Facebook (username hoặc id số)."""
    url = (url or "").strip()
    m = re.search(r"profile\.php\?id=(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"facebook\.com/([^/?#]+)", url)
    return m.group(1).lower() if m else url.lower()


ws = openpyxl.load_workbook(SRC, data_only=True).active
accounts = OrderedDict()
for stt, name, url, content, _t, _fb, answer, rank, _note in ws.iter_rows(min_row=5, values_only=True):
    if not stt:
        continue
    key = fb_slug(url)
    acc = accounts.setdefault(key, {"n": name, "u": key, "r": 0, "a": ""})
    if rank and (not acc["r"] or rank < acc["r"]):
        acc["r"] = int(rank)
        acc["a"] = (content or "").strip()
    elif not acc["r"] and not acc["a"]:
        acc["a"] = (content or "").strip()

# Mỗi phần tử: [tên, fb_id, hạng (0 = trả lời sai), câu trả lời]
people = [[a["n"], a["u"], a["r"], a["a"]] for a in accounts.values()]
data = {
    "title": "Giải mã dàn khách mời K12",
    "answer": ["Jaykii", "Bevis"],
    "winners": WINNERS,
    "total": len(people),
    "people": people,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

correct = sum(1 for p in people if p[2])
print(f"{len(people)} tài khoản, {correct} đúng, top {WINNERS} trúng thưởng -> {OUT}")
