// Настройки подключения к серверу.
// Пока поля пустые, приложение работает в ДЕМО-режиме: меню и заказы
// хранятся только в этом браузере, вход в админку — пароль DEMO_ADMIN_PASSWORD.
// После создания проекта Supabase впишите сюда Project URL и anon public key.
export const CONFIG = {
  SUPABASE_URL: 'https://ozbdmczmpejyctezxrdk.supabase.co',
  // Публичный (publishable) ключ — его можно хранить в приложении, права ограничены правилами базы
  SUPABASE_ANON_KEY: 'sb_publishable_PhI0d9qM0Hp7KrERGKHQfg_668fWJMv',

  DEMO_ADMIN_PASSWORD: 'patriki',

  // Сколько касаний подряд по слову «Патрики» на экране «Информация» открывают вход для управляющего
  ADMIN_TAPS: 5,

  APP_VERSION: '1.2.0',

  // Пока SMS-сервис не подключён: код не уходит гостю по SMS, его видно в админке
  // и в Telegram-чате заведения. После подключения SMS поставить false.
  SMS_TEST_MODE: true,
};

// ?demo в адресе — принудительный демо-режим (для проверки без сервера)
export const isDemo = () => !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY || new URLSearchParams(location.search).has('demo');
