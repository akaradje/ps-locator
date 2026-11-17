# -*- coding: utf-8 -*-
"""
เครื่องมือสำหรับผู้ดูแลข้อมูลเท่านั้น (เว็บไม่ต้องใช้ / ไม่ใช่ build step)

ถอดข้อความภาษาไทยจาก PDF ประกาศราชกิจจานุเบกษา → ไฟล์ข้อความ
    python tools/extract-gazette.py 17187.pdf docs/gazette/2567.txt
    python tools/extract-gazette.py 91341.pdf docs/gazette/2568-2.txt

ต้องการ pypdf, fonttools และฟอนต์ THSarabun.ttf ที่ติดตั้งในเครื่อง
(ฟอนต์ต้นฉบับของ PDF เป็น THSarabunPSK/THSarabunIT๙ ซึ่งใช้ลำดับ glyph เดียวกัน)

หมายเหตุ: PDF ใช้ฟอนต์ฝังตัวที่ ToUnicode ไม่สมบูรณ์ จึงต้องถอดรหัส
จาก CID/GID เอง และแปลงรหัสอักษรใช้ส่วนตัว (F700–F71D) กลับเป็น
สระ/วรรณยุกต์ไทยมาตรฐาน ผลลัพธ์ควรตรวจสอบเทียบกับไฟล์ PDF ต้นฉบับเสมอ
"""
import os
import re
import sys
from pathlib import Path

PUA = [0x0E10, 0x0E34, 0x0E35, 0x0E36, 0x0E37, 0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C,
       0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C, 0x0E0D, 0x0E31, 0x0E4D, 0x0E47,
       0x0E48, 0x0E49, 0x0E4A, 0x0E4B, 0x0E4C, 0x0E38, 0x0E39, 0x0E3A, 0x0E0E, 0x0E0F, 0x0E2C]

FONT_CANDIDATES = [
    os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\Windows\Fonts\THSarabun.ttf'),
    r'C:\Windows\Fonts\THSarabun.ttf',
]


def load_gid_map():
    from fontTools.ttLib import TTFont
    for fp in FONT_CANDIDATES:
        if os.path.exists(fp):
            tf = TTFont(fp, lazy=True)
            order = tf.getGlyphOrder()
            rev = {}
            for cp, gn in (tf.getBestCmap() or {}).items():
                if gn in order:
                    rev[order.index(gn)] = chr(cp)
            return rev
    raise SystemExit('ไม่พบฟอนต์ THSarabun.ttf — ติดตั้งก่อนรันสคริปต์นี้')


REV = None


def cid_char(c):
    if 0xF700 <= c <= 0xF71D:
        return chr(PUA[c - 0xF700])
    if 0x0E00 <= c <= 0x0E7F or 0x20 <= c <= 0x7E or 0x2010 <= c <= 0x2027:
        return chr(c)
    return ''


def normalize(s):
    for i, c in enumerate(PUA):
        s = s.replace(chr(0xF700 + i), chr(c))
    return s.replace('\u0e4d\u0e32', '\u0e33')


def unescape(b):
    out = bytearray()
    i = 0
    while i < len(b):
        c = b[i]
        if c == 0x5C:
            i += 1
            if i >= len(b):
                break
            e = b[i]
            mp = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12,
                  0x28: 0x28, 0x29: 0x29, 0x5C: 0x5C}
            if e in mp:
                out.append(mp[e]); i += 1
            elif 0x30 <= e <= 0x37:
                s = bytes([e]); j = i + 1; k = 1
                while k < 3 and j < len(b) and 0x30 <= b[j] <= 0x37:
                    s += bytes([b[j]]); j += 1; k += 1
                out.append(int(s, 8) & 0xFF); i = j
            else:
                out.append(e); i += 1
        else:
            out.append(c); i += 1
    return bytes(out)


def dec2(raw):
    s = ''
    for j in range(0, len(raw) - 1, 2):
        c = (raw[j] << 8) | raw[j + 1]
        if c in REV:
            s += REV[c]
        elif 0x20 <= c <= 0x7E:
            s += chr(c)
    return s


def dec1(raw):
    s = ''
    for b in raw:
        if 0x20 <= b <= 0x7E:
            s += chr(b)
        elif 0xA1 <= b <= 0xFB:
            s += chr(0x0E01 + b - 0xA1)
    return s


TOKEN = re.compile(rb'(/R\d+)\s+[\d.]+\s+Tf|\bET\b|<([0-9A-Fa-f\s]+)>|\(([^()]*)\)')


def xobj_text(data, fonttypes):
    cur = None
    out = []
    for m in TOKEN.finditer(data):
        if m.group(1):
            cur = m.group(1).decode('latin1')
        elif m.group(0).strip() == b'ET':
            out.append('\n')
        elif m.group(2) is not None:
            hx = re.sub(rb'\s', b'', m.group(2))
            if len(hx) % 2:
                hx += b'0'
            raw = bytes.fromhex(hx.decode('ascii'))
            out.append(dec2(raw) if fonttypes.get(cur, True) else dec1(raw))
        else:
            raw = unescape(m.group(3))
            out.append(dec2(raw) if fonttypes.get(cur, True) else dec1(raw))
    lines = [l.strip() for l in normalize(''.join(out)).split('\n')]
    return '\n'.join(l for l in lines if l)


def main():
    global REV
    from pypdf import PdfReader
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    REV = load_gid_map()
    reader = PdfReader(src)
    texts = []
    for i, pg in enumerate(reader.pages):
        content = pg.get_contents().get_data()
        refs = re.findall(rb'/(TPL\d+)\s+Do', content)
        xo = pg['/Resources'].get('/XObject')
        parts = []
        if xo and refs:
            for ref in refs:
                obj = xo.get('/' + ref.decode('latin1'))
                if obj is None:
                    continue
                form = obj.get_object()
                res = form.get('/Resources')
                fonts = res.get_object().get('/Font').get_object() if res else {}
                ft = {k: v.get_object().get('/Subtype') == '/Type0' for k, v in fonts.items()}
                parts.append(xobj_text(form.get_data(), ft))
        inline = []
        for blk in re.split(rb'\bET\b', content):
            t = ''
            for s in re.findall(rb'\(([^()]*)\)', blk):
                raw = unescape(s)
                t += ''.join(cid_char((raw[i] << 8) | raw[i + 1]) for i in range(0, len(raw) - 1, 2))
            if t.strip():
                inline.append(t.strip())
        texts.append('=== PAGE %d ===\n%s' % (i + 1, '\n'.join(parts + inline).strip()))
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text('\n'.join(texts), encoding='utf-8')
    print('ถอดข้อความ %d หน้า → %s' % (len(texts), out))


if __name__ == '__main__':
    main()
