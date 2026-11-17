# -*- coding: utf-8 -*-
"""
สร้าง data/jurisdictions.js จากข้อความที่ถอดจากประกาศราชกิจจานุเบกษา
(tools/extract-gazette.py ถอดจากไฟล์ PDF ต้นฉบับ → docs/gazette/*.txt)

ใช้เฉพาะ Python มาตรฐาน ไม่มี dependency และไม่ใช่ build step ของเว็บ
เว็บยังเปิดผ่าน static server ได้ทันที ไม่ต้องรันสคริปต์นี้

    python tools/build-jurisdictions.py

ข้อมูลสถานีอ่านจาก data/stations.json (ห้ามแก้มือ) เพื่อผูก id กับบัญชีแนบท้าย
"""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIONS = json.loads((ROOT / 'data' / 'stations.json').read_text(encoding='utf-8'))
TEXT_2567 = (ROOT / 'docs' / 'gazette' / '2567.txt').read_text(encoding='utf-8')
TEXT_2568 = (ROOT / 'docs' / 'gazette' / '2568-2.txt').read_text(encoding='utf-8')

THAI_DIGITS = str.maketrans('๐๑๒๓๔๕๖๗๘๙', '0123456789')
HEADERS = {
    'ลำดับที่', 'ชื่อสถานีตำรวจภูธร', 'ตั้งอยู่ที่',
    'เขตอำนาจความรับผิดชอบหรือเขตพื้นที่การปกครอง',
    'อยู่ในความปกครอง ตำรวจภูธรจังหวัด', 'อยู่ในความปกครองตำรวจภูธรจังหวัด',
    'อำเภอ', 'ตำบล', 'จำนวน ตำบล', 'จำนวนตำบล', 'ชื่อตำบล',
    'หน้า', 'เล่ม', 'ตอนพิเศษ', 'ง', 'ราชกิจจานุเบกษา',
}
# คำที่บ่งว่าเป็น "หมายเหตุแนวเขต" ไม่ใช่ชื่อตำบล
# ห้ามใส่คำที่เป็นส่วนหนึ่งของชื่อตำบลจริง เช่น คลอง ถนน สะพาน เขต หลักเขต แยก
NOTE_START = re.compile(r'\(|บางส่วน|เฉพาะ|โดยใช้|ตั้งแต่|ทั้งตำบล|หมู่ที่|แนวเขต|\sอำเภอ|\sจังหวัด|\sและ\s|\sรวมทั้ง')
# ระวัง: ห้ามใช้คำสั้นที่เป็นส่วนหนึ่งของชื่อตำบลจริง (เช่น "จด" มีใน โจด / เจดีย์)
NOTE_WORD = re.compile(r'หมู่ที่|บางส่วน|แนวเขต|กิโลเมตร|บรรจบ|ตั้งแต่|จนถึง|โดยใช้|เฉพาะ|ต่อเนื่อง|ช่องทางจราจร|ด้านทิศ')


def num(s):
    s = s.translate(THAI_DIGITS).strip()
    return int(s) if re.fullmatch(r'\d{1,3}', s) else None


def clean_name(s):
    s = s.strip().replace('\u00ad', '').replace('\u200b', '')
    s = NOTE_START.split(s, maxsplit=1)[0]
    return re.sub(r'\s+', ' ', s).strip(' .,-')


STOP = {'และ', 'หรือ', 'ของ', 'ใน', 'ที่', 'ด้วย', 'กับ', 'คือ', 'ได้'}


def good_name(s):
    # อนุญาตจุดในชื่อย่อ เช่น "จ. ป. ร" (ตำบลใน จ.ระนอง)
    # แต่ปฏิเสธตัวเลข เพราะมักเป็นเศษข้อความหมายเหตุ เช่น "ถนนสุวรรณภูมิ 1"
    return (bool(s) and len(s) <= 30 and s not in STOP
            and bool(re.search(r'[ก-๙]', s))
            and not re.search(r'\d', s)
            and not NOTE_WORD.search(s))


def norm(s):
    s = unicodedata.normalize('NFC', str(s or '')).lower()
    s = re.sub(r'^(ตำบล|แขวง|ต\.|อำเภอ|อ\.)\s*', '', s)
    s = s.replace('\u00ad', '').replace('\u200b', '')
    return re.sub(r'[\s\-‐-―.,()/\\]+', '', s)


