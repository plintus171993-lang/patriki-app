// Стартовое меню (перенесено с Menusa 29.10.2026, опечатки исправлены).
// Используется для первого заполнения базы и в демо-режиме без сервера.
// Фото хранятся в нашем хранилище Supabase (bucket menu), перенесены с CDN Menusa 13.11.2026.
const MEDIA = 'https://ozbdmczmpejyctezxrdk.supabase.co/storage/v1/object/public/menu/';
const IMG = (path) => MEDIA + path;

export const HERO_IMG = MEDIA + 'site/hero.avif';

export const SEED_CATEGORIES = [
  { id: 'smoker', name: 'Блюда в смокере', sort: 1 },
  { id: 'burgers', name: 'Бургеры и шаверма', sort: 2 },
  { id: 'salads', name: 'Салаты', sort: 3 },
  { id: 'cold', name: 'Холодные закуски', sort: 4 },
  { id: 'hot-snacks', name: 'Горячие закуски', sort: 5 },
  { id: 'soups', name: 'Супы', sort: 6 },
  { id: 'steak', name: 'Стейк дня', sort: 7 },
  { id: 'sausages', name: 'Колбаски', sort: 8 },
  { id: 'mains', name: 'Горячие блюда', sort: 9 },
  { id: 'dumplings', name: 'Пельмени ручной лепки', sort: 10 },
  { id: 'sets', name: 'Сеты и миксы', sort: 11 },
  { id: 'fish', name: 'Рыба', sort: 12 },
];

let n = 0;
const it = (category_id, name, price, weight = '', image_url = '', extra = {}) => ({
  id: `seed-${++n}`, category_id, name, price, weight, image_url,
  description: '', available: true, popular: false, sort: n, ...extra,
});

export const SEED_ITEMS = [
  it('smoker', 'Копчёные куриные крылья', 750, '', IMG('items/rehost/seed-1.avif'), { popular: true }),
  it('smoker', 'Скумбрия нашего копчения', 710, '', IMG('items/rehost/seed-2.avif')),
  it('smoker', 'Техасский брискет', 1790, '370 г', '', { popular: true }),
  it('smoker', 'Полкило шавермы с брискетом', 740, '500 г', IMG('items/rehost/seed-4.avif')),

  it('burgers', 'Классический бургер с говяжьей котлетой', 840, '500 г', IMG('items/hq-1030/seed-5.jpg')),
  it('burgers', 'Сырный Патрик с говяжьей и сырной котлетой', 850, '500 г', IMG('items/hq-1030/seed-6.jpg'), { popular: true }),
  it('burgers', 'Бургер с брискетом', 980, '500 г', IMG('items/hq-1030/seed-7.jpg'), { popular: true }),

  it('salads', 'Цезарь', 590, '260 г', IMG('items/hq-1030/seed-8.jpg')),
  it('salads', 'Тёплый с баклажаном и сыром', 630, '290 г', IMG('items/rehost/seed-9.avif')),
  it('salads', 'Тёплый салат с фланк-стейком', 670, '290 г', IMG('items/hq-1030/seed-10.jpg')),

  it('cold', 'Сало домашнее', 470),
  it('cold', 'Вяленая курица', 390, '50 г', IMG('items/rehost/seed-12.avif')),
  it('cold', 'Вяленая свинина', 390, '50 г', IMG('items/rehost/seed-13.avif')),
  it('cold', 'Вяленая говядина', 390, '50 г', IMG('items/rehost/seed-14.avif')),
  it('cold', 'Фисташки', 380, '100 г', IMG('items/rehost/seed-15.avif')),
  it('cold', 'Копчёный арахис', 350, '100 г', IMG('items/rehost/seed-16.avif')),
  it('cold', 'Уши свиные', 470),

  it('hot-snacks', 'Луковые кольца', 490, '', IMG('items/rehost/seed-18.avif')),
  it('hot-snacks', 'Кольца кальмара', 590, '', IMG('items/rehost/seed-19.avif')),
  it('hot-snacks', 'Гренки чесночные с пармезаном', 360, '', IMG('items/rehost/seed-20.avif')),
  it('hot-snacks', 'Сырные палочки моцарелла', 470, '', IMG('items/rehost/seed-21.avif')),
  it('hot-snacks', 'Креветки васаби', 650, '', IMG('items/rehost/seed-22.avif')),
  it('hot-snacks', 'Картофель фри с пармезаном', 390, '', IMG('items/rehost/seed-23.avif')),
  it('hot-snacks', 'Фиш энд чипс', 560, '', IMG('items/rehost/seed-24.avif')),
  it('hot-snacks', 'Варёные пивные креветки', 520, '', IMG('items/rehost/seed-25.avif')),
  it('hot-snacks', 'Сырные медальоны с халапеньо', 490, '', IMG('items/rehost/seed-26.avif')),
  it('hot-snacks', 'Хлебная корзина', 270),

  it('soups', 'Борщ с техасским брискетом', 540, '450 г', IMG('items/rehost/seed-28.avif')),
  it('soups', 'Солянка сборная мясная', 580, '420 г', IMG('items/rehost/seed-29.avif')),

  it('steak', 'Стейк дня', 980, '', IMG('items/rehost/seed-30.avif'), { description: 'Какой сегодня — уточним при звонке' }),

  it('sausages', 'Свиные с сыром', 690, '', IMG('items/rehost/seed-31.avif')),
  it('sausages', 'Куриные', 590, '', IMG('items/rehost/seed-32.avif')),
  it('sausages', 'Говяжьи', 690, '', IMG('items/rehost/seed-33.avif')),

  it('mains', 'Рёбра свиные с коул слоу', 760, '310 г', IMG('items/rehost/seed-34.avif')),
  it('mains', 'Ирландские драники с котлетой', 640, '420 г', IMG('items/rehost/seed-35.avif')),
  it('mains', 'Шницель австрийский', 670, '', IMG('items/rehost/seed-36.avif')),
  it('mains', 'Щёки телячьи с картофельным пюре и жареным луком', 790),

  it('dumplings', 'Со свининой', 540),
  it('dumplings', 'С говядиной и копчёным сыром', 560),
  it('dumplings', 'Баранина, свинина, говядина', 570),

  it('sets', 'Микс BBQ', 1860),
  it('sets', 'Пивной сырный микс', 590, '', IMG('items/rehost/seed-42.avif')),
  it('sets', 'Сыровяленый микс', 790),
  it('sets', 'Микс закусок к пиву', 1690, '', IMG('items/rehost/seed-44.avif')),
  it('sets', 'Микс колбас с коул слоу и соусом', 1740, '', IMG('items/rehost/seed-45.avif')),

  it('fish', 'Корюшка', 680, '240 г', IMG('items/rehost/seed-46.avif')),
  it('fish', 'Крылья ската', 740, '400 г', IMG('items/rehost/seed-47.avif')),
];

export const SEED_VENUES = [
  {
    id: 'petrogradka', name: 'Петроградка', address: 'ул. Куйбышева, 33/8',
    zone: 'Петроградская сторона', phone: '+7 963 302-75-95', hours: '12:00–01:00',
    delivery_fee: 0, min_order: 0, eta_minutes: 45, accepting: true, pay_online: false, sort: 1,
  },
  {
    id: 'murino', name: 'Мурино', address: 'Екатерининская ул., 16/5',
    zone: 'Мурино', phone: '+7 963 302-75-95', hours: '12:00–01:00',
    delivery_fee: 0, min_order: 0, eta_minutes: 45, accepting: false, pay_online: false, sort: 2,
  },
];
