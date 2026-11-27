<?php
// Ночная резервная копия базы приложения «Патрики» на хостинг Reg.ru.
// Крон хостинга раз в сутки:  php /путь/db-backup.php
// Пишет ~/patriki-backup/patriki-ГГГГ-ММ-ДД.json.gz (все таблицы + список гостей), хранит последние 14 копий.
// Ключ доступа хранится только здесь, в ~/patriki-backup/.key (создаётся при первом запуске
// и один раз регистрируется в базе через rpc backup_register).

$API  = 'https://ozbdmczmpejyctezxrdk.supabase.co';
$HOME = getenv('HOME') ?: dirname(__DIR__);
$DIR  = "$HOME/patriki-backup";
$KEEP = 14;

if (!is_dir($DIR)) mkdir($DIR, 0700, true);
@chmod($DIR, 0700);

function http($url, $body = null, $headers = []) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 120,
                          CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'patriki-backup']);
  if ($body !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $body); }
  $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE); $err = curl_error($ch); curl_close($ch);
  if ($r === false) throw new Exception("$url: $err");
  return [$code, $r];
}

try {
  // публичный ключ приложения — берём из сайта, чтобы не хранить его здесь
  [, $cfg] = http('https://patrikipab.ru/js/config.js?t=' . time());
  if (!preg_match("/SUPABASE_ANON_KEY:\\s*'([^']+)'/", $cfg, $m)) throw new Exception('не нашёл ключ приложения в config.js');
  $anon = $m[1];
  $h = ["apikey: $anon", "Authorization: Bearer $anon", 'Content-Type: application/json'];
  $rpc = function ($fn, $args) use ($API, $h) {
    [$code, $r] = http("$API/rest/v1/rpc/$fn", json_encode($args), $h);
    if ($code !== 200) throw new Exception("$fn: HTTP $code " . substr($r, 0, 300));
    return $r;
  };

  // ключ резервной копии: создаём один раз и регистрируем в базе
  $keyFile = "$DIR/.key";
  if (!is_file($keyFile)) {
    file_put_contents($keyFile, bin2hex(random_bytes(32)));
    chmod($keyFile, 0600);
  }
  $key = trim(file_get_contents($keyFile));
  if (json_decode($rpc('backup_register', ['p_key' => $key])) !== true) throw new Exception('ключ не принят базой');

  $tables = json_decode($rpc('backup_tables', ['p_key' => $key]), true);
  if (!is_array($tables) || !$tables) throw new Exception('пустой список таблиц');

  $file = "$DIR/patriki-" . date('Y-m-d') . '.json.gz';
  $tmp = "$file.part";
  $gz = gzopen($tmp, 'wb6');
  gzwrite($gz, '{"created_at":' . json_encode(date('c')) . ',"tables":{');
  $rows = 0;
  foreach ($tables as $i => $t) {
    $data = $rpc('backup_table', ['p_key' => $key, 'p_name' => $t]);
    $rows += count(json_decode($data, true) ?: []);
    gzwrite($gz, ($i ? ',' : '') . json_encode($t) . ':' . $data);
  }
  gzwrite($gz, '}}');
  gzclose($gz);
  rename($tmp, $file);
  chmod($file, 0600);

  // храним последние $KEEP копий
  $all = glob("$DIR/patriki-*.json.gz"); sort($all);
  foreach (array_slice($all, 0, max(0, count($all) - $KEEP)) as $old) unlink($old);

  echo date('c') . ' копия готова: ' . basename($file) . ', таблиц ' . count($tables) . ", строк $rows, " . round(filesize($file) / 1024) . " КБ\n";
} catch (Throwable $e) {
  if (!empty($tmp) && is_file($tmp)) @unlink($tmp);
  fwrite(STDERR, date('c') . ' ОШИБКА резервной копии: ' . $e->getMessage() . "\n");
  exit(1);
}