def parse_stations(text):
    by_prov = {}
    for st in STATIONS:
        by_prov.setdefault(st['province_th'], []).append(st)
    out = {}
    for page in text.split('=== PAGE ')[1:]:
        head, _, body = page.partition(' ===\n')
        if not body:
            continue
        m = re.search(r'ตำรวจภูธรจังหวัด([^\s,\.]+)', body)
        if not m or 'รายชื่อสถานีตำรวจ' not in body:
            continue
        prov = m.group(1)
        pno = int(head.strip())
        mr = re.search(r'ตำรวจภูธรภาค\s*([๐-๙0-9]+)', body)
        region = mr.group(1).translate(THAI_DIGITS) if mr else ''
        lines = [l.strip() for l in body.split('\n') if l.strip()]
        lines = [l for l in lines
                 if l not in HEADERS
                 and not l.startswith('รายชื่อสถานี')
                 and not l.startswith('ตำรวจภูธรภาค')
                 and not re.match(r'^\d+\s+ตำรวจภูธรภาค', l)
                 and not re.match(r'^(หน้า|เล่ม|ตอนพิเศษ|ราชกิจจานุเบกษา)\b', l)
                 and (num(l) is not None or not re.fullmatch(r'[๐-๙0-9\s]+', l))]
        i = 0
        while i < len(lines):
            if num(lines[i]) is None:
                i += 1
                continue
            end = None
            for j in range(i + 5, min(i + 14, len(lines))):
                if lines[j] == prov:
                    end = j
                    break
            if end is None or end - i < 6:
                i += 1
                continue
            b = lines[i:end + 1]
            idx, name, amphoe, at, cnt = num(b[0]), b[1], b[2], b[3], num(b[4])
            listtext = ' '.join(b[5:-1])
            if idx is None or cnt is None:
                i += 1
                continue
            chunks = re.split(r'\s*(\d{1,2})\.\s*', listtext)
            tambons = []
            for k in range(1, len(chunks) - 1, 2):
                raw = chunks[k + 1].strip()
                nm = clean_name(raw)
                if not good_name(nm):
                    continue
                # ประกาศฉบับจริงมีเลขลำดับพิมพ์ผิดบางแห่ง (เช่น "8." แทน "2.",
                # "23." แทน "13.") จึงใช้จำนวนรายการตามคอลัมน์ "จำนวนตำบล" เป็นตัวตัด
                # ไม่บังคับให้เลขลำดับต่อเนื่อง และปฏิเสธเศษหมายเหตุที่เกินจำนวน
                if len(tambons) >= cnt:
                    break
                note = raw[len(nm):].strip(' .,-') if raw.startswith(nm) else ''
                partial = bool(re.search(r'บางส่วน|เฉพาะ|หมู่ที่|แนวเขต|โดยใช้|ตั้งแต่|ทางหลวง|ถนน|คลอง|อำเภอ', note))
                tambons.append({'name': nm, 'partial': partial, 'note': note[:90]})
            verify = len(tambons) != cnt
            cand = [s for s in by_prov.get(prov, []) if s['name'] in ('สภ.' + name, 'สน.' + name)]
            if cand:
                sid = cand[0]['id']
                rec = {'id': sid, 'short': name, 'province': prov, 'region': region,
                       'amphoe': amphoe, 'at': at, 'count': cnt, 'page': pno,
                       'verify': verify, 'tambons': tambons}
                if sid not in out:
                    out[sid] = rec
                else:
                    seen = {t['name'] for t in out[sid]['tambons']}
                    out[sid]['tambons'].extend(t for t in tambons if t['name'] not in seen)
                    out[sid]['verify'] = out[sid]['verify'] or verify
            i = end + 1
    return sorted(out.values(), key=lambda x: (x['province'], x['short']))


