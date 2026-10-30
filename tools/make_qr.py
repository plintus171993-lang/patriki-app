"""QR-код и табличка для печати: python3 tools/make_qr.py https://ДОМЕН/get/ [--draft]
Делает qr.svg (векторный, для типографии), qr.png и poster.html → poster-a5.pdf/png."""
import sys, pathlib, cv2, numpy as np

url = sys.argv[1]
draft = '--draft' in sys.argv
out = pathlib.Path(__file__).resolve().parent.parent / 'print'
out.mkdir(exist_ok=True)

p = cv2.QRCodeEncoder.Params(); p.correction_level = cv2.QRCODE_ENCODER_CORRECT_LEVEL_H  # H: читается даже с логотипом в центре
qr = cv2.QRCodeEncoder.create(p).encode(url)            # матрица 0/255 с белым полем
m = (qr < 128).astype(np.uint8)
ys, xs = np.where(m); m = m[ys.min():ys.max()+1, xs.min():xs.max()+1]   # обрезаем поле
n = m.shape[0]

# проверка: QR действительно читается и ведёт куда нужно
big = cv2.resize(((1 - m) * 255).astype(np.uint8), (n * 12, n * 12), interpolation=cv2.INTER_NEAREST)
big = cv2.copyMakeBorder(big, 60, 60, 60, 60, cv2.BORDER_CONSTANT, value=255)
decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(big)
assert decoded == url, f'QR не читается: {decoded!r}'

# SVG: квадратные модули, в центре — место под логотип
hole = max(5, n // 4) | 1; h0 = (n - hole) // 2
rects = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1"/>' for y in range(n) for x in range(n)
                if m[y, x] and not (h0 - 1 <= x <= h0 + hole and h0 - 1 <= y <= h0 + hole))
q = 4
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-q} {-q} {n+2*q} {n+2*q}" shape-rendering="crispEdges">'
       f'<rect x="{-q}" y="{-q}" width="{n+2*q}" height="{n+2*q}" fill="#F2EFE8"/><g fill="#0E0E0D">{rects}</g>'
       f'<rect x="{h0}" y="{h0}" width="{hole}" height="{hole}" rx="1.2" fill="#0E0E0D"/>'
       f'<image href="data:image/png;base64,{__import__("base64").b64encode((out.parent / "www/icons/icon-512.png").read_bytes()).decode()}" x="{h0+0.4}" y="{h0+0.4}" width="{hole-0.8}" height="{hole-0.8}"/></svg>')
(out / 'qr.svg').write_text(svg)
print('OK', n, 'модулей, проверка чтения пройдена:', decoded)

# ---------- табличка A5 для печати ----------
from playwright.sync_api import sync_playwright
logo = (out.parent / 'www/js/logo.js').read_text()
poster = f'''<!doctype html><html lang="ru"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
@page {{ size: 148mm 210mm; margin: 0; }}
html,body {{ margin:0; background:#0E0E0D; }}
.p {{ width:148mm; height:210mm; box-sizing:border-box; padding:14mm 12mm; background:#0E0E0D; color:#F2EFE8;
     font-family:'IBM Plex Sans',Arial,sans-serif; display:flex; flex-direction:column; align-items:center; text-align:center; position:relative; overflow:hidden; }}
.eyebrow {{ font-family:Oswald,'Arial Narrow',sans-serif; letter-spacing:3px; font-size:11pt; color:#D4A84B; }}
h1 {{ font-family:Oswald,'Arial Narrow',sans-serif; font-weight:700; font-size:34pt; line-height:1; margin:4mm 0 3mm; letter-spacing:1px; }}
.sub {{ font-size:11.5pt; color:#C9C5BC; line-height:1.45; margin:0 0 7mm; }}
.qr {{ width:78mm; height:78mm; border-radius:4mm; overflow:hidden; border:1.2mm solid #D4A84B; }}
.qr img {{ width:100%; height:100%; display:block; }}
.cta {{ font-family:Oswald,sans-serif; font-size:15pt; letter-spacing:2px; margin:6mm 0 2mm; }}
.small {{ font-size:9.5pt; color:#A19D93; line-height:1.5; }}
.foot {{ margin-top:auto; display:flex; align-items:center; gap:4mm; font-family:Oswald,sans-serif; letter-spacing:2px; font-size:12pt; }}
.draft {{ position:absolute; top:150mm; left:-20mm; right:-20mm; transform:rotate(-24deg); background:rgba(229,115,95,.85); color:#fff;
         font-family:Oswald,sans-serif; font-size:22pt; letter-spacing:4px; padding:3mm 0; }}
</style></head><body><div class="p">
<span class="eyebrow">ПАТРИКИ ПАБ · САНКТ-ПЕТЕРБУРГ</span>
<h1>ДОСТАВКА<br>ИЗ ПАБА</h1>
<p class="sub">Мясо из смокера, бургеры и закуски — домой<br>Петроградская сторона и Мурино · 12:00–01:00</p>
<div class="qr"><img src="qr.svg"></div>
<div class="cta">НАВЕДИТЕ КАМЕРУ</div>
<div class="small">iPhone и Android · заказ в пару касаний<br>оплата онлайн или курьеру</div>
<div class="foot"><img src="../www/icons/icon-192.png" width="40" height="40" style="border-radius:8px">ПАТРИКИ ПАБ</div>
{'<div class="draft">ОБРАЗЕЦ · QR ВРЕМЕННЫЙ</div>' if draft else ''}
</div></body></html>'''
(out / 'poster.html').write_text(poster)
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(device_scale_factor=3, viewport={'width': 560, 'height': 794})
    pg.goto((out / 'poster.html').as_uri()); pg.wait_for_timeout(800)
    pg.screenshot(path=str(out / 'poster-a5.png'), full_page=True)
    pg.pdf(path=str(out / 'poster-a5.pdf'), width='148mm', height='210mm', print_background=True)
    (out / 'qr-view.html').write_text(f'<body style="margin:0;background:#fff"><img src="qr.svg" style="width:1000px;height:1000px"></body>')
    pg2 = b.new_page(viewport={'width': 1000, 'height': 1000}); pg2.goto((out / 'qr-view.html').as_uri())
    _unused = (f'<body style="margin:0;background:#fff"><img src="{(out/"qr.svg").as_uri()}" style="width:1000px;height:1000px"></body>')
    pg2.wait_for_timeout(300); pg2.screenshot(path=str(out / 'qr.png'))
    b.close()
for f in ['qr.png', 'poster-a5.png']:
    img = cv2.imread(str(out / f)); d, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    assert d == url, f'{f}: QR с логотипом не читается ({d!r})'
    print(f, '— QR с логотипом читается:', d)
