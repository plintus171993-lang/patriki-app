<?php
// api.patrikipab.ru — российский адрес сервера приложения «Патрики».
// Пересылает запросы приложения в Supabase (ozbdmczmpejyctezxrdk.supabase.co),
// чтобы гости, у которых провайдер не пускает к supabase.co, могли работать с приложением.
// Пускаем только пути API Supabase; всё остальное — 404.

const UPSTREAM = 'https://ozbdmczmpejyctezxrdk.supabase.co';
const ALLOWED = ['/rest/v1/', '/auth/v1/', '/functions/v1/', '/storage/v1/'];

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '/';

if ($path === '/ping') { header('Content-Type: text/plain'); header('Access-Control-Allow-Origin: *'); echo 'ok'; exit; }

$ok = false;
foreach (ALLOWED as $p) { if (strpos($path, $p) === 0) { $ok = true; break; } }
if (!$ok) { http_response_code(404); header('Content-Type: text/plain'); echo 'not found'; exit; }

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = file_get_contents('php://input');

// заголовки запроса: всё, кроме служебных
$skip = ['host', 'content-length', 'accept-encoding', 'connection', 'cookie', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip'];
$in = [];
if (function_exists('getallheaders')) { $in = getallheaders(); }
else { foreach ($_SERVER as $k => $v) if (strpos($k, 'HTTP_') === 0) $in[str_replace('_', '-', substr($k, 5))] = $v; }
$hasAuth = false;
foreach ($in as $k => $v) if (strtolower($k) === 'authorization') $hasAuth = true;
if (!$hasAuth) {
  $a = $_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  if ($a !== '') $in['Authorization'] = $a;
}
$headers = [];
foreach ($in as $k => $v) {
  if (in_array(strtolower($k), $skip, true)) continue;
  $headers[] = $k . ': ' . $v;
}
$headers[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '');

$respHeaders = [];
$ch = curl_init(UPSTREAM . $uri);
curl_setopt_array($ch, [
  CURLOPT_CUSTOMREQUEST => $method,
  CURLOPT_HTTPHEADER => $headers,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_ENCODING => '',
  CURLOPT_CONNECTTIMEOUT => 10,
  CURLOPT_TIMEOUT => 60,
  CURLOPT_FOLLOWLOCATION => false,
  CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$respHeaders) {
    $len = strlen($line);
    $parts = explode(':', $line, 2);
    if (count($parts) === 2) {
      $name = strtolower(trim($parts[0]));
      if (!in_array($name, ['transfer-encoding', 'content-encoding', 'content-length', 'connection', 'alt-svc', 'strict-transport-security'], true)) {
        $respHeaders[] = trim($line);
      }
    }
    return $len;
  },
]);
if ($method !== 'GET' && $method !== 'HEAD' && $body !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);

$resp = curl_exec($ch);
if ($resp === false) {
  http_response_code(502);
  header('Content-Type: application/json');
  header('Access-Control-Allow-Origin: *');
  echo json_encode(['message' => 'Сервер временно недоступен', 'detail' => curl_error($ch)], JSON_UNESCAPED_UNICODE);
  exit;
}
http_response_code(curl_getinfo($ch, CURLINFO_RESPONSE_CODE));
curl_close($ch);
foreach ($respHeaders as $h) header($h, false);
echo $resp;
