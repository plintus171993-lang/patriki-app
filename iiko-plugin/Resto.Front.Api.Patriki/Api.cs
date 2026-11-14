using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Web.Script.Serialization;
using Resto.Front.Api.Data.Orders;

namespace Resto.Front.Api.Patriki
{
    /// <summary>Ошибка по существу от сервера лояльности (текст показывается бармену).</summary>
    internal sealed class ApiException : Exception
    {
        public ApiException(string message) : base(message) { }
    }

    internal sealed class GuestInfo
    {
        public string Name;
        public string CardNo;
        public int Balance;
        public string TierText;
        public bool Legacy;
        public int MaxRedeemPct;
    }

    internal sealed class RedeemResult
    {
        public string Id;
        public int Points;
        public int Balance;
    }

    internal sealed class CloseResult
    {
        public int Points;
        public int DelayDays;
        public string Name;
        public string Note;
    }

    /// <summary>Данные закрытого чека для front-close (сериализуются в JSON и в очередь).</summary>
    public sealed class CloseRequest
    {
        public string Code { get; set; }
        public string Venue { get; set; }
        public string OrderId { get; set; }
        public int Number { get; set; }
        public decimal Sum { get; set; }
        public List<CloseItem> Items { get; set; } = new List<CloseItem>();
        // "done" — заказ доставки из приложения закрыт (в очередь, если нет связи)
        public string Kind { get; set; }

        public static CloseRequest FromOrder(IOrder order, string code, string venue)
        {
            var r = new CloseRequest { Code = code, Venue = venue, OrderId = order.Id.ToString(), Number = order.Number, Sum = order.ResultSum };
            foreach (var item in order.Items)
            {
                if (item.Deleted) continue;
                switch (item)
                {
                    case IOrderProductItem p:
                        r.Items.Add(CloseItem.Of(p.Product, p.Amount, p.ResultSum));
                        break;
                    case IOrderCompoundItem c:
                        if (c.PrimaryComponent != null) r.Items.Add(CloseItem.Of(c.PrimaryComponent.Product, c.Amount, c.PrimaryComponent.ResultSum));
                        if (c.SecondaryComponent != null) r.Items.Add(CloseItem.Of(c.SecondaryComponent.Product, c.Amount, c.SecondaryComponent.ResultSum));
                        break;
                }
            }
            return r;
        }
    }

    public sealed class CloseItem
    {
        public string ProductId { get; set; }
        public string ProductGroupId { get; set; }
        public string Name { get; set; }
        public decimal Amount { get; set; }
        public decimal Sum { get; set; }

        public static CloseItem Of(Resto.Front.Api.Data.Assortment.IProduct product, decimal amount, decimal sum)
        {
            string groupId = null;
            try { groupId = PluginContext.Operations.TryGetParentByProduct(product)?.Id.ToString(); } catch { /* группа не обязательна */ }
            return new CloseItem { ProductId = product?.Id.ToString(), ProductGroupId = groupId, Name = product?.Name, Amount = amount, Sum = sum };
        }
    }

    internal static class Api
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly HttpClient Http;

