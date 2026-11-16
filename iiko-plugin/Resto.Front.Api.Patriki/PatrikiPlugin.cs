using System;
using System.Collections.Generic;
using System.Linq;
using System.Reactive.Linq;
using System.Threading.Tasks;
using Resto.Front.Api.Attributes;
using Resto.Front.Api.Attributes.JetBrains;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.View;
using Resto.Front.Api.Extensions;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.Patriki
{
    /// <summary>
    /// «Карта Патрики»: бармен сканирует QR гостя из приложения «Патрики», при закрытии заказа
    /// плагин отправляет чек на сервер лояльности, сервер начисляет баллы.
    /// Оплата баллами: по QR гостя баллы списываются и в заказ добавляется скидка «Баллы Патрики».
    /// Заказ доставки из приложения (стол «Доставка») при закрытии отмечается выполненным — гостю начисляются баллы.
    /// На главной кассе ("Inbox": true) ещё и показывает заявки из приложения — брони и доставку (Inbox.cs).
    /// Установка: папка Plugins\Resto.Front.Api.Patriki рядом с iikoFront.exe.
    /// Лицензия — та же, что у внешних платёжных систем через API (iikoAPIPayment).
    /// </summary>
    [UsedImplicitly]
    [PluginLicenseModuleId(21016318)]
    public sealed class PatrikiPlugin : IFrontPlugin
    {
        private const string Sender = "Карта Патрики";
        // Значок «карта» для кнопки
        private const string CardIcon = "M 2,4 L 22,4 22,20 2,20 Z M 2,9 L 22,9";

        private readonly List<IDisposable> subscriptions = new List<IDisposable>();
        private readonly HashSet<Guid> sentOrders = new HashSet<Guid>();
        private readonly object sync = new object();

        public PatrikiPlugin()
        {
            PluginContext.Log.Info("Карта Патрики: запуск плагина");
            Store.Init();

            subscriptions.Add(PluginContext.Operations.AddButtonToOrderEditScreen("Карта Патрики", x => OnCardButton(x.order, x.os, x.vm), CardIcon));

            // Заказы, закрытые до запуска плагина, не трогаем
            foreach (var o in PluginContext.Operations.GetOrders().Where(o => o.Status == OrderStatus.Closed))
                sentOrders.Add(o.Id);

            subscriptions.Add(PluginContext.Notifications.OrderChanged
                .Select(e => e.Entity)
                .Where(o => o.Status == OrderStatus.Closed)
                .Subscribe(OnOrderClosed));

            // Заказ удалён — списанные баллами суммы возвращаем гостю
            subscriptions.Add(PluginContext.Notifications.OrderChanged
                .Select(e => e.Entity)
                .Where(o => o.Status == OrderStatus.Deleted)
                .Subscribe(OnOrderDeleted));

            // Заявки из приложения (брони и доставка) — только на главной кассе ("Inbox": true в patriki.json)
            if (Config.Current.Inbox && Config.Current.IsReady)
            {
                try { subscriptions.Add(new Inbox()); }
                catch (Exception ex) { PluginContext.Log.Error("Заявки Патрики: не удалось включить", ex); }
                // заказы из приложения официантов — тоже только на главной кассе
                try { subscriptions.Add(new Waiters()); }
                catch (Exception ex) { PluginContext.Log.Error("Официанты Патрики: не удалось включить", ex); }
            }
            else if (Config.Current.Inbox)
                PluginContext.Log.Warn("Заявки Патрики: включены, но в patriki.json не указан ключ кассы");

            // Очередь неотправленных чеков: повтор каждые 5 минут
            subscriptions.Add(Observable.Interval(TimeSpan.FromMinutes(5)).Subscribe(_ => Task.Run(() => Queue.Flush())));
            Task.Run(() => Queue.Flush());
        }

        public void Dispose()
        {
            foreach (var s in subscriptions)
            {
                try { s.Dispose(); } catch { /* соединение с фронтом могло быть потеряно */ }
            }
            subscriptions.Clear();
        }

        /* ---------------- кнопка в заказе ---------------- */
        private void OnCardButton(IOrder order, IOperationService os, IViewManager vm)
        {
            try
            {
                if (IsDeliveryOrder(order))
                {
                    vm.ShowOkPopup(Sender, "Это заказ доставки из приложения «Патрики».\n\nГость уже известен: баллы начислятся автоматически, когда заказ будет закрыт. Сканировать карту не нужно.");
                    return;
                }

                var bound = Store.GetGuest(order.Id);
                if (bound != null && bound.Redeemed > 0)
                {
                    // гость уже оплатил часть баллами — менять гостя можно только отменив оплату баллами
                    if (!vm.ShowYesNoPopup(Sender,
                        $"К заказу привязан гость: {bound.Name}. Оплачено баллами: {bound.Redeemed}.\n\nОтменить оплату баллами (скидка уберётся, баллы вернутся гостю) и отвязать гостя?"))
                        return;
                    vm.ChangeProgressBarMessage("Возвращаем баллы…");
                    var back = CancelRedeem(order, os, vm, bound);
                    Store.RemoveGuest(order.Id);
                    vm.ShowOkPopup(Sender, $"Оплата баллами отменена, гостю возвращено {back} баллов. Гость отвязан от заказа.");
                    return;
                }
                if (bound != null)
                {
                    var replace = vm.ShowYesNoPopup(Sender,
                        $"К заказу привязан гость: {bound.Name}, баланс {bound.Balance} баллов.\n\nЗаменить гостя? (Нет — отвязать)");
                    if (!replace)
                    {
                        Store.RemoveGuest(order.Id);
                        vm.ShowOkPopup(Sender, "Гость отвязан от заказа.");
                        return;
                    }
                }

                if (!Config.Current.IsReady)
                {
                    vm.ShowErrorPopup("Плагин не настроен: в файле настроек patriki.json не указан ключ кассы (posKey).");
                    return;
                }

                var settings = new ExtendedInputDialogSettings
                {
                    EnableBarcode = true,
                    TabTitleBarcode = "QR-код",
                    NumericInputMode = NumericInputMode.String,
                    TabTitleNumericString = "Номер карты",
                    EnablePhone = true,
                    TabTitlePhone = "Телефон",
                };
                var input = vm.ShowExtendedInputDialog(Sender, "Отсканируйте QR-код из приложения «Патрики» или введите номер карты / телефон", settings);
                string code;
                switch (input)
                {
                    case null: return; // отмена
                    case BarcodeInputDialogResult b: code = b.Barcode; break;
                    case StringInputDialogResult s: code = s.Result; break;
                    case PhoneInputDialogResult p: code = p.PhoneNumber; break;
                    case CardInputDialogResult c: code = c.Track2; break;
                    default: return;
                }
                code = NormalizeCode(code);
                if (code.Length == 0) return;

                vm.ChangeProgressBarMessage("Ищем гостя…");
                var g = Api.Lookup(code);

                // QR живёт около минуты, поэтому при закрытии отправляем номер карты (для старых карт — телефон)
                var closeCode = g.Legacy || string.IsNullOrEmpty(g.CardNo) ? code : g.CardNo;
                var guest = new BoundGuest { Code = closeCode, Name = g.Name, Balance = g.Balance, Tier = g.TierText };
                Store.SetGuest(order.Id, guest);

                var info = $"{g.Name}\nУровень: {g.TierText}\nБаланс: {g.Balance} баллов" +
                    (g.Legacy ? "\n(старая карта — приложение ещё не установлено)" : "");
                if (!OfferRedeem(order, os, vm, code, g, guest, info))
                    vm.ShowOkPopup(Sender, info + "\n\nГость привязан к заказу. Баллы начислятся после закрытия.");
            }
            catch (ApiException ex)
            {
                vm.ShowErrorPopup(ex.Message);
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Карта Патрики: ошибка кнопки", ex);
                vm.ShowErrorPopup("Не удалось проверить карту: " + ex.Message);
            }
        }

        /// <summary>
        /// Сканер работает как клавиатура: при русской раскладке «PK1:…» приходит как «ЗЛ1Ж…».
        /// Возвращаем латиницу, убираем пробелы и переводы строк.
        /// </summary>
        internal static string NormalizeCode(string code)
        {
            if (string.IsNullOrWhiteSpace(code)) return "";
            var map = new Dictionary<char, char> { ['З'] = 'P', ['з'] = 'P', ['Л'] = 'K', ['л'] = 'K', ['Ж'] = ':', ['ж'] = ':', ['p'] = 'P', ['k'] = 'K', [';'] = ':' };
            var chars = code.Trim().Where(c => !char.IsWhiteSpace(c)).Select(c => map.TryGetValue(c, out var m) ? m : c).ToArray();
            return new string(chars);
        }

        /* ---------------- оплата баллами ---------------- */

        /// <summary>
        /// Предложить оплату баллами. true — диалог с бармену показан (итоговое окно уже было),
        /// false — оплату баллами не предлагали, вызывающий показывает обычное окно.
        /// </summary>
        private bool OfferRedeem(IOrder order, IOperationService os, IViewManager vm, string code, GuestInfo g, BoundGuest guest, string info)
        {
            var cfg = Config.Current;
            if (string.IsNullOrWhiteSpace(cfg.RedeemDiscount) || g.Legacy || g.Balance <= 0 || g.MaxRedeemPct <= 0) return false;
            if (!code.StartsWith("PK1:", StringComparison.Ordinal))
            {
                vm.ShowOkPopup(Sender, info + "\n\nГость привязан к заказу. Баллы начислятся после закрытия." +
                    "\n\nОплатить баллами можно только по QR-коду из приложения гостя (не по номеру карты или телефону).");
                return true;
            }
            var type = RedeemDiscountType();
            if (type == null)
            {
                PluginContext.Log.Warn($"Карта Патрики: в iiko нет активной скидки «{cfg.RedeemDiscount}» на произвольную сумму — оплата баллами недоступна");
                vm.ShowOkPopup(Sender, info + "\n\nГость привязан к заказу. Баллы начислятся после закрытия." +
                    $"\n\nОплата баллами не настроена: в iiko нет скидки «{cfg.RedeemDiscount}» на произвольную сумму.");
                return true;
            }
            var sum = order.ResultSum;
            var max = Math.Min(g.Balance, (int)Math.Floor(sum * g.MaxRedeemPct / 100m));
            if (max <= 0) return false;

            if (!vm.ShowYesNoPopup(Sender, info + $"\n\nОплатить часть заказа баллами?\nМожно до {max} баллов ({g.MaxRedeemPct}% чека, 1 балл = 1 ₽)."))
            {
                vm.ShowOkPopup(Sender, "Гость привязан к заказу. Баллы начислятся после закрытия.");
                return true;
            }
            var input = vm.ShowInputDialog($"Сколько баллов списать? (до {max})", InputDialogTypes.Number, max) as NumberInputDialogResult;
            if (input == null) { vm.ShowOkPopup(Sender, "Баллы не списаны. Гость привязан к заказу."); return true; }
            var points = input.Number;
            if (points <= 0 || points > max)
            {
                vm.ShowErrorPopup($"Можно списать от 1 до {max} баллов. Баллы не списаны, гость привязан к заказу.");
                return true;
            }

            vm.ChangeProgressBarMessage("Списываем баллы…");
            RedeemResult r;
            try { r = Api.Redeem(code, order.Id, points, sum); }
            catch (ApiException ex) { vm.ShowErrorPopup("Баллы не списаны: " + ex.Message); return true; }

            try
            {
                os.AddFlexibleSumDiscount(points, type, order, CredentialsFor(os, vm));
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Карта Патрики: не удалось добавить скидку «Баллы Патрики»", ex);
                try { Api.RedeemCancel(r.Id); } catch (Exception ex2) { PluginContext.Log.Error($"Карта Патрики: не удалось вернуть баллы ({r.Id})", ex2); }
                vm.ShowErrorPopup("Не удалось добавить скидку в заказ, баллы возвращены гостю: " + ex.Message);
                return true;
            }

            guest.RedeemIds.Add(r.Id);
            guest.Redeemed += points;
            guest.Balance = r.Balance;
            Store.SetGuest(order.Id, guest);
            vm.ShowOkPopup(Sender, $"Списано {points} баллов — скидка «{Config.Current.RedeemDiscount}» добавлена в заказ.\nОстаток у гостя: {r.Balance} баллов.");
            return true;
        }

        /// <summary>Отменить оплату баллами: убрать скидку из заказа и вернуть баллы. Возвращает, сколько вернули.</summary>
        private static int CancelRedeem(IOrder order, IOperationService os, IViewManager vm, BoundGuest guest)
        {
            var creds = CredentialsFor(os, vm);
            foreach (var d in RedeemDiscountItems(order))
            {
                try { os.DeleteDiscount(d, order, creds); }
                catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось убрать скидку — {ex.Message}"); }
            }
            var back = 0;
            foreach (var id in guest.RedeemIds.ToList())
            {
                try { back += Api.RedeemCancel(id); }
                catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось вернуть баллы ({id}) — {ex.Message}"); }
            }
            guest.RedeemIds.Clear(); guest.Redeemed = 0;
            return back;
        }

        private void OnOrderDeleted(IOrder order)
        {
            var guest = Store.GetGuest(order.Id);
            if (guest == null) return;
            Store.RemoveGuest(order.Id);
            if (guest.RedeemIds.Count == 0) return;
            Task.Run(() =>
            {
                foreach (var id in guest.RedeemIds)
                {
                    try { Api.RedeemCancel(id); }
                    catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: заказ {order.Number} удалён, баллы ({id}) не вернулись — {ex.Message}. Сервер вернёт их сам через 48 часов."); }
                }
                PluginContext.Operations.AddNotificationMessage($"Заказ {order.Number} удалён — баллы гостя {guest.Name} возвращены", Sender, TimeSpan.FromSeconds(15));
            });
        }

        private static IDiscountType RedeemDiscountType()
        {
            var name = (Config.Current.RedeemDiscount ?? "").Trim();
            if (name.Length == 0) return null;
            return PluginContext.Operations.GetDiscountTypes()
                .FirstOrDefault(d => !d.Deleted && d.IsActive && d.DiscountByFlexibleSum && string.Equals((d.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase));
        }

        private static List<IDiscountItem> RedeemDiscountItems(IOrder order)
        {
            var name = (Config.Current.RedeemDiscount ?? "").Trim();
            if (name.Length == 0) return new List<IDiscountItem>();
            return order.Discounts.Where(d => string.Equals((d.DiscountType?.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        private static bool HasRedeemDiscount(IOrder order) => RedeemDiscountItems(order).Count > 0;

        private static Resto.Front.Api.Data.Security.ICredentials CredentialsFor(IOperationService os, IViewManager vm)
        {
            try { return os.GetDefaultCredentials(); }
            catch { return Inbox.Credentials(vm); }
        }

        /* ---------------- доставка из приложения ---------------- */

        private static bool IsDeliveryOrder(IOrder order)
        {
            var want = (Config.Current.DeliveryTable ?? "").Trim();
            if (want.Length == 0 || order.Tables == null) return false;
            return order.Tables.Any(t =>
                string.Equals((t.Name ?? "").Trim(), want, StringComparison.OrdinalIgnoreCase) ||
                t.Number.ToString(System.Globalization.CultureInfo.InvariantCulture) == want ||
                string.Equals((t.RestaurantSection?.Name ?? "").Trim(), want, StringComparison.OrdinalIgnoreCase));
        }

        private static void SendDeliveryDone(Guid orderId, int number)
        {
            try
            {
                if (Api.DeliveryDone(orderId))
                {
                    PluginContext.Operations.AddNotificationMessage($"Доставка {number} закрыта — гостю начислятся баллы", Sender, TimeSpan.FromSeconds(10));
                    PluginContext.Log.Info($"Карта Патрики: заказ доставки {number} отмечен выполненным");
                }
            }
            catch (ApiException ex)
            {
                PluginContext.Log.Warn($"Карта Патрики: доставка {number} — {ex.Message}");
            }
            catch (Exception)
            {
                Queue.Add(new CloseRequest { Kind = "done", OrderId = orderId.ToString(), Number = number, Venue = Config.Current.Venue });
            }
        }

        /* ---------------- закрытие заказа ---------------- */
        private void OnOrderClosed(IOrder order)
        {
            lock (sync)
            {
                if (sentOrders.Contains(order.Id)) return;
                sentOrders.Add(order.Id);
            }
            var guest = Store.GetGuest(order.Id);
            if (guest == null)
            {
                // заказ доставки из приложения: отмечаем выполненным, баллы начислит сервер
                if (IsDeliveryOrder(order)) Task.Run(() => SendDeliveryDone(order.Id, order.Number));
                // оплату баллами провели на другой кассе — фиксируем списание, чтобы сервер не вернул баллы через 48 часов
                else if (HasRedeemDiscount(order)) Task.Run(() =>
                {
                    try { Api.RedeemFinalize(order.Id, order.Number); }
                    catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: заказ {order.Number} — списание баллами не зафиксировано: {ex.Message}"); }
                });
                return; // обычный заказ без карты — ничего не отправляем
            }

            try
            {
                // скидку «Баллы Патрики» убрали вручную — возвращаем гостю баллы до отправки чека
                if (guest.Redeemed > 0 && !HasRedeemDiscount(order))
                {
                    foreach (var id in guest.RedeemIds.ToList())
                        try { Api.RedeemCancel(id); } catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось вернуть баллы ({id}) — {ex.Message}"); }
                    guest.RedeemIds.Clear(); guest.Redeemed = 0;
                }
                var request = CloseRequest.FromOrder(order, guest.Code, Config.Current.Venue);
                Store.RemoveGuest(order.Id);
                Task.Run(() => Send(request, guest.Name));
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error($"Карта Патрики: не удалось собрать чек заказа {order.Number}", ex);
            }
        }

        private static void Send(CloseRequest request, string guestName)
        {
            try
            {
                var r = Api.Close(request);
                var msg = r.Points > 0
                    ? $"{r.Name ?? guestName}: +{r.Points} баллов" + (r.DelayDays > 0 ? $" (придут через {r.DelayDays} дн.)" : "")
                    : (r.Note ?? $"{guestName}: баллы за этот чек не начисляются");
                PluginContext.Operations.AddNotificationMessage(msg, Sender, TimeSpan.FromSeconds(15));
                PluginContext.Log.Info($"Карта Патрики: заказ {request.Number} — {msg}");
            }
            catch (ApiException ex) when (ex.Message.Contains("уже проведён"))
            {
                PluginContext.Log.Info($"Карта Патрики: заказ {request.Number} уже был проведён");
            }
            catch (ApiException ex)
            {
                // ошибка сервера по существу (гость не найден и т.п.) — не повторяем
                PluginContext.Operations.AddNotificationMessage($"Баллы не начислены: {ex.Message}", Sender, TimeSpan.FromSeconds(30));
                PluginContext.Log.Warn($"Карта Патрики: заказ {request.Number} — {ex.Message}");
            }
            catch (Exception ex)
            {
                // нет связи — в очередь
                Queue.Add(request);
                PluginContext.Operations.AddNotificationMessage($"{guestName}: нет связи, баллы начислятся позже", Sender, TimeSpan.FromSeconds(15));
                PluginContext.Log.Warn($"Карта Патрики: заказ {request.Number} поставлен в очередь: {ex.Message}");
            }
        }
    }
}
