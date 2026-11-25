"""Locate the collector number and edition code on one actual scan per edition."""
import csv
import io
import json
import re
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image, ImageOps

def inspect(group):
    sid, edition, total, code, cards = group
    cid, name, number, url = next((c for c in cards if c[3]), cards[0])
    prefix = re.match(r'^(TG|GG|RC|SV)\d+$', number)
    if prefix and all(c[2].startswith(prefix[1]) for c in cards):
        total = prefix[1] + str(total)
    result = [sid, edition, cid, name, number, total, code, url]
    try:
        series = re.match(r'[a-z]+',sid).group()
        sources = [f'https://images.scrydex.com/pokemon/{cid}/large', url,
                   f'https://assets.tcgdex.net/en/{series}/{sid}/{number}/high.webp']
        for source in dict.fromkeys(sources):
            try:
                request = urllib.request.Request(source, headers={'User-Agent':'Cardfolio/1.0', 'Accept':'image/*'})
                with urllib.request.urlopen(request, timeout=8) as response:
                    image = Image.open(io.BytesIO(response.read())).convert('L')
                result[7] = source
                break
            except Exception as error:
                last_error = error
        else:
            raise last_error
        w, h = image.size
        band = ImageOps.autocontrast(image.crop((0, int(.76*h), w, h)))
        band = band.resize((1400, max(1, round(band.height*1400/w))))
        data = io.BytesIO()
        band.save(data, format='PNG')
        text = subprocess.run(['tesseract','stdin','stdout','--psm','11'],input=data.getvalue(),
                              capture_output=True,check=True,timeout=12).stdout.decode().upper()
        compact = re.sub(r'\s+', '', text)
        pair = bool(re.search(r'(?<!\d)0*'+re.escape(str(number).upper())+r'/0*'+re.escape(str(total))+r'(?!\d)',compact))
        printed = bool(code and code.upper() in re.findall(r'[A-Z0-9]+',text))
        return result + [int(pair), int(printed), 'leída' if pair or printed else 'revisar imagen']
    except Exception as error:
        return result + ['', '', str(error)[:150]]

if __name__ == '__main__':
    folder = Path('data/90f27d0')
    groups = [s for file in json.loads((folder/'index.json').read_text()) for s in json.loads((folder/file).read_text())]
    with open('ediciones.csv','w',newline='',encoding='utf-8') as out, ThreadPoolExecutor(5) as pool:
        writer = csv.writer(out)
        writer.writerow(['set','edición','id','carta','número','total impreso','código catálogo','foto','número/total visible','código visible','revisión OCR'])
        rows = list(pool.map(inspect,groups))
        writer.writerows(rows)
    profiles = {row[0]: {'pair': row[8] == 1, 'code': row[9] == 1} for row in rows}
    Path('public/edition-profiles.json').write_text(json.dumps(profiles))
    print('Edition audit:', len(rows), 'samples;', sum(r[8] == 1 for r in rows), 'pairs;', sum(r[9] == 1 for r in rows), 'codes;', sum(r[8] == '' for r in rows), 'unavailable')
    from collections import Counter
    print('Sample status:', Counter(row[-1] for row in rows).most_common(8))