        static Api()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            Http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        }

        public static GuestInfo Lookup(string code)
        {
            var d = Post(new Dictionary<string, object> { ["action"] = "front-lookup", ["code"] = code });
            var tier = d.TryGetValue("tier", out var t) ? t as Dictionary<string, object> : null;
            var tierName = tier != null && tier.TryGetValue("name", out var tn) ? Convert.ToString(tn) : "";
            var tierPct = tier != null && tier.TryGetValue("pct", out var tp) ? Convert.ToString(tp, CultureInfo.InvariantCulture) : "";
            return new GuestInfo
            {
                Name = Str(d, "name") ?? "Гость",
                CardNo = Str(d, "card_no"),
                Balance = Int(d, "balance"),
                TierText = string.IsNullOrEmpty(tierName) ? "" : $"{tierName} {tierPct}%",
                Legacy = d.TryGetValue("legacy", out var l) && l is bool b && b,
                MaxRedeemPct = Int(d, "max_redeem_pct"),
            };
        }

        /// <summary>Оплата баллами: сервер сразу списывает баллы по свежему QR и держит их за заказом iiko.</summary>
        public static RedeemResult Redeem(string qr, Guid orderId, int points, decimal sumBefore)
        {
            var d = Post(new Dictionary<string, object>
            {
                ["action"] = "front-redeem", ["code"] = qr, ["venue"] = Config.Current.Venue,
                ["order_id"] = orderId.ToString(), ["points"] = points, ["sum"] = (int)Math.Floor(sumBefore),
            });
            return new RedeemResult { Id = Str(d, "id"), Points = Int(d, "points"), Balance = Int(d, "balance") };
        }

        /// <summary>
        /// Заказ со скидкой «Баллы Патрики» закрыт на другой кассе (гость привязан не здесь):
        /// фиксируем списание без начисления — пустой чек, сервер только закрывает удержания.
        /// </summary>
        public static void RedeemFinalize(Guid orderId, int number)
        {
            Post(new Dictionary<string, object>
            {
                ["action"] = "front-close", ["code"] = "-", ["venue"] = Config.Current.Venue,
                ["order"] = new Dictionary<string, object> { ["id"] = orderId.ToString(), ["number"] = number, ["sum"] = 0, ["items"] = new List<object>() },
            });
        }

        /// <summary>Вернуть гостю баллы (скидку убрали или заказ удалён).</summary>
        public static int RedeemCancel(string id)
        {
            var d = Post(new Dictionary<string, object> { ["action"] = "front-redeem-cancel", ["id"] = id });
            return Int(d, "returned");
        }

        /// <summary>Заказ доставки из приложения закрыт на кассе — отметить выполненным (гостю начислятся баллы).</summary>
        public static bool DeliveryDone(Guid iikoOrderId)
        {
            var d = Post(new Dictionary<string, object> { ["action"] = "front-done", ["venue"] = Config.Current.Venue, ["iiko_id"] = iikoOrderId.ToString() });
            return d.TryGetValue("found", out var f) && f is bool b && b;
        }

        public static CloseResult Close(CloseRequest r)
        {
            var body = new Dictionary<string, object>
            {
                ["action"] = "front-close",
                ["code"] = r.Code,
                ["venue"] = r.Venue,
                ["order"] = new Dictionary<string, object>
                {
                    ["id"] = r.OrderId,
                    ["number"] = r.Number,
                    ["sum"] = r.Sum,
                    ["items"] = r.Items.Select(i => new Dictionary<string, object>
                    {
                        ["productId"] = i.ProductId,
                        ["productGroupId"] = i.ProductGroupId,
                        ["name"] = i.Name,
                        ["amount"] = i.Amount,
                        ["sum"] = i.Sum,
                    }).ToList(),
                },
            };
            var d = Post(body);
            return new CloseResult { Points = Int(d, "points"), DelayDays = Int(d, "delay_days"), Name = Str(d, "name"), Note = Str(d, "note") };
        }

        /// <summary>Новые брони и заказы из приложения для своей точки.</summary>
        public static List<Request> Inbox(string venue)
        {
            var d = Post(new Dictionary<string, object> { ["action"] = "front-inbox", ["venue"] = venue });
            var list = new List<Request>();
            if (d.TryGetValue("reservations", out var rs) && rs is System.Collections.IEnumerable r1)
                foreach (var x in r1) if (x is Dictionary<string, object> r) list.Add(Request.FromReservation(r));
            if (d.TryGetValue("orders", out var os) && os is System.Collections.IEnumerable o1)
                foreach (var x in o1) if (x is Dictionary<string, object> o) list.Add(Request.FromOrder(o));
            return list.Where(r => !string.IsNullOrEmpty(r.Id)).ToList();
        }

        /// <summary>Решение официанта: action = front-reserve | front-order, decision = confirm/decline | accept/decline.</summary>
        public static Dictionary<string, object> Decide(string action, string id, string decision, string staff, string table, string iikoId, string iikoNumber)
        {
            var body = new Dictionary<string, object>
            {
                ["action"] = action, ["venue"] = Config.Current.Venue, ["id"] = id, ["decision"] = decision, ["staff"] = staff ?? "",
            };
            if (!string.IsNullOrEmpty(table)) body["table"] = table;
            if (!string.IsNullOrEmpty(iikoId)) body["iiko_id"] = iikoId;
            if (!string.IsNullOrEmpty(iikoNumber)) body["iiko_number"] = iikoNumber;
            return Post(body);
        }

        internal static Dictionary<string, object> Post(Dictionary<string, object> body)
        {
            var cfg = Config.Current;
            var req = new HttpRequestMessage(HttpMethod.Post, cfg.ApiUrl)
            {
                Content = new StringContent(Json.Serialize(body), Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("x-pos-key", cfg.PosKey);
            using (var res = Http.SendAsync(req).GetAwaiter().GetResult())
            {
                var text = res.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                Dictionary<string, object> d;
                try { d = Json.Deserialize<Dictionary<string, object>>(text) ?? new Dictionary<string, object>(); }
                catch { throw new HttpRequestException($"Сервер ответил {(int)res.StatusCode}"); }
                if (d.TryGetValue("error", out var err) && err != null) throw new ApiException(Convert.ToString(err));
                if (!res.IsSuccessStatusCode) throw new HttpRequestException($"Сервер ответил {(int)res.StatusCode}");
                return d;
            }
        }

        private static string Str(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v) : null;
        private static int Int(Dictionary<string, object> d, string k)
        {
            if (!d.TryGetValue(k, out var v) || v == null) return 0;
            try { return Convert.ToInt32(v, CultureInfo.InvariantCulture); } catch { return 0; }
        }
    }

    /// <summary>Настройки: patriki.json в папке настроек плагинов iikoFront.</summary>
    public sealed class Config
    {
        public string ApiUrl { get; set; } = "https://ozbdmczmpejyctezxrdk.supabase.co/functions/v1/iiko";
        public string PosKey { get; set; } = "";
        public string Venue { get; set; } = "petrogradka";

        // Заявки из приложения (брони и доставка) — включать ТОЛЬКО на главной кассе точки
        public bool Inbox { get; set; } = false;
        // Стол, на который ставятся заказы доставки из приложения (название или номер стола в iiko)
        public string DeliveryTable { get; set; } = "Доставка";
        // Как часто спрашивать сервер о новых заявках, секунд
        public int PollSeconds { get; set; } = 15;
        // Скидка iiko для оплаты баллами: тип скидки «на произвольную сумму» с таким названием (пусто — оплата баллами выключена)
        public string RedeemDiscount { get; set; } = "Баллы Патрики";

        public bool IsReady => !string.IsNullOrWhiteSpace(PosKey) && !string.IsNullOrWhiteSpace(ApiUrl);

        private static Config current;
        public static Config Current => current ?? (current = Load());

        // Файл настроек ищем сначала рядом с плагином (Plugins\Resto.Front.Api.Patriki\patriki.json),
        // затем в папке настроек плагинов iikoFront.
        private static string LocalPath => System.IO.Path.Combine(System.IO.Path.GetDirectoryName(typeof(Config).Assembly.Location) ?? "", "patriki.json");
        public static string Path => File.Exists(LocalPath) ? LocalPath : System.IO.Path.Combine(PluginContext.Integration.GetConfigsDirectoryPath(), "patriki.json");

        private static Config Load()
        {
            var json = new JavaScriptSerializer();
            try
            {
                if (File.Exists(Path))
                {
                    var c = json.Deserialize<Config>(File.ReadAllText(Path, Encoding.UTF8)) ?? new Config();
                    PluginContext.Log.Info($"Карта Патрики: настройки из {Path}, заведение {c.Venue}, ключ {(c.IsReady ? "указан" : "НЕ указан")}, заявки из приложения: {(c.Inbox ? "ВКЛ (главная касса)" : "выкл")}, оплата баллами: {(string.IsNullOrWhiteSpace(c.RedeemDiscount) ? "выкл" : "скидка «" + c.RedeemDiscount + "»")}");
                    return c;
                }
                var def = new Config();
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path));
                File.WriteAllText(Path, json.Serialize(def), Encoding.UTF8);
                PluginContext.Log.Warn($"Карта Патрики: создан файл настроек {Path} — впишите posKey и перезапустите iikoFront");
                return def;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Карта Патрики: не удалось прочитать настройки", ex);
                return new Config();
            }
        }
    }
}
