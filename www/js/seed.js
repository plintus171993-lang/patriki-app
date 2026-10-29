// Стартовое меню (перенесено с Menusa 29.10.2026, опечатки исправлены).
// Используется для первого заполнения базы и в демо-режиме без сервера.
const IMG = (id, ext = 'jpg') => `https://media.dodostatic.com/image/r:520x520/${id}.${ext}`;

export const HERO_IMG = 'https://media.dodostatic.com/image/r:840x630/019a2b3729aa7935ae73209d8d3c2a37.avif';

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
  it('smoker', 'Копчёные куриные крылья', 750, '', IMG('019a2a94ce4775b4b1e7d4a930f434f9', 'avif'), { popular: true }),
  it('smoker', 'Скумбрия нашего копчения', 710, '', IMG('019a835cd00a76bfb9a4adbd621929a4', 'avif')),
  it('smoker', 'Техасский брискет', 1790, '370 г', '', { popular: true }),
  it('smoker', 'Полкило шавермы с брискетом', 740, '500 г', IMG('019d5407c0e0715088234cf452ff82df', 'avif')),

  it('burgers', 'Классический бургер с говяжьей котлетой', 840, '500 г', IMG('019a11916f3c72b2a39ee5a0114b9696', 'avif')),
  it('burgers', 'Сырный Патрик с говяжьей и сырной котлетой', 850, '500 г', IMG('019a1192698f75adb86b979db200d337', 'avif'), { popular: true }),
  it('burgers', 'Бургер с брискетом', 980, '500 г', IMG('019a1195086375fb888db19226fa9bff', 'avif'), { popular: true }),

  it('salads', 'Цезарь', 590, '260 г', IMG('019a119731fd77fab916d82287a8caf9')),
  it('salads', 'Тёплый с баклажаном и сыром', 630, '290 г', IMG('019a1197af897257918959bf98fd0383')),
  it('salads', 'Тёплый салат с фланк-стейком', 670, '290 г', IMG('019a11982eac738cb91e0f62b96d7958')),

  it('cold', 'Сало домашнее', 470),
  it('cold', 'Вяленая курица', 390, '50 г', IMG('019a2aae0d2e72a5b4364dee731f3e7d')),
  it('cold', 'Вяленая свинина', 390, '50 г', IMG('019a2aae76647556ae490181e875e1f3')),
  it('cold', 'Вяленая говядина', 390, '50 г', IMG('019a2aaeb22f79329363785ed010c6fe')),
  it('cold', 'Фисташки', 380, '100 г', IMG('019a2b2f4dbd7203b2abb45d05c801ef')),
  it('cold', 'Копчёный арахис', 350, '100 г', IMG('019a2b2f856270b0a6641bb169fc90a2')),
  it('cold', 'Уши свиные', 470),

  it('hot-snacks', 'Луковые кольца', 490, '', IMG('019a2a899cd4745c8e2cdd8b7e8ccac6')),
  it('hot-snacks', 'Кольца кальмара', 590, '', IMG('019a2a8a0adb75a19968148f81b2703b')),
  it('hot-snacks', 'Гренки чесночные с пармезаном', 360, '', IMG('019a2a8b905d723e996c853cfe4cb4db')),
  it('hot-snacks', 'Сырные палочки моцарелла', 470, '', IMG('019a2b35d257789a93b90dc3fb59b10b')),
  it('hot-snacks', 'Креветки васаби', 650, '', IMG('019a2a8cf45870abb42b6d392901e5d7')),
  it('hot-snacks', 'Картофель фри с пармезаном', 390, '', IMG('019a2a8defb3774f8b762efcc27c421b')),
  it('hot-snacks', 'Фиш энд чипс', 560, '', IMG('019a2a8e9fbe701c8d619c0c2ba48d17')),
  it('hot-snacks', 'Варёные пивные креветки', 520, '', IMG('019a2a8f6ada753e8887889263553b58')),
  it('hot-snacks', 'Сырные медальоны с халапеньо', 490, '', IMG('019a2b36944375edbf759475e668243b')),
  it('hot-snacks', 'Хлебная корзина', 270),

  it('soups', 'Борщ с техасским брискетом', 540, '450 г', IMG('019a1198ed6878d88242c0cc9e107b81')),
  it('soups', 'Солянка сборная мясная', 580, '420 г', IMG('019a1199853b74c996e4b815c224ef46')),

  it('steak', 'Стейк дня', 980, '', IMG('019a2a95f3af7024b2434fa43c7924fe'), { description: 'Какой сегодня — уточним при звонке' }),

  it('sausages', 'Свиные с сыром', 690, '', IMG('019a2a87a0ae733ba9805427c5711eb4')),
  it('sausages', 'Куриные', 590, '', IMG('019a2a880bca774e9e614e34d12c3f67')),
  it('sausages', 'Говяжьи', 690, '', IMG('019a2a887812797b91206944ba4542e2')),

  it('mains', 'Рёбра свиные с коул слоу', 760, '310 г', IMG('019a119e5717771c9a73e63f771045b7')),
  it('mains', 'Ирландские драники с котлетой', 640, '420 г', IMG('019a11a0d25a7258a426b61a7eb0552d')),
  it('mains', 'Шницель австрийский', 670, '', IMG('019a2a9266b377baac9de4de0d23f262')),
  it('mains', 'Щёки телячьи с картофельным пюре и жареным луком', 790),

  it('dumplings', 'Со свининой', 540),
  it('dumplings', 'С говядиной и копчёным сыром', 560),
  it('dumplings', 'Баранина, свинина, говядина', 570),

  it('sets', 'Микс BBQ', 1860),
  it('sets', 'Пивной сырный микс', 590, '', IMG('019d53fe777f772083d825f05845a88c')),
  it('sets', 'Сыровяленый микс', 790),
  it('sets', 'Микс закусок к пиву', 1690, '', IMG('019d53cab0f573a094a94d6eb185c91b')),
  it('sets', 'Микс колбас с коул слоу и соусом', 1740, '', IMG('019d53cc53cf768a8dfcbcc4e62b6c90')),

  it('fish', 'Корюшка', 680, '240 г', IMG('019e0796cb7172a484d80ac78bad003d')),
  it('fish', 'Крылья ската', 740, '400 г', IMG('019e079794fc73118520aac460b7d6fa')),
];

export const SEED_VENUES = [
  {
    id: 'petrogradka', name: 'Петроградка', address: 'ул. Куйбышева, 33/8',
    zone: 'Петроградская сторона', phone: '+7 963 302-75-95', hours: '12:00–01:00',
    delivery_fee: 0, min_order: 0, eta_minutes: 45, accepting: true, sort: 1,
  },
  {
    id: 'murino', name: 'Мурино', address: 'Екатерининская ул., 16/5',
    zone: 'Мурино', phone: '+7 963 302-75-95', hours: '12:00–01:00',
    delivery_fee: 0, min_order: 0, eta_minutes: 45, accepting: false, sort: 2,
  },
];
