using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reactive.Linq;
using System.Text;
using System.Threading;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization.Sections;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.Patriki
{
    /// <summary>
    /// Заказы из приложения официантов («Официант Патрики»), только на главной кассе ("Inbox": true).
    /// Каждые несколько секунд плагин спрашивает сервер, нет ли новых заказов, и сразу, без окон:
    ///   • ставит заказ на стол (или дозаказом в открытый заказ этого стола) от имени официанта;
    ///   • печатает новые позиции на кухню / бар;
    ///   • сообщает приложению результат (официант видит «на кассе и на кухне ✓» или текст ошибки).
    /// Заодно отправляет снимок открытых заказов по столам — для вкладки «На столе» в приложении.
    /// Если у плагина нет своей учётной записи iiko, заказы ждут: кассир открывает
    /// Доп. операции → Плагины → «Заказы официантов» и вводит свой PIN.
    /// </summary>
    internal sealed class Waiters : IDisposable
    {
        private const string Sender = "Официанты Патрики";
        private static readonly TimeSpan Every = TimeSpan.FromSeconds(4);

        private readonly List<IDisposable> subscriptions = new List<IDisposable>();
        private readonly object sync = new object();
        private readonly List<WaiterOrder> waiting = new List<WaiterOrder>(); // ждут PIN кассира
        private int busy;
        private string lastSnapshot = "";
        private DateTime lastSnapshotAt = DateTime.MinValue;
        private DateTime lastError = DateTime.MinValue;
        private DateTime lastPinHint = DateTime.MinValue;

        public Waiters()
        {
            PluginContext.Log.Info("Официанты Патрики: приём заказов из приложения включён на этой кассе");
            subscriptions.Add(PluginContext.Operations.AddButtonToPluginsMenu("Заказы официантов", x => ProcessWithPin(x.vm)));
            subscriptions.Add(Observable.Timer(TimeSpan.FromSeconds(8), Every).Subscribe(_ => Poll()));
        }

        public void Dispose()
        {
            foreach (var s in subscriptions) { try { s.Dispose(); } catch { /* фронт уже закрыт */ } }
            subscriptions.Clear();
        }

        /* ================= опрос ================= */

        private void Poll()
        {
            if (Interlocked.Exchange(ref busy, 1) == 1) return;
            try
            {
                Dictionary<string, object> tables = null;
                try
                {
                    var snap = Snapshot();
                    var key = Api.Serialize(snap);
                    if (key != lastSnapshot || DateTime.Now - lastSnapshotAt > TimeSpan.FromSeconds(60))
                    {
                        tables = snap; lastSnapshot = key; lastSnapshotAt = DateTime.Now;
                    }
                }
                catch (Exception ex) { PluginContext.Log.Warn("Официанты Патрики: снимок столов — " + ex.Message); }

                var orders = Api.WaiterPoll(Config.Current.Venue, tables);
                if (orders.Count == 0) return;

                ICredentials creds = null;
                try { creds = PluginContext.Operations.GetDefaultCredentials(); }
                catch (Exception ex) { PluginContext.Log.Info("Официанты Патрики: нет учётной записи плагина — " + ex.Message); }

                foreach (var o in orders)
                {
                    if (creds == null)
                    {
                        lock (sync) { if (waiting.All(w => w.Id != o.Id)) waiting.Add(o); }
                        continue;
                    }
                    Process(o, creds);
                }

                int left; lock (sync) left = waiting.Count;
                if (left > 0 && DateTime.Now - lastPinHint > TimeSpan.FromMinutes(1))
                {
                    lastPinHint = DateTime.Now;
                    PluginContext.Operations.AddNotificationMessage(
                        $"Заказов официантов ждут PIN: {left}. Доп. операции → Плагины → «Заказы официантов»", Sender, TimeSpan.FromMinutes(1));
                }
            }
            catch (Exception ex)
            {
                if (DateTime.Now - lastError > TimeSpan.FromMinutes(5))
                {
                    lastError = DateTime.Now;
                    PluginContext.Log.Warn("Официанты Патрики: сервер недоступен — " + ex.Message);
                }
            }
            finally { Interlocked.Exchange(ref busy, 0); }
        }

        private void ProcessWithPin(IViewManager vm)
        {
            List<WaiterOrder> list;
            lock (sync) list = waiting.ToList();
            if (list.Count == 0) { vm.ShowOkPopup(Sender, "Все заказы официантов уже на столах."); return; }
            ICredentials creds;
            try { creds = Inbox.Credentials(vm); }
            catch (Exception ex) { vm.ShowOkPopup(Sender, ex.Message); return; }
            var ok = 0;
            foreach (var o in list)
            {
                if (Process(o, creds)) ok++;
                lock (sync) waiting.RemoveAll(w => w.Id == o.Id);
            }
            vm.ShowOkPopup(Sender, $"Поставлено на столы: {ok} из {list.Count}.");
        }

        /* ================= создание заказа ================= */

        private bool Process(WaiterOrder o, ICredentials creds)
        {
            try
            {
                var os = PluginContext.Operations;
                var table = FindTable(o);
                if (table == null) throw new InvalidOperationException($"Стол «{o.Table}» не найден на этой кассе");

                var lines = new List<(WaiterLine line, IProduct product, IProductSize size)>();
                var missing = new List<string>();
                Dictionary<string, IProduct> byName = null;
                foreach (var l in o.Lines)
                {
                    IProduct p = null;
                    try { p = os.GetProductById(l.ProductId); } catch { /* нет такого */ }
                    if (p == null)
                    {
                        // id из облака не совпал с кассой — ищем блюдо по названию
                        if (byName == null) byName = Inbox.ProductIndex();
                        byName.TryGetValue(Inbox.Norm(l.Name), out p);
                    }
                    if (p == null) { missing.Add(l.Name); continue; }
                    IProductSize size = null;
                    if (l.SizeId.HasValue) { try { size = os.GetProductSizeById(l.SizeId.Value); } catch { size = null; } }
                    if (size == null && p.Scale != null) size = p.Scale.DefaultSize ?? os.GetProductScaleSizes(p.Scale).FirstOrDefault();
                    lines.Add((l, p, size));
                }
                if (lines.Count == 0) throw new InvalidOperationException("Позиций нет в меню кассы: " + string.Join(", ", missing));

                IUser waiter = null;
                if (o.WaiterId.HasValue) { try { waiter = os.GetUserById(o.WaiterId.Value); } catch { waiter = null; } }

                var open = os.GetOrders()
                    .Where(x => x.Status == OrderStatus.New && x.Tables.Any(t => t.Id == table.Id))
                    .OrderBy(x => x.OpenTime).FirstOrDefault();

                var es = os.CreateEditSession();
                Resto.Front.Api.Editors.Stubs.IOrderStub orderStub;
                Resto.Front.Api.Editors.Stubs.IOrderGuestItemStub guest;
                Resto.Front.Api.Editors.Stubs.INewOrderStub created = null;
                if (open != null)
                {
                    orderStub = open;
                    guest = open.Guests.FirstOrDefault();
                    if (guest == null) guest = es.AddOrderGuest(Guid.NewGuid(), "Гость 1", orderStub);
                }
                else
                {
                    created = es.CreateOrder(new[] { table }, null, false, waiter);
                    orderStub = created;
                    guest = es.AddOrderGuest(Guid.NewGuid(), "Гость 1", orderStub);
                    for (var g = 2; g <= Math.Min(o.Guests, 20); g++) es.AddOrderGuest(Guid.NewGuid(), "Гость " + g, orderStub);
                }

                foreach (var (line, product, size) in lines)
                {
                    var item = es.AddOrderProductItem(line.Amount, product, orderStub, guest, size);
                    if (!string.IsNullOrWhiteSpace(line.Comment))
                    {
                        try { es.ChangeOrderItemComment(Inbox.Cut(line.Comment, 200), orderStub, item); }
                        catch (Exception ex) { PluginContext.Log.Warn("Официанты Патрики: комментарий не добавлен — " + ex.Message); }
                    }
                    AddModifiers(es, product, orderStub, item, line);
                }
                if (missing.Count > 0)
                {
                    try { es.ChangeOrderComment(Inbox.Cut("Нет в меню кассы: " + string.Join(", ", missing), 500), orderStub); } catch { /* */ }
                }

                var result = os.SubmitChanges(es, creds);
                var orderId = created != null ? result.Get(created).Id : open.Id;

                // новые позиции — на кухню / бар
                var kitchen = "";
                try
                {
                    var full = os.GetOrderById(orderId);
                    var cooking = full.Items.OfType<IOrderCookingItem>().Where(i => !i.Deleted && i.PrintTime == null).ToList();
                    if (cooking.Count > 0) os.PrintOrderItems(full, cooking, creds);
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error($"Официанты Патрики: заказ на столе {o.Table}, но не ушёл на кухню", ex);
                    kitchen = " Не ушёл на кухню — отправьте с кассы.";
                }
                var number = os.GetOrderById(orderId).Number;

                var note = (missing.Count > 0 ? " Нет в меню кассы: " + string.Join(", ", missing) + "." : "") + kitchen;
                Api.WaiterResult(o.Id, true, note.Trim(), orderId, number, open != null ? "add" : "create");
                os.AddNotificationMessage($"{o.Table}: {(open != null ? "дозаказ" : "заказ")} от {o.Waiter} (№{number})", Sender, TimeSpan.FromSeconds(15));
                PluginContext.Log.Info($"Официанты Патрики: {o.Table}, заказ №{number}, позиций {lines.Count}, официант {o.Waiter}");
                return true;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error($"Официанты Патрики: заказ {o.Id} ({o.Table}) не создан", ex);
                try { Api.WaiterResult(o.Id, false, ex.Message, null, 0, null); } catch { /* сервер повторит позже */ }
                try { PluginContext.Operations.AddNotificationMessage($"{o.Table}: заказ официанта {o.Waiter} не создан — {ex.Message}", Sender, TimeSpan.FromMinutes(1)); } catch { /* */ }
                return false;
            }
        }

        private static void AddModifiers(Resto.Front.Api.Editors.IEditSession es, IProduct product, Resto.Front.Api.Editors.Stubs.IOrderStub order,
            Resto.Front.Api.Editors.Stubs.INewOrderProductItemStub item, WaiterLine line)
        {
            foreach (var m in line.Mods)
            {
                try
                {
                    if (m.GroupId.HasValue)
                    {
                        var g = product.GetGroupModifiers(null).FirstOrDefault(x => x.ProductGroup.Id == m.GroupId.Value);
                        var gm = g?.Items.FirstOrDefault(x => x.Product.Id == m.Id);
                        if (gm != null) { es.AddOrderModifierItem(m.Amount, gm.Product, g.ProductGroup, order, item); continue; }
                    }
                    var sm = product.GetSimpleModifiers(null).FirstOrDefault(x => x.Product.Id == m.Id);
                    if (sm != null) { es.AddOrderModifierItem(m.Amount, sm.Product, null, order, item); continue; }
                    // группа не совпала — ищем модификатор в любой группе блюда
                    foreach (var g2 in product.GetGroupModifiers(null))
                    {
                        var x2 = g2.Items.FirstOrDefault(x => x.Product.Id == m.Id);
                        if (x2 != null) { es.AddOrderModifierItem(m.Amount, x2.Product, g2.ProductGroup, order, item); break; }
                    }
                }
                catch (Exception ex) { PluginContext.Log.Warn($"Официанты Патрики: модификатор «{m.Name}» не добавлен — {ex.Message}"); }
            }
        }

        /* ================= столы ================= */

        private static List<ITable> HostTables() =>
            PluginContext.Operations.GetHostTerminalRestaurantSections().SelectMany(s => s.Tables).Where(t => t.IsActive).ToList();

        private static string TableName(ITable t) => string.IsNullOrWhiteSpace(t.Name) ? $"Стол {t.Number}" : t.Name.Trim();

        /// <summary>Стол по id кассы; если id из облака не совпал — по названию / номеру (только однозначно).</summary>
        private static ITable FindTable(WaiterOrder o)
        {
            try { var t = PluginContext.Operations.GetTableById(o.TableId); if (t != null) return t; } catch { /* нет такого id */ }
            var all = HostTables();
            var label = Inbox.Norm(o.Table);
            var hit = all.Where(t => Inbox.Norm(TableName(t)) == label || Inbox.Norm("Стол " + t.Number) == label).ToList();
            if (hit.Count != 1)
            {
                var digits = new string((o.Table ?? "").Where(char.IsDigit).ToArray());
                if (digits.Length > 0 && int.TryParse(digits, out var n)) hit = all.Where(t => t.Number == n).ToList();
            }
            return hit.Count == 1 ? hit[0] : null;
        }

        /// <summary>Схема залов этой кассы — приложение показывает именно её столы (с id кассы).</summary>
        private static List<object> Layout() =>
            PluginContext.Operations.GetHostTerminalRestaurantSections()
                .Select(s => (object)new Dictionary<string, object>
                {
                    ["id"] = s.Id.ToString(),
                    ["name"] = s.Name ?? "",
                    ["tables"] = s.Tables.Where(t => t.IsActive).OrderBy(t => t.Number).Select(t => (object)new Dictionary<string, object>
                    {
                        ["id"] = t.Id.ToString(), ["number"] = t.Number, ["name"] = TableName(t), ["seats"] = t.SeatingCapacity,
                    }).ToList(),
                }).ToList();

        /* ================= снимок открытых заказов ================= */

        private static Dictionary<string, object> Snapshot()
        {
            var map = new Dictionary<string, object>();
            try { map["_layout"] = Layout(); } catch (Exception ex) { PluginContext.Log.Warn("Официанты Патрики: схема залов — " + ex.Message); }
            foreach (var o in PluginContext.Operations.GetOrders())
            {
                if (o.Status != OrderStatus.New && o.Status != OrderStatus.Bill) continue;
                if (o.Tables == null || o.Tables.Count == 0) continue;
                var items = o.Items.OfType<IOrderProductItem>().Where(i => !i.Deleted).Select(i => (object)new Dictionary<string, object>
                {
                    ["name"] = i.Product?.Name ?? "Позиция",
                    ["amount"] = i.Amount,
                    ["sum"] = i.ResultSum,
                    ["mods"] = i.AssignedModifiers.Where(m => !m.Deleted).Select(m => m.Product?.Name).Where(n => !string.IsNullOrEmpty(n)).ToList(),
                }).ToList();
                var info = new Dictionary<string, object>
                {
                    ["id"] = o.Id.ToString(),
                    ["number"] = o.Number,
                    ["status"] = o.Status == OrderStatus.Bill ? "Bill" : "New",
                    ["sum"] = o.ResultSum,
                    ["waiter"] = o.Waiter?.Name ?? "",
                    ["created"] = o.OpenTime.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
                    ["guests"] = o.Guests.Count,
                    ["items"] = items,
                };
                foreach (var t in o.Tables)
                {
                    var k = t.Id.ToString();
                    if (!map.TryGetValue(k, out var list)) map[k] = list = new List<object>();
                    ((List<object>)list).Add(info);
                }
            }
            return map;
        }
    }

    /* ================= данные ================= */

    internal sealed class WaiterOrder
    {
        public string Id;
        public Guid TableId;
        public string Table;
        public int Guests;
        public Guid? WaiterId;
        public string Waiter;
        public List<WaiterLine> Lines = new List<WaiterLine>();

        public static WaiterOrder From(Dictionary<string, object> d)
        {
            var o = new WaiterOrder
            {
                Id = S(d, "id"),
                TableId = G(d, "tableId") ?? Guid.Empty,
                Table = S(d, "table") ?? "Стол",
                Guests = I(d, "guests"),
                WaiterId = G(d, "waiterId"),
                Waiter = S(d, "waiter") ?? "",
            };
            if (d.TryGetValue("items", out var items) && items is IEnumerable list)
                foreach (var x in list)
                    if (x is Dictionary<string, object> i)
                    {
                        var line = new WaiterLine
                        {
                            ProductId = G(i, "productId") ?? Guid.Empty,
                            Name = S(i, "name") ?? "",
                            Amount = M(i, "amount"),
                            SizeId = G(i, "sizeId"),
                            Comment = S(i, "comment"),
                        };
                        if (i.TryGetValue("mods", out var mods) && mods is IEnumerable ml)
                            foreach (var y in ml)
                                if (y is Dictionary<string, object> m)
                                    line.Mods.Add(new WaiterMod { Id = G(m, "id") ?? Guid.Empty, GroupId = G(m, "groupId"), Name = S(m, "name") ?? "", Amount = Math.Max(1, I(m, "amount")) });
                        if (line.ProductId != Guid.Empty && line.Amount > 0) o.Lines.Add(line);
                    }
            return o;
        }

        private static string S(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;
        private static Guid? G(Dictionary<string, object> d, string k) => Guid.TryParse(S(d, k) ?? "", out var g) ? g : (Guid?)null;
        private static int I(Dictionary<string, object> d, string k) { try { return Convert.ToInt32(d.TryGetValue(k, out var v) && v != null ? v : 0, CultureInfo.InvariantCulture); } catch { return 0; } }
        private static decimal M(Dictionary<string, object> d, string k) { try { return Convert.ToDecimal(d.TryGetValue(k, out var v) && v != null ? v : 0, CultureInfo.InvariantCulture); } catch { return 0; } }
    }

    internal sealed class WaiterLine
    {
        public Guid ProductId;
        public string Name;
        public decimal Amount;
        public Guid? SizeId;
        public string Comment;
        public List<WaiterMod> Mods = new List<WaiterMod>();
    }

    internal sealed class WaiterMod
    {
        public Guid Id;
        public Guid? GroupId;
        public string Name;
        public int Amount;
    }
}