SUMMARY = [
    {
        'id': 'what', 'title': 'ประกาศนี้ทำอะไร',
        'text': 'กำหนดเขตอำนาจการรับผิดชอบหรือเขตพื้นที่การปกครองของส่วนราชการในสังกัดสำนักงานตำรวจแห่งชาติ ให้ตรงกับพระราชกฤษฎีกาแบ่งส่วนราชการ พ.ศ. 2567 และกฎกระทรวงที่ออกใหม่ พร้อมยกเลิกประกาศเดิมลงวันที่ 7 กันยายน 2552 และที่แก้ไขเพิ่มเติม',
        'keys': 'ประกาศคืออะไร ยกเลิก 2552 พระราชกฤษฎีกา 2567 กฎกระทรวง เขตอำนาจ', 'doc': '2567', 'page': 1,
    },
    {
        'id': 'why', 'title': 'ทำไมต้องออกประกาศใหม่',
        'text': 'มีการยุบเลิกส่วนราชการเดิมและจัดตั้งส่วนราชการขึ้นใหม่ทั้งหมด เขตอำนาจตามประกาศเดิมจึงไม่สอดคล้องกับโครงสร้างใหม่ จำเป็นต้องออกประกาศใหม่พร้อมบัญชีแนบท้าย',
        'keys': 'ทำไม ยุบเลิก จัดตั้งใหม่ โครงสร้าง บัญชีแนบท้าย', 'doc': '2567', 'page': 1,
    },
    {
        'id': 'people', 'title': 'ประชาชนแจ้งเหตุ → ไปโรงพักไหน',
        'text': 'ให้ไปสถานีตำรวจที่มีเขตอำนาจเหนือท้องที่ที่เหตุเกิด วิธีง่าย ๆ คือพิมพ์ชื่อตำบลหรือแขวงที่เกิดเหตุในช่องค้นหาด้านบน ระบบจะบอกชื่อ สภ./สน. เบอร์โทร และทางไปโรงพัก',
        'keys': 'ประชาชน แจ้งเหตุ ท้องที่ที่เหตุเกิด ตำบล แขวง โรงพัก 191 แจ้งความ', 'doc': '2567', 'page': 3,
    },
    {
        'id': 'investigator', 'title': 'พนักงานสอบสวน → รู้เขตตัวเองและเขตเพื่อนบ้าน',
        'text': 'บัญชีแนบท้ายระบุรายชื่อตำบลในเขตอำนาจของแต่ละ สภ. จึงตรวจสอบเขตของตนเอง เขตของสถานีข้างเคียง และปลายทางของหมาย/การประสานคดีได้ โดยดูหมายเหตุ "บางส่วน / เฉพาะหมู่ที่ / แนวเขตถนน" ประกอบด้วยเสมอ',
        'keys': 'พนักงานสอบสวน พงส. ส่งหมาย ประสานคดี เขตเพื่อนบ้าน บางส่วน เฉพาะหมู่ที่ แนวเขต สำนวน', 'doc': '2567', 'page': 111,
    },
    {
        'id': 'law', 'title': 'ฐานกฎหมายที่ใช้ออกประกาศ',
        'text': 'อาศัยอำนาจตามมาตรา 7 แห่งพระราชกฤษฎีกาแบ่งส่วนราชการสำนักงานตำรวจแห่งชาติ พ.ศ. 2567 และข้อ 4 ของกฎกระทรวงแบ่งส่วนราชการเป็นกองบังคับการหรือส่วนราชการหรือหน่วยงานอย่างอื่นหรือในระดับต่ำลงไปในสำนักงานตำรวจแห่งชาติ พ.ศ. 2567 โดยนายกรัฐมนตรีเป็นผู้ออกประกาศ',
        'keys': 'มาตรา 7 ข้อ 4 อำนาจ นายกรัฐมนตรี กฎหมาย ฐานอำนาจ', 'doc': '2567', 'page': 1,
    },
    {
        'id': 'toc', 'title': '427 หน้า มีอะไรบ้าง',
        'text': 'บช.น. หน้า 2–103 · ภ.1–9 หน้า 104–342 · บช.ก. 343–371 · บช.ปส. 372–373 · บช.ส. 374 · สตม. 375–382 · ตชด. 383–389 · สพฐ.ตร. 390–406 · สำนักงานเทคโนโลยีสารสนเทศและการสื่อสาร 407–409 · บช.ทท. 410–419 · บช.สอท. 420–425',
        'keys': 'สารบัญ 427 หน้า ภาค 1 ภาค 9 นครบาล สอบสวนกลาง ตระเวนชายแดน ท่องเที่ยว ไซเบอร์ หน้า', 'doc': '2567', 'page': 2,
    },
    {
        'id': 'list', 'title': 'รายชื่อตำบลอยู่หน้าไหน',
        'text': 'รายชื่อสถานีตำรวจภูธรพร้อม "จำนวนตำบล / ชื่อตำบล" อยู่ในบัญชีแนบท้ายหน้า 113–344 รวม 231 หน้า นี่คือต้นทางของช่องค้นหาชื่อตำบลในเว็บนี้ แต่ละรายการจะแสดงเลขหน้าในประกาศให้กดตรวจสอบได้',
        'keys': 'ชื่อตำบล จำนวนตำบล บัญชีแนบท้าย หน้า 113 344 231 หน้า ต้นทาง ข้อมูล', 'doc': '2567', 'page': 113,
    },
    {
        'id': 'amendment', 'title': 'ฉบับที่ 2 แก้อะไร (13 หน้า)',
        'text': 'ประกาศฉบับที่ 2 ลงวันที่ 22 ตุลาคม 2568 (ราชกิจจานุเบกษา 24 ตุลาคม 2568 เล่ม 142 ตอนพิเศษ 341 ง) แก้ไขเขตอำนาจของกองกำกับการ 8 กองบังคับการตำรวจทางหลวง หลังจัดตั้งสถานีตำรวจทางหลวง 3 และ 4 และกำหนดเขตอำนาจของส่วนงานความเห็นทางคดีอาญา ในสังกัดกองบัญชาการตำรวจสอบสวนกลาง มีผลเมื่อพ้นกำหนด 30 วันนับแต่วันประกาศ',
        'keys': 'ฉบับที่ 2 แก้ไข 2568 ตุลาคม ทางหลวง 3 ทางหลวง 4 ความเห็นทางคดีอาญา สอบสวนกลาง 30 วัน', 'doc': '2568-2', 'page': 1,
    },
    {
        'id': 'metro', 'title': 'กทม. ใช้แขวง ไม่ใช้ตำบล',
        'text': 'เขตอำนาจของสถานีตำรวจนครบาลในประกาศเขียนเป็นแนวเขตถนน คลอง และรางรถไฟ (หน้า 5–103) ไม่ได้ระบุเป็นรายชื่อตำบล ระบบจึงแสดง "แขวงที่ตั้งสถานี" จากที่อยู่ที่ยืนยันโดย ตร. พร้อมลิงก์ไปหน้าประกาศ หากต้องการความชัดเจนระดับแนวเขต ให้เปิดประกาศฉบับจริง',
        'keys': 'กรุงเทพ กทม แขวง สน. นครบาล แนวเขต ถนน คลอง รางรถไฟ', 'doc': '2567', 'page': 5,
    },
    {
        'id': 'caution', 'title': 'ข้อควรระวังก่อนใช้ทางกฎหมาย',
        'text': 'หน้านี้เป็นการย่อและทำดัชนีเพื่อช่วยค้นหา ไม่ใช่ประกาศฉบับจริง กรณีตำบลที่มีหมายเหตุ "บางส่วน" "เฉพาะหมู่ที่" หรือแนวแบ่งเขตถนน ให้เปิดหน้าประกาศหรือสอบถามสถานีโดยตรงก่อนส่งหมาย รับแจ้งเหตุ หรือดำเนินการทางคดี',
        'keys': 'ข้อควรระวัง ตรวจสอบ ประกาศฉบับจริง ไม่มีข้อมูล ถูกต้อง ห้ามมั่ว', 'doc': '2567', 'page': 1,
    },
]

