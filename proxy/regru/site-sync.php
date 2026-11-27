<?php
// Зеркало сайта приложения на хостинге Reg.ru.
// Запускается кроном хостинга каждые 5 минут:  php /путь/site-sync.php /путь/к/папке/сайта
// Сверяет номер сборки в ветке site-dist (GitHub) с тем, что уже лежит на хостинге,
// и если вышла новая — скачивает архив, проверяет и подменяет папку сайта целиком.
// Ничего не делает, если сборка та же. Папку .well-known (сертификаты Let's Encrypt) переносит в новую версию.

$REPO   = 'plintus171993-lang/patriki-app';
$BRANCH = 'site-dist';
$target = rtrim($argv[1] ?? '', '/');
if ($target === '' || !is_dir(dirname($target))) { fwrite(STDERR, "usage: php site-sync.php /path/to/site\n"); exit(2); }
$name = basename($target);
// временные файлы — вне папки сайта (в домашней папке), чтобы их не было видно из интернета
$base = (getenv('HOME') ?: dirname(dirname($target))) . '/.site-sync';
if (!is_dir($base)) mkdir($base, 0700, true);

$lock = fopen("$base/.$name.sync.lock", 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) exit(0);   // предыдущий запуск ещё идёт

function get($url, $file = null) {
  $ch = curl_init($url);
  $opts = [CURLOPT_FOLLOWLOCATION => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 180,
           CURLOPT_USERAGENT => 'patriki-site-sync', CURLOPT_FAILONERROR => true];
  if ($file) { $fh = fopen($file, 'w'); $opts[CURLOPT_FILE] = $fh; } else { $opts[CURLOPT_RETURNTRANSFER] = true; }
  curl_setopt_array($ch, $opts);
  $r = curl_exec($ch); $err = curl_error($ch); curl_close($ch);
  if (!empty($fh)) fclose($fh);
  if ($r === false) throw new Exception("$url: $err");
  return $r;
}
function rrmdir($d) {
  if (!is_dir($d) || is_link($d)) { @unlink($d); return; }
  foreach (scandir($d) as $f) if ($f !== '.' && $f !== '..') rrmdir("$d/$f");
  @rmdir($d);
}
function build_of($json) { $j = json_decode($json, true); return is_array($j) && isset($j['build']) ? (int)$j['build'] : 0; }

try {
  $remote = build_of(get("https://raw.githubusercontent.com/$REPO/$BRANCH/update/latest.json?t=" . time()));
  if ($remote <= 0) throw new Exception('в ветке нет номера сборки');
  $local = is_file("$target/update/latest.json") ? build_of(file_get_contents("$target/update/latest.json")) : 0;
  if ($remote === $local) exit(0);

  $zip = "$base/.$name-$remote.zip";
  $new = "$base/.$name-new";
  $old = "$base/.$name-old";
  rrmdir($new); rrmdir($old);
  get("https://codeload.github.com/$REPO/zip/refs/heads/$BRANCH", $zip);

  $z = new ZipArchive();
  if ($z->open($zip) !== true) throw new Exception('архив не открывается');
  $tmp = "$base/.$name-unzip"; rrmdir($tmp);
  if (!$z->extractTo($tmp)) throw new Exception('архив не распаковался');
  $z->close(); @unlink($zip);
  $dirs = glob("$tmp/*", GLOB_ONLYDIR);
  if (count($dirs) !== 1) throw new Exception('неожиданная структура архива');
  rename($dirs[0], $new); rrmdir($tmp);

  // проверка: главная страница на месте и номер сборки совпадает
  if (!is_file("$new/index.html") || !is_file("$new/js/app.js")) throw new Exception('в архиве нет index.html / app.js');
  if (build_of(@file_get_contents("$new/update/latest.json")) !== $remote) throw new Exception('номер сборки в архиве другой');

  file_put_contents("$new/.htaccess", <<<'HT'
Options -Indexes
DirectoryIndex index.html
# свои правила (пусто) — чтобы правила пересылки из папки выше сюда не действовали
RewriteEngine On
AddType application/manifest+json .webmanifest
AddType application/vnd.android.package-archive .apk
<IfModule mod_headers.c>
  <FilesMatch "\.(html|json|webmanifest)$|^sw\.js$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  Header always set X-Content-Type-Options "nosniff"
</IfModule>
HT);
  if (is_dir("$target/.well-known")) rename("$target/.well-known", "$new/.well-known");

  // подмена: старая папка → .old, новая → на место (доли секунды)
  if (is_dir($target)) rename($target, $old);
  rename($new, $target);
  rrmdir($old);
  echo date('c') . " обновлено: сборка $local → $remote\n";
} catch (Throwable $e) {
  fwrite(STDERR, date('c') . ' ошибка: ' . $e->getMessage() . "\n");
  exit(1);
}
