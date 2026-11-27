// Фирменный логотип «Патрики Паб» (из EPS дизайнера → www/img/*.svg, см. tools/brand.py).
// emblem.svg — круглая эмблема с бульдогом, logo-full.svg — полный логотип с надписью. Оба белые.

const EMBLEM = 'img/emblem.svg';
const FULL = 'img/logo-full.svg';

// Анимация загрузки: эмблема подпрыгивает и покачивает головой, вокруг бежит золотое кольцо.
// Стили — css/app.css (.pk-loader …). Та же разметка вставлена в index.html, чтобы появлялась мгновенно.
export const bulldogLoader = (text = 'Будим бульдога…') => `
<div class="pk-loader" role="status" aria-live="polite">
  <div class="pk-stage" aria-hidden="true">
    <svg class="pk-ring" viewBox="0 0 160 160"><circle cx="80" cy="80" r="76"/></svg>
    <img class="pk-dog" src="${EMBLEM}" width="120" height="120" alt="">
  </div>
  <span class="pk-shadow" aria-hidden="true"></span>
  <span class="pk-load-text">${text}</span>
</div>`;

// Круглая эмблема (шапка, экраны входа)
export const logoMark = (size = 44, label = 'Патрики Паб') =>
  `<img class="logo-mark" src="${EMBLEM}" width="${size}" height="${size}" alt="${label}">`;

// Полный логотип с надписью (экран «Информация»)
export const logoEmblem = (size = 220) =>
  `<img class="logo-full" src="${FULL}" width="${Math.round(size * 1.4)}" height="${Math.round(size * 1.4 * 625 / 920)}" alt="Патрики Паб · Санкт-Петербург · 2025">`;