META = {
    'title': 'เขตอำนาจการรับผิดชอบหรือเขตพื้นที่การปกครองของส่วนราชการ สำนักงานตำรวจแห่งชาติ',
    'sources': [
        {
            'code': '2567', 'label': 'ประกาศ ตร. ลงวันที่ 22 มีนาคม 2567',
            'gazette': 'ราชกิจจานุเบกษา เล่ม 141 ตอนพิเศษ 84 ง วันที่ 22 มีนาคม 2567',
            'pages': 427, 'url': 'https://ratchakitcha.soc.go.th/documents/17187.pdf',
            'text': 'docs/gazette/2567.txt',
        },
        {
            'code': '2568-2', 'label': 'ประกาศ ตร. ฉบับที่ 2 ลงวันที่ 22 ตุลาคม 2568',
            'gazette': 'ราชกิจจานุเบกษา เล่ม 142 ตอนพิเศษ 341 ง วันที่ 24 ตุลาคม 2568 หน้า 29–41',
            'pages': 13, 'url': 'https://ratchakitcha.soc.go.th/documents/91341.pdf',
            'text': 'docs/gazette/2568-2.txt',
        },
    ],
    'note': 'ถอดข้อความและจัดทำดัชนีจากบัญชีแนบท้ายประกาศหน้า 113–344 เพื่อช่วยค้นหา โปรดตรวจสอบกับไฟล์ PDF ต้นฉบับก่อนดำเนินการทางกฎหมาย',
    'generatedBy': 'tools/build-jurisdictions.py',
}


def main():
    stations = parse_stations(TEXT_2567)
    index = {}
    for i, rec in enumerate(stations):
        for t in rec['tambons']:
            k = norm(t['name'])
            if k:
                index.setdefault(k, []).append(i)
    coverage = {
        'stations': len(stations),
        'tambonEntries': sum(len(r['tambons']) for r in stations),
        'tambonNames': len(index),
        'provinces': len({r['province'] for r in stations}),
        'stationsNeedVerify': sum(1 for r in stations if r['verify']),
        'stationListPages': [113, 344],
        'allStations': len(STATIONS),
    }
    data = {'meta': META, 'coverage': coverage, 'summary': SUMMARY, 'stations': stations, 'index': index}
    out = ROOT / 'data' / 'jurisdictions.js'
    out.write_text('/* สร้างจากประกาศราชกิจจานุเบกษาโดย tools/build-jurisdictions.py — ห้ามแก้มือ */\n'
                   + 'window.JURISDICTION = '
                   + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n',
                   encoding='utf-8')
    print('เขียน', out, 'ขนาด', out.stat().st_size, 'ไบต์')
    print('ความครอบคลุม:', json.dumps(coverage, ensure_ascii=False))


if __name__ == '__main__':
    main()
