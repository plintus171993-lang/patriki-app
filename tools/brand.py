"""Логотип из EPS (Adobe Illustrator) → SVG-файлы, иконки приложения и заставка.
Запуск: python3 tools/brand.py  (исходные SVG лежат в brand/, получены tools/eps2svg.py)"""
import re, pathlib
from playwright.sync_api import sync_playwright
R = pathlib.Path(__file__).resolve().parent.parent
src = (R / 'brand/logo-white-source.svg').read_text()
paths = re.findall(r'<path d="([^"]+)" fill="[^"]+" fill-rule="(\w+)"/>', src)

def bbox(d):
    n = [float(x) for x in re.findall(r'-?[\d.]+', d)]
    return min(n[0::2]), min(n[1::2]), max(n[0::2]), max(n[1::2])

def svg(sel, vb, color, extra=''):
    body = ''.join(f'<path d="{d}" fill-rule="{r}"/>' for d, r in sel)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" fill="{color}"{extra}>{body}</svg>')

# вся эмблема: кольцо и бульдог с венком лежат внутри круга 835..1086 × 264..516
EM = (829, 258, 263, 263)
emblem = [(d, r) for d, r in paths if (lambda b: b[0] >= 830 and b[1] >= 259 and b[2] <= 1091 and b[3] <= 521)(bbox(d))]
FULL = (500, 200, 920, 625)
vb = lambda b: ' '.join(f'{v:g}' for v in b)
out = {
    'www/img/emblem.svg': svg(emblem, vb(EM), '#fff'),
    'www/img/logo-full.svg': svg(paths, vb(FULL), '#fff'),
    'brand/emblem-black.svg': svg(emblem, vb(EM), '#0E0E0D'),
    'brand/logo-full-black.svg': svg(paths, vb(FULL), '#0E0E0D'),
}
for k, v in out.items(): (R / k).write_text(v)

# иконка: тёмный квадрат, белая эмблема
def icon(scale, rounded=True):
    s = 512; e = s * scale; o = (s - e) / 2
    inner = svg(emblem, vb(EM), '#fff', f' x="{o:g}" y="{o:g}" width="{e:g}" height="{e:g}"')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" {"rx=\"112\"" if rounded else ""} fill="#0E0E0D"/>{inner}</svg>')
(R / 'www/icons/icon.svg').write_text(icon(0.80))
print('emblem paths:', len(emblem), 'all:', len(paths))

with sync_playwright() as p:
    b = p.chromium.launch()
    def shot(html, path, w, h, transparent=False):
        pg = b.new_page(viewport={'width': w, 'height': h})
        pg.set_content(f"<html><body style='margin:0;{'background:transparent' if transparent else ''}'>{html}</body></html>")
        pg.wait_for_timeout(200)
        pg.screenshot(path=str(R / path), clip={'x': 0, 'y': 0, 'width': w, 'height': h}, omit_background=transparent)
        pg.close()
    sized = lambda s, n: s.replace('width="512" height="512"', f'width="{n}" height="{n}"', 1)
    for name, n, sc in [('icon-180.png', 180, .80), ('icon-192.png', 192, .80), ('icon-512.png', 512, .80), ('icon-1024.png', 1024, .80), ('icon-maskable-512.png', 512, .62)]:
        shot(sized(icon(sc, rounded=False), n), f'www/icons/{name}', n, n)
    shot(sized(icon(.80, rounded=False), 1024), 'assets/icon-only.png', 1024, 1024)
    fg = svg(emblem, vb(EM), '#fff', ' width="1024" height="1024"')
    shot(f"<div style='width:1024px;height:1024px;display:grid;place-items:center'><div style='width:600px;height:600px'>{fg.replace(' width=\"1024\" height=\"1024\"', ' width=\"600\" height=\"600\"')}</div></div>", 'assets/icon-foreground.png', 1024, 1024, True)
    shot("<div style='width:1024px;height:1024px;background:#0E0E0D'></div>", 'assets/icon-background.png', 1024, 1024)
    logo = out['www/img/logo-full.svg'].replace('<svg ', '<svg width="1100" ', 1)
    splash = f"<div style='width:2732px;height:2732px;background:#0E0E0D;display:grid;place-items:center'>{logo}</div>"
    shot(splash, 'assets/splash.png', 2732, 2732); shot(splash, 'assets/splash-dark.png', 2732, 2732)
    b.close()
