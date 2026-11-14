using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Media;
using System.Reactive.Linq;
using System.Text;
using System.Threading;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Brd;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization.Sections;
using Resto.Front.Api.Data.View;
using Resto.Front.Api.Extensions;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.Patriki
{
    /// <summary>
    /// Заявки из приложения «Патрики» на главной кассе: новая бронь или новый заказ на доставку
    /// всплывает окном поверх экрана iikoFront. Официант звонит гостю и нажимает:
    ///   бронь  — «Подтвердить» (выбирает стол → резерв в iiko) или «Отклонить»;
    ///   заказ  — «Принять» (заказ на стол «Доставка» → на кухню) или «Отклонить».
    /// Решение уходит на сервер, гость видит статус в приложении, в Telegram точки — отметка.
    /// Включается в patriki.json: "Inbox": true (только на главной кассе).
    /// </summary>
    internal sealed class Inbox : IDisposable
    {
        private const string Sender = "Заявки Патрики";
        private static readonly TimeSpan Snooze = TimeSpan.FromMinutes(3);

        private readonly List<IDisposable> subscriptions = new List<IDisposable>();
        private readonly object sync = new object();
        private readonly Dictionary<string, Request> pending = new Dictionary<string, Request>();   // id → заявка
        private readonly Dictionary<string, DateTime> showAfter = new Dictionary<string, DateTime>(); // «Позже»
        private readonly HashSet<string> announced = new HashSet<string>();
        private IDisposable statusBar;
        private int statusCount = -1;
        private int busy;       // идёт опрос
        private int showing;    // открыто окно заявки
        private DateTime lastError = DateTime.MinValue;

        public Inbox()
        {
            PluginContext.Log.Info("Заявки Патрики: включены на этой кассе");
            subscriptions.Add(PluginContext.Operations.AddButtonToPluginsMenu("Заявки из приложения", x => OpenList(x.vm)));
            var every = TimeSpan.FromSeconds(Math.Max(5, Config.Current.PollSeconds));
            subscriptions.Add(Observable.Timer(TimeSpan.FromSeconds(10), every).Subscribe(_ => Poll()));
        }

        public void Dispose()
        {
            foreach (var s in subscriptions) { try { s.Dispose(); } catch { /* фронт уже закрыт */ } }
            subscriptions.Clear();
            try { statusBar?.Dispose(); } catch { /* */ }
        }

        /* ================= опрос сервера ================= */

        private void Poll()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try
            {
                var fresh = Api.Inbox(Config.Current.Venue);
                List<Request> newcomers;
                lock (sync)
                {
                    var ids = new HashSet<string>(fresh.Select(r => r.Id));
                    foreach (var gone in pending.Keys.Where(k => !ids.Contains(k)).ToList()) { pending.Remove(gone); showAfter.Remove(gone); }
                    foreach (var r in fresh) pending[r.Id] = r;
                    newcomers = fresh.Where(r => announced.Add(r.Id)).ToList();
                }
                UpdateStatusBar();

                foreach (var r in newcomers)
                {
                    PluginContext.Operations.AddNotificationMessage(r.Headline, Sender, TimeSpan.FromMinutes(2));
                    PluginContext.Log.Info($"Заявки Патрики: новая заявка — {r.Headline}");
                }
                if (newcomers.Count > 0) Beep();

                ShowNextDue();
            }
            catch (Exception ex)
            {
                // нет связи — не засыпаем кассу сообщениями, пишем в лог не чаще раза в 5 минут
                if (DateTime.Now - lastError > TimeSpan.FromMinutes(5))
                {
                    lastError = DateTime.Now;
                    PluginContext.Log.Warn("Заявки Патрики: не удалось получить заявки — " + ex.Message);
                }
            }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        private void UpdateStatusBar()
        {
            int n;
            lock (sync) n = pending.Count;
            if (n == statusCount) return;
            statusCount = n;
            try { statusBar?.Dispose(); } catch { /* */ }
            statusBar = null;
            if (n > 0)
                statusBar = PluginContext.Operations.AddStatusBarInfo($"🔔 Заявки из приложения: {n} — Доп. операции → «Заявки из приложения»", false, 200);
        }

        private static void Beep()
        {
            try { SystemSounds.Exclamation.Play(); Thread.Sleep(700); SystemSounds.Exclamation.Play(); } catch { /* без звука */ }
        }

        /// <summary>Показать окно следующей заявки, которую пора показать (не отложенную).</summary>
        private void ShowNextDue()
        {
            if (Interlocked.Exchange(ref showing, 1) == 1) return;
            try
            {
                while (true)
                {
                    Request next;
                    lock (sync)
                    {
                        next = pending.Values
                            .Where(r => !showAfter.TryGetValue(r.Id, out var t) || t <= DateTime.Now)
                            .OrderBy(r => r.CreatedAt).FirstOrDefault();
                    }
                    if (next == null) return;
                    var handled = false;
                    try
                    {
                        PluginContext.Operations.TryExecuteUiOperation(vm => handled = Show(vm, next));
                    }
                    catch (Exception ex) when (ex is NotSupportedException || ex is OperationCanceledException)
                    {
                        return; // экран сейчас занят (оплата, печать) — покажем при следующем опросе
                    }
                    if (!handled) lock (sync) showAfter[next.Id] = DateTime.Now + Snooze;
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Заявки Патрики: ошибка окна заявки", ex);
            }
            finally { Interlocked.Exchange(ref showing, 0); }
        }

        /// <summary>Кнопка «Заявки из приложения» в дополнительных операциях — список ожидающих.</summary>
        private void OpenList(IViewManager vm)
        {
            try
            {
                List<Request> list;
                lock (sync) list = pending.Values.OrderBy(r => r.CreatedAt).ToList();
                if (list.Count == 0)
                {
                    vm.ShowOkPopup(Sender, "Новых заявок из приложения нет.");
                    return;
                }
                var i = vm.ShowChooserPopup("Заявки из приложения", list.Select(r => r.Headline).ToList(), -1, ButtonWidth.Wide);
                if (i < 0 || i >= list.Count) return;
                if (!Show(vm, list[i])) lock (sync) showAfter[list[i].Id] = DateTime.Now + Snooze;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Заявки Патрики: ошибка списка заявок", ex);
                vm.ShowErrorPopup("Не удалось открыть заявки: " + ex.Message);
            }
        }

        /// <summary>Окно заявки. true — заявка обработана (подтверждена или отклонена).</summary>
        private bool Show(IViewManager vm, Request r)
        {
            try
            {
                return r.Kind == RequestKind.Reservation ? ShowReservation(vm, r) : ShowOrder(vm, r);
            }
            catch (ApiException ex)
            {
                // сервер ответил по существу: уже обработано другим, гость отменил и т.п.
                vm.ShowOkPopup(Sender, ex.Message);
                Forget(r.Id);
                return true;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error($"Заявки Патрики: ошибка обработки {r.Headline}", ex);
                vm.ShowErrorPopup($"{r.Headline}\n\nНе получилось: {ex.Message}\n\nЗаявка останется в списке, попробуйте ещё раз.");
                return false;
            }
        }

        private void Forget(string id)
        {
            lock (sync) { pending.Remove(id); showAfter.Remove(id); }
            UpdateStatusBar();
        }

        /* ================= бронь ================= */

        private bool ShowReservation(IViewManager vm, Request r)
        {
            var answer = vm.ShowYesNoCancelPopup(r.Title, r.Details + "\n\nПозвоните гостю и подтвердите бронь.",
                "✅ Подтвердить", "❌ Отклонить", "Позже");
            if (answer == null) return false;

            if (answer == false)
            {
                if (!vm.ShowYesNoPopup(r.Title, $"Отклонить бронь гостя {r.Name}?\nГость увидит в приложении, что бронь отклонена.", "Отклонить", "Назад")) return false;
                var who = StaffName(Credentials(vm));
                Api.Decide("front-reserve", r.Id, "decline", who, null, null, null);
                Forget(r.Id);
                PluginContext.Operations.AddNotificationMessage($"Бронь №{r.Number} отклонена", Sender, TimeSpan.FromSeconds(10));
                return true;
            }

            // подтвердить: выбрать стол
            var tables = PluginContext.Operations.GetHostTerminalRestaurantSections()
                .SelectMany(s => s.Tables)
                .Where(t => t.IsActive)
                .OrderBy(t => t.RestaurantSection?.Name).ThenBy(t => t.Number)
                .ToList();
            if (tables.Count == 0) throw new InvalidOperationException("на этой кассе нет столов");
            var labels = tables.Select(TableLabel).ToList();
            var idx = vm.ShowChooserPopup($"Стол для брони №{r.Number} · {r.Guests} чел.", labels, -1, ButtonWidth.Normal, "Отмена");
            if (idx < 0 || idx >= tables.Count) return false;
            var table = tables[idx];

            var creds = Credentials(vm);
            var es = PluginContext.Operations.CreateEditSession();
            var client = FindOrCreateClient(es, r.Name, r.Phone, creds);
            var activity = Cut($"Приложение, бронь №{r.Number}: {r.Guests} чел. {r.Comment}".Trim(), 160);
            Guid.TryParse(r.Id, out var externalId);
            var stub = es.CreateReserve(r.StartsAt, activity, client, new[] { table }, externalId);
            var done = PluginContext.Operations.SubmitChanges(es, creds);
            string reserveId = null;
            try { reserveId = done.Get(stub)?.Id.ToString(); } catch { /* id не обязателен */ }

            Api.Decide("front-reserve", r.Id, "confirm", StaffName(creds), TableLabel(table), reserveId, null);
            Forget(r.Id);
            vm.ShowOkPopup(r.Title, $"Бронь подтверждена.\n{r.StartsAt:dd.MM HH:mm}, {TableLabel(table)}, {r.Guests} чел.\nГость: {r.Name}, {r.Phone}");
            return true;
        }

        private static string TableLabel(ITable t)
        {
            var section = t.RestaurantSection?.Name;
            var name = string.IsNullOrWhiteSpace(t.Name) ? $"Стол {t.Number}" : t.Name;
            return (string.IsNullOrWhiteSpace(section) ? "" : section + " · ") + name + (t.SeatingCapacity > 0 ? $" ({t.SeatingCapacity} мест)" : "");
        }

        /* ================= заказ на доставку ================= */

        private bool ShowOrder(IViewManager vm, Request r)
        {
            var products = ProductIndex();
            var missing = r.Lines.Where(l => !products.ContainsKey(Norm(l.Name))).Select(l => l.Name).Distinct().ToList();
            var text = r.Details;
            if (missing.Count > 0)
                text += "\n\n⚠ Нет в меню iiko (добавьте вручную): " + string.Join(", ", missing);
            text += "\n\nПозвоните гостю, подтвердите заказ и оплату.";

            var answer = vm.ShowYesNoCancelPopup(r.Title, text, "✅ Принять → на кухню", "❌ Отклонить", "Позже");
            if (answer == null) return false;

            if (answer == false)
            {
                var msg = r.Online ? "Деньги гостю вернутся автоматически." : "Гость увидит в приложении, что заказ отменён.";
                if (!vm.ShowYesNoPopup(r.Title, $"Отклонить заказ №{r.Number}?\n{msg}", "Отклонить", "Назад")) return false;
                var who = StaffName(Credentials(vm));
                Api.Decide("front-order", r.Id, "decline", who, null, null, null);
                Forget(r.Id);
                PluginContext.Operations.AddNotificationMessage($"Заказ №{r.Number} отклонён", Sender, TimeSpan.FromSeconds(10));
                return true;
            }

            var table = FindDeliveryTable();
            if (table == null)
            {
                var all = PluginContext.Operations.GetHostTerminalRestaurantSections().SelectMany(s => s.Tables).Where(t => t.IsActive)
                    .OrderBy(t => t.RestaurantSection?.Name).ThenBy(t => t.Number).ToList();
                var i = vm.ShowChooserPopup($"Стол «{Config.Current.DeliveryTable}» не найден. На какой стол поставить заказ?", all.Select(TableLabel).ToList(), -1, ButtonWidth.Normal, "Отмена");
                if (i < 0 || i >= all.Count) return false;
                table = all[i];
            }

            var creds = Credentials(vm);
            var es = PluginContext.Operations.CreateEditSession();
            var order = es.CreateOrder(new[] { table });
            var guest = es.AddOrderGuest(Guid.NewGuid(), Cut(r.Name, 60), order);
            var added = 0;
            foreach (var line in r.Lines)
            {
                if (!products.TryGetValue(Norm(line.Name), out var product)) continue;
                var size = product.Scale == null ? null : product.Scale.DefaultSize ?? PluginContext.Operations.GetProductScaleSizes(product.Scale).FirstOrDefault();
                var item = es.AddOrderProductItem(line.Qty, product, order, guest, size);
                AddDefaultModifiers(es, product, order, item);
                added++;
            }
            es.ChangeOrderComment(Cut(r.KitchenComment(missing), 500), order);
            var done = PluginContext.Operations.SubmitChanges(es, creds);
            var created = done.Get(order);

            // на кухню
            var kitchenNote = "";
            try
            {
                var full = PluginContext.Operations.GetOrderById(created.Id);
                var cooking = full.Items.OfType<IOrderCookingItem>().ToList();
                if (cooking.Count > 0) PluginContext.Operations.PrintOrderItems(full, cooking, creds);
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error($"Заявки Патрики: заказ №{r.Number} создан, но не ушёл на кухню", ex);
                kitchenNote = "\n\n⚠ На кухню автоматически не ушёл: откройте заказ на столе и отправьте вручную.";
            }

            var res = Api.Decide("front-order", r.Id, "accept", StaffName(creds), null, created.Id.ToString(), created.Number.ToString(CultureInfo.InvariantCulture));
            Forget(r.Id);
            var payNote = r.Online ? "\nОнлайн-оплата: " + (res.TryGetValue("payment_status", out var ps) && Convert.ToString(ps) == "paid" ? "деньги списаны ✅" : Convert.ToString(ps)) : "";
            vm.ShowOkPopup(r.Title, $"Заказ принят: {TableLabel(table)}, заказ iiko №{created.Number}, позиций: {added}." + payNote
                + (missing.Count > 0 ? "\n\n⚠ Добавьте вручную: " + string.Join(", ", missing) : "") + kitchenNote);
            return true;
        }

        private static void AddDefaultModifiers(Resto.Front.Api.Editors.IEditSession es, IProduct product, Resto.Front.Api.Editors.Stubs.IOrderStub order, Resto.Front.Api.Editors.Stubs.INewOrderProductItemStub item)
        {
            try
            {
                foreach (var m in product.GetSimpleModifiers(null).Where(x => x.DefaultAmount != 0))
                    es.AddOrderModifierItem(m.DefaultAmount, m.Product, null, order, item);
                foreach (var g in product.GetGroupModifiers(null))
                    foreach (var m in g.Items.Where(x => x.DefaultAmount != 0))
                        es.AddOrderModifierItem(m.DefaultAmount, m.Product, g.ProductGroup, order, item);
            }
            catch (Exception ex)
            {
                PluginContext.Log.Warn($"Заявки Патрики: модификаторы по умолчанию для «{product.Name}» не добавлены — {ex.Message}");
            }
        }

        internal static ITable FindDeliveryTable()
        {
            var want = (Config.Current.DeliveryTable ?? "").Trim();
            if (want.Length == 0) return null;
            var tables = PluginContext.Operations.GetHostTerminalRestaurantSections().SelectMany(s => s.Tables).Where(t => t.IsActive).ToList();
            return tables.FirstOrDefault(t => string.Equals((t.Name ?? "").Trim(), want, StringComparison.OrdinalIgnoreCase))
                ?? tables.FirstOrDefault(t => t.Number.ToString(CultureInfo.InvariantCulture) == want)
                ?? tables.FirstOrDefault(t => string.Equals((t.RestaurantSection?.Name ?? "").Trim(), want, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Блюда iiko по названию (без учёта регистра, ё/е и лишних пробелов).</summary>
        private static Dictionary<string, IProduct> ProductIndex()
        {
            var map = new Dictionary<string, IProduct>();
            foreach (var p in PluginContext.Operations.GetActiveProducts())
            {
                if (p.Type != ProductType.Dish && p.Type != ProductType.Goods) continue;
                var k = Norm(p.Name);
                if (k.Length > 0 && !map.ContainsKey(k)) map[k] = p;
            }
            return map;
        }

        internal static string Norm(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "";
            var t = s.Trim().ToLowerInvariant().Replace('ё', 'е').Replace('«', '"').Replace('»', '"');
            var sb = new StringBuilder();
            var space = false;
            foreach (var c in t)
            {
                if (char.IsWhiteSpace(c)) { space = true; continue; }
                if (space && sb.Length > 0) sb.Append(' ');
                space = false;
                sb.Append(c);
            }
            return sb.ToString();
        }

        /* ================= общее ================= */

        /// <summary>Права кассы: учётная запись плагина, а если её нет — PIN сотрудника.</summary>
        internal static Resto.Front.Api.Data.Security.ICredentials Credentials(IViewManager vm)
        {
            try { return PluginContext.Operations.GetDefaultCredentials(); }
            catch (Exception ex)
            {
                PluginContext.Log.Info("Заявки Патрики: нет учётной записи плагина, спрашиваем PIN — " + ex.Message);
            }
            var settings = new ExtendedInputDialogSettings { NumericInputMode = NumericInputMode.String, TabTitleNumericString = "PIN" };
            var input = vm.ShowExtendedInputDialog(Sender, "Введите ваш PIN-код iiko", settings) as StringInputDialogResult;
            if (input == null || string.IsNullOrWhiteSpace(input.Result)) throw new OperationCanceledException("PIN не введён");
            return PluginContext.Operations.AuthenticateByPin(input.Result.Trim());
        }

        private static string StaffName(Resto.Front.Api.Data.Security.ICredentials creds)
        {
            try { return PluginContext.Operations.GetUser(creds)?.Name ?? ""; } catch { return ""; }
        }

        private static Resto.Front.Api.Editors.Stubs.IClientStub FindOrCreateClient(Resto.Front.Api.Editors.IEditSession es, string name, string phone, Resto.Front.Api.Data.Security.ICredentials creds)
        {
            try
            {
                var existing = PluginContext.Operations.TryGetClientByPhone(phone, creds);
                if (existing != null) return existing;
            }
            catch (Exception ex) { PluginContext.Log.Warn("Заявки Патрики: поиск гостя по телефону — " + ex.Message); }
            var phones = new List<PhoneDto> { new PhoneDto { PhoneValue = phone, IsMain = true } };
            return es.CreateClient(Guid.NewGuid(), string.IsNullOrWhiteSpace(name) ? "Гость" : Cut(name, 60), phones, null, DateTime.Now);
        }

        internal static string Cut(string s, int max) => string.IsNullOrEmpty(s) || s.Length <= max ? s ?? "" : s.Substring(0, max - 1) + "…";
    }

    /* ================= данные заявки ================= */

    internal enum RequestKind { Reservation, Order }

    internal sealed class OrderLine
    {
        public string Name;
        public int Qty;
        public int Price;
    }

    internal sealed class Request
    {
        public RequestKind Kind;
        public string Id;
        public long Number;
        public DateTime CreatedAt;
        public string Name;
        public string Phone;
        public string Comment;
        // бронь
        public DateTime StartsAt;
        public int Guests;
        // заказ
        public string Address;
        public string WhenText;
        public string PaymentText;
        public bool Online;
        public int Subtotal, DeliveryFee, Total, Points;
        public List<OrderLine> Lines = new List<OrderLine>();

        public string Title => Kind == RequestKind.Reservation ? $"📅 Новая бронь №{Number}" : $"🛵 Новый заказ на доставку №{Number}";

        public string Headline => Kind == RequestKind.Reservation
            ? $"Бронь №{Number}: {StartsAt:dd.MM HH:mm}, {Guests} чел., {Name}, {Phone}"
            : $"Доставка №{Number}: {Total} ₽, {Name}, {Phone}";

        public string Details
        {
            get
            {
                var sb = new StringBuilder();
                if (Kind == RequestKind.Reservation)
                {
                    sb.AppendLine($"Когда: {StartsAt:dddd, dd.MM} в {StartsAt:HH:mm}");
                    sb.AppendLine($"Гостей: {Guests}");
                    sb.AppendLine($"Имя: {Name}");
                    sb.AppendLine($"Телефон: {Phone}");
                    if (!string.IsNullOrWhiteSpace(Comment)) sb.AppendLine($"Комментарий: {Comment}");
                }
                else
                {
                    foreach (var l in Lines) sb.AppendLine($"• {l.Name} × {l.Qty} = {l.Price * l.Qty} ₽");
                    if (DeliveryFee > 0) sb.AppendLine($"Доставка: {DeliveryFee} ₽");
                    if (Points > 0) sb.AppendLine($"Оплачено баллами: {Points} ₽");
                    sb.AppendLine($"ИТОГО: {Total} ₽ — {PaymentText}");
                    sb.AppendLine();
                    sb.AppendLine($"Имя: {Name}");
                    sb.AppendLine($"Телефон: {Phone}");
                    sb.AppendLine($"Адрес: {Address}");
                    if (!string.IsNullOrWhiteSpace(WhenText)) sb.AppendLine($"Когда: {WhenText}");
                    if (!string.IsNullOrWhiteSpace(Comment)) sb.AppendLine($"Комментарий: {Comment}");
                }
                return sb.ToString().TrimEnd();
            }
        }

        /// <summary>Комментарий к заказу в iiko: видно на кухне и курьеру.</summary>
        public string KitchenComment(List<string> missing)
        {
            var s = $"ДОСТАВКА из приложения №{Number}. {Name}, {Phone}. {Address}.";
            if (!string.IsNullOrWhiteSpace(WhenText)) s += $" Когда: {WhenText}.";
            s += $" Оплата: {PaymentText}, итого {Total} ₽.";
            if (Points > 0) s += $" Баллами {Points} ₽.";
            if (!string.IsNullOrWhiteSpace(Comment)) s += $" Комментарий: {Comment}.";
            if (missing.Count > 0) s += " НЕ НАЙДЕНО В МЕНЮ: " + string.Join(", ", missing) + ".";
            return s;
        }

        /* --- разбор ответа сервера --- */
        public static Request FromReservation(Dictionary<string, object> d) => new Request
        {
            Kind = RequestKind.Reservation,
            Id = Str(d, "id"),
            Number = Long(d, "number"),
            CreatedAt = Time(d, "created_at"),
            StartsAt = Time(d, "starts_at"),
            Guests = (int)Long(d, "guests"),
            Name = Str(d, "name"),
            Phone = Str(d, "phone"),
            Comment = Str(d, "comment"),
        };

        public static Request FromOrder(Dictionary<string, object> d)
        {
            var r = new Request
            {
                Kind = RequestKind.Order,
                Id = Str(d, "id"),
                Number = Long(d, "number"),
                CreatedAt = Time(d, "created_at"),
                Name = Str(d, "customer_name"),
                Phone = Str(d, "phone"),
                Address = Str(d, "address"),
                Comment = Str(d, "comment"),
                WhenText = Str(d, "when_text"),
                PaymentText = Str(d, "payment_text"),
                Online = Str(d, "payment") == "online",
                Subtotal = (int)Long(d, "subtotal"),
                DeliveryFee = (int)Long(d, "delivery_fee"),
                Total = (int)Long(d, "total"),
                Points = (int)Long(d, "points_redeemed"),
            };
            if (d.TryGetValue("items", out var items) && items is IEnumerable list)
                foreach (var o in list)
                    if (o is Dictionary<string, object> it)
                        r.Lines.Add(new OrderLine { Name = Str(it, "name"), Qty = Math.Max(1, (int)Long(it, "qty")), Price = (int)Long(it, "price") });
            return r;
        }

        private static string Str(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : "";
        private static long Long(Dictionary<string, object> d, string k)
        {
            if (!d.TryGetValue(k, out var v) || v == null) return 0;
            try { return Convert.ToInt64(v, CultureInfo.InvariantCulture); } catch { return 0; }
        }
        private static DateTime Time(Dictionary<string, object> d, string k)
        {
            var s = Str(d, k);
            return DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? t.LocalDateTime : DateTime.Now;
        }
    }
}
