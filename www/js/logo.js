// Логотип-набросок (бульдог). Заменить на оригинальный вектор, когда он будет.
// Координаты морды — в системе 200×200, смещены на (20,20) внутри круга 240×240.
const P = {
  ears: 'M66 62 Q54 44 40 52 Q38 68 56 78 M134 62 Q146 44 160 52 Q162 68 144 78',
  head: 'M64 66 Q66 46 100 46 Q134 46 136 66 Q152 74 156 98 Q160 128 140 146 Q120 162 100 162 Q80 162 60 146 Q40 128 44 98 Q48 74 64 66 Z',
  brows: 'M80 64 Q100 56 120 64 M86 72 Q100 67 114 72',
  lids: 'M67 87 Q78 80 89 87 M111 87 Q122 80 133 87',
  nose: 'M85 104 Q100 97 115 104 Q113 115 100 116 Q87 115 85 104 Z',
  jowls: 'M100 116 V123 M100 123 Q84 123 74 135 Q70 141 72 147 M100 123 Q116 123 126 135 Q130 141 128 147',
  jaw: 'M80 141 Q100 153 120 141',
  fangs: 'M86 142 L88 134 L91 144 M109 144 L112 134 L114 142',
};

const markBody = (sw) => `
<path d="${P.ears}" stroke-width="${sw}"/>
<path d="${P.head}" stroke-width="${sw}"/>
<circle cx="78" cy="93" r="5.5" fill="currentColor" stroke="none"/><circle cx="122" cy="93" r="5.5" fill="currentColor" stroke="none"/>
<path d="${P.lids}" stroke-width="${sw * 0.8}"/>
<path d="${P.nose}" fill="currentColor" stroke="none"/>
<path d="${P.jowls}" stroke-width="${sw * 0.85}"/>
<path d="${P.jaw} ${P.fangs}" stroke-width="${sw * 0.8}"/>`;

// Компактный знак (шапка, иконка)
export const logoMark = (size = 44, label = 'Патрики Паб') => `
<svg role="img" aria-label="${label}" width="${size}" height="${size}" viewBox="0 0 240 240" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
<circle cx="120" cy="120" r="112" stroke-width="10"/>
<g transform="translate(20,18)">${markBody(8)}</g>
</svg>`;

export const iconSvg = (size = 512) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0E0E0D"/>
<g transform="translate(96,96) scale(1.3333)" fill="none" stroke="#F2EFE8" color="#F2EFE8" stroke-linecap="round" stroke-linejoin="round">
<circle cx="120" cy="120" r="112" stroke-width="9"/>
<g transform="translate(20,18)">${markBody(7.5)}</g>
</g>
</svg>`;

// Полная эмблема с надписью по кругу и гравюрной штриховкой
export const logoEmblem = (size = 220) => `
<svg role="img" aria-label="Эмблема Патрики Паб" width="${size}" height="${size}" viewBox="0 0 240 240" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
<defs>
<pattern id="pk-hatch" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3.2" stroke="currentColor" stroke-width="0.9"/></pattern>
<path id="pk-arc-top" d="M36 120 A84 84 0 0 1 204 120"/>
<path id="pk-arc-bot" d="M26 120 A94 94 0 0 0 214 120"/>
</defs>
<circle cx="120" cy="120" r="114" stroke-width="3"/>
<circle cx="120" cy="120" r="106" stroke-width="1"/>
<circle cx="120" cy="120" r="74" stroke-width="1.5"/>
<text font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="700" font-size="19" letter-spacing="5" fill="currentColor" stroke="none"><textPath href="#pk-arc-top" startOffset="50%" text-anchor="middle">ПАТРИКИ ПАБ</textPath></text>
<text font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="500" font-size="11" letter-spacing="3" fill="currentColor" stroke="none"><textPath href="#pk-arc-bot" startOffset="50%" text-anchor="middle">САНКТ-ПЕТЕРБУРГ</textPath></text>
<g stroke-width="1.6">
<path d="M23 113 h12 v14 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 z"/><path d="M35 116 h3 a2 2 0 0 1 2 2 v4 a2 2 0 0 1 -2 2 h-3"/><path d="M22 113 q3 -4 7 -1 q3 -3 7 1"/>
<path d="M205 113 h12 v14 a2 2 0 0 1 -2 2 h-8 a2 2 0 0 1 -2 -2 z"/><path d="M205 116 h-3 a2 2 0 0 0 -2 2 v4 a2 2 0 0 0 2 2 h3"/><path d="M204 113 q3 -4 7 -1 q3 -3 7 1"/>
</g>
<g transform="translate(20,16)">
<path d="${P.ears}" fill="var(--bg, #0E0E0D)" stroke-width="3"/>
<path d="${P.head}" fill="url(#pk-hatch)" stroke-width="3"/>
<path d="${P.brows}" stroke-width="2"/>
<circle cx="78" cy="93" r="7.5" fill="var(--bg, #0E0E0D)" stroke-width="2.5"/><circle cx="122" cy="93" r="7.5" fill="var(--bg, #0E0E0D)" stroke-width="2.5"/>
<circle cx="78" cy="94.5" r="3.2" fill="currentColor" stroke="none"/><circle cx="122" cy="94.5" r="3.2" fill="currentColor" stroke="none"/>
<path d="${P.lids}" stroke-width="2.5"/>
<path d="M70 102 Q100 92 130 102 Q138 134 100 140 Q62 134 70 102 Z" fill="var(--bg, #0E0E0D)" stroke-width="2"/>
<path d="${P.nose}" fill="currentColor" stroke="none"/>
<path d="${P.jowls}" stroke-width="2.5"/>
<path d="${P.jaw}" fill="var(--bg, #0E0E0D)" stroke-width="2.5"/>
<path d="${P.fangs}" stroke-width="2"/>
</g>
</svg>`;
