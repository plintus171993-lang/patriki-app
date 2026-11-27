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
    /// Оплата баллами: по QR гостя баллы списываются и в заказ добавляется оплата «Баллы Патрики» (1.7; если такого типа оплаты нет — скидка, как раньше).
    /// Ланч-карта (2.0): за ланчи в чеке гостю ставятся штампы (сервер, по позициям чека); набрал — ланч в подарок скидкой «Ланч в подарок».
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

            // 1.7: платёжная система «Баллы Патрики» — для типа оплаты баллами (отдельная строка в отчёте 48)
            try { subscriptions.Add(PluginContext.Operations.RegisterPaymentSystem(new PointsPayment(), false, Resto.Front.Api.Data.Payments.FiscalPaymentTypeGroup.Default)); }
            catch (Exception ex) { PluginContext.Log.Error("Карта Патрики: не удалось зарегистрировать платёжную систему «Баллы Патрики»", ex); }

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
                // 2.1: в заказе несколько ланчей — можно добавить ещё гостей с ланч-картой (по одному на ланч)
                if (bound != null && LunchSlots(order, bound) > 0)
                {
                    var lunches = LunchCount(order, bound.LunchProductIds);
                    var cards = 1 + bound.LunchGuests.Count;
                    if (vm.ShowYesNoPopup(Sender, $"К заказу привязан гость: {bound.Name}.\nВ заказе ланчей: {lunches}, ланч-карт: {cards}.\n\nДобавить ещё гостя с ланч-картой (по его QR)?"))
                    {
                        AddLunchGuest(order, os, vm, bound);
                        return;
                    }
                }
                if (bound != null && (bound.Redeemed > 0 || bound.AnyLunchGift()))
                {
                    // гость уже оплатил часть баллами / получил ланч в подарок — менять гостя можно только отменив это
                    var what = string.Join(" и ", new[] { bound.Redeemed > 0 ? $"оплата баллами ({bound.Redeemed})" : null, bound.AnyLunchGift() ? "ланч в подарок" : null }.Where(x => x != null));
                    if (!vm.ShowYesNoPopup(Sender,
                        $"К заказу привязан гость: {bound.Name}. В заказе: {what}.\n\nОтменить (скидки уберутся из заказа, баллы и штампы вернутся гостю) и отвязать гостя?"))
                        return;
                    vm.ChangeProgressBarMessage("Возвращаем баллы и штампы…");
                    var back = CancelRedeem(order, os, vm, bound);
                    Store.RemoveGuest(order.Id);
                    vm.ShowOkPopup(Sender, $"Отменено{(back > 0 ? $", гостю возвращено {back} баллов" : "")}. Гость отвязан от заказа.");
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
                var guest = new BoundGuest { Code = closeCode, Name = g.Name, Balance = g.Balance, Tier = g.TierText,
                    LunchProductIds = g.Lunch?.ProductIds?.ToList() ?? new List<string>() };
                Store.SetGuest(order.Id, guest);

                var info = $"{g.Name}\nУровень: {g.TierText}\nБаланс: {g.Balance} баллов" +
                    (g.Legacy ? "\n(старая карта — приложение ещё не установлено)" : "") +
                    (g.Lunch.Enabled ? "\n" + g.Lunch.Text : "");
                // 2.0: ланч-карта — сначала подарок (уменьшает чек), потом баллы
                info += OfferLunchGift(order, os, vm, code, g, guest);
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

        /* ---------------- ланч-карта: каждый N-й ланч в подарок (2.0) ---------------- */

        /// <summary>Предложить «Ланч в подарок», если гость набрал штампы и в заказе есть ланч. Возвращает строку для итогового окна.</summary>
        private string OfferLunchGift(IOrder order, IOperationService os, IViewManager vm, string code, GuestInfo g, BoundGuest guest)
        {
            var l = g.Lunch;
            if (l == null || !l.Enabled || !l.Ready || guest.LunchGiftId != null) return "";
            if (guest.LunchGiftCount() >= LunchCount(order, guest.LunchProductIds)) return "";
            var lunch = LunchItems(order, l).FirstOrDefault();
            if (lunch == null) return "\nМожно взять ланч в подарок: добавьте ланч в заказ и снова нажмите «Карта Патрики».";
            if (!code.StartsWith("PK1:", StringComparison.Ordinal)) return "\nЛанч в подарок — только по QR-коду из приложения гостя.";
            var type = LunchDiscountType();
            if (type == null)
            {
                PluginContext.Log.Warn($"Карта Патрики: в iiko нет активной скидки «{Config.Current.LunchGiftDiscount}» на произвольную сумму — ланч в подарок недоступен");
                return $"\nЛанч в подарок не настроен: в iiko нет скидки «{Config.Current.LunchGiftDiscount}».";
            }
            var price = Math.Round(lunch.Price, 2);
            if (price <= 0) return "";
            if (!vm.ShowYesNoPopup(Sender, $"{g.Name}\n{l.Text}\n\nПровести ланч в подарок?\nНа один «{lunch.Product?.Name}» будет скидка {price:0} ₽."))
                return "\nЛанч в подарок не проведён — штампы остались у гостя.";
            vm.ChangeProgressBarMessage("Оформляем ланч в подарок…");
            var id = Api.LunchGift(code, order.Id);   // ошибки сервера — ApiException, их покажет кнопка
            try
            {
                SetLunchGiftDiscount(order, os, vm, type, price * (guest.LunchGiftCount() + 1));
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error("Карта Патрики: не удалось добавить скидку «Ланч в подарок»", ex);
                try { Api.LunchGiftCancel(id); } catch (Exception ex2) { PluginContext.Log.Warn($"Карта Патрики: штампы не вернулись ({id}) — {ex2.Message}"); }
                vm.ShowErrorPopup("Не удалось добавить скидку «Ланч в подарок», штампы возвращены гостю: " + ex.Message);
                return "";
            }
            guest.LunchGiftId = id;
            Store.SetGuest(order.Id, guest);
            return $"\n🎁 Ланч в подарок: скидка {price:0} ₽ добавлена в заказ.";
        }

        private static List<IOrderProductItem> LunchItems(IOrder order, LunchInfo l) =>
            order.Items.OfType<IOrderProductItem>()
                .Where(i => !i.Deleted && i.Product != null && l.ProductIds.Contains(i.Product.Id.ToString()))
                .ToList();

        private static IDiscountType LunchDiscountType()
        {
            var name = (Config.Current.LunchGiftDiscount ?? "").Trim();
            if (name.Length == 0) return null;
            return PluginContext.Operations.GetDiscountTypes()
                .FirstOrDefault(d => !d.Deleted && d.IsActive && d.DiscountByFlexibleSum && string.Equals((d.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase));
        }

        private static List<IDiscountItem> LunchGiftItems(IOrder order)
        {
            var name = (Config.Current.LunchGiftDiscount ?? "").Trim();
            if (name.Length == 0) return new List<IDiscountItem>();
            return order.Discounts.Where(d => string.Equals((d.DiscountType?.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase)).ToList();
        }

        private static bool HasLunchGift(IOrder order) => LunchGiftItems(order).Count > 0;

        /* ---------------- 2.1: несколько ланч-карт в одном заказе ---------------- */

        private static int LunchCount(IOrder order, IEnumerable<string> productIds)
        {
            var ids = new HashSet<string>(productIds ?? Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
            if (ids.Count == 0) return 0;
            return (int)Math.Floor(order.Items.OfType<IOrderProductItem>()
                .Where(i => !i.Deleted && i.Product != null && ids.Contains(i.Product.Id.ToString()))
                .Sum(i => i.Amount));
        }

        /// <summary>Сколько ещё гостей с ланч-картой можно добавить: ланчей в заказе минус уже привязанные карты.</summary>
        private static int LunchSlots(IOrder order, BoundGuest bound) =>
            Math.Max(0, LunchCount(order, bound.LunchProductIds) - 1 - (bound.LunchGuests?.Count ?? 0));

        /// <summary>Скидка «Ланч в подарок» одна на заказ: при нескольких подарках — на их общую сумму.</summary>
        private static void SetLunchGiftDiscount(IOrder order, IOperationService os, IViewManager vm, IDiscountType type, decimal total)
        {
            var creds = CredentialsFor(os, vm);
            var existing = LunchGiftItems(order);
            if (existing.Count > 0)
            {
                foreach (var d in existing) os.DeleteDiscount(d, order, creds);
                order = os.GetOrderById(order.Id);
            }
            if (total > 0) os.AddFlexibleSumDiscount(total, type, order, creds);
        }

        private void AddLunchGuest(IOrder order, IOperationService os, IViewManager vm, BoundGuest bound)
        {
            var settings = new ExtendedInputDialogSettings
            {
                EnableBarcode = true,
                TabTitleBarcode = "QR-код",
                NumericInputMode = NumericInputMode.String,
                TabTitleNumericString = "QR-код (вручную)",
            };
            var input = vm.ShowExtendedInputDialog(Sender, "Отсканируйте QR-код из приложения «Патрики» следующего гостя с ланчем", settings);
            string code;
            switch (input)
            {
                case null: return;
                case BarcodeInputDialogResult b: code = b.Barcode; break;
                case StringInputDialogResult s: code = s.Result; break;
                default: return;
            }
            code = NormalizeCode(code);
            if (code.Length == 0) return;
            if (!code.StartsWith("PK1:", StringComparison.Ordinal))
            {
                vm.ShowErrorPopup("Ланч-карта — только по QR-коду из приложения гостя (не по номеру карты или телефону).");
                return;
            }
            vm.ChangeProgressBarMessage("Ищем гостя…");
            var g = Api.Lookup(code);
            var card = string.IsNullOrEmpty(g.CardNo) ? code : g.CardNo;
            if (card == bound.Code || bound.LunchGuests.Any(x => x.Code == card))
            {
                vm.ShowErrorPopup($"{g.Name}: эта ланч-карта уже есть в заказе. У каждого гостя — своя карта.");
                return;
            }
            if (g.Lunch == null || !g.Lunch.Enabled)
            {
                vm.ShowErrorPopup("Акция «Ланч-карта» сейчас выключена.");
                return;
            }
            // заказ мог измениться, пока сканировали
            order = os.GetOrderById(order.Id);
            if (LunchSlots(order, bound) <= 0)
            {
                vm.ShowErrorPopup("Ланч-карт уже столько же, сколько ланчей в заказе. Добавьте ланч в заказ.");
                return;
            }
            var lg = new LunchGuest { Code = card, Name = g.Name };
            bound.LunchGuests.Add(lg);
            Store.SetGuest(order.Id, bound);

            var msg = $"{g.Name} добавлен к заказу.\n{g.Lunch.Text}";
            if (g.Lunch.Ready && bound.LunchGiftCount() < LunchCount(order, bound.LunchProductIds))
            {
                var lunch = LunchItems(order, g.Lunch).FirstOrDefault();
                var type = LunchDiscountType();
                var price = lunch != null ? Math.Round(lunch.Price, 2) : 0m;
                if (type != null && price > 0 && vm.ShowYesNoPopup(Sender, $"{g.Name}\n{g.Lunch.Text}\n\nПровести этому гостю ланч в подарок?\nСкидка «{type.Name}» увеличится на {price:0} ₽."))
                {
                    vm.ChangeProgressBarMessage("Оформляем ланч в подарок…");
                    var id = Api.LunchGift(code, order.Id);
                    try
                    {
                        SetLunchGiftDiscount(order, os, vm, type, price * (bound.LunchGiftCount() + 1));
                        lg.GiftId = id;
                        Store.SetGuest(order.Id, bound);
                        msg += $"\n🎁 Ланч в подарок: скидка +{price:0} ₽.";
                    }
                    catch (Exception ex)
                    {
                        PluginContext.Log.Error("Карта Патрики: не удалось добавить скидку «Ланч в подарок» (доп. гость)", ex);
                        try { Api.LunchGiftCancel(id); } catch (Exception ex2) { PluginContext.Log.Warn($"Карта Патрики: штампы не вернулись ({id}) — {ex2.Message}"); }
                        msg += "\nНе удалось добавить скидку — штампы возвращены гостю.";
                    }
                }
            }
            var lunches = LunchCount(order, bound.LunchProductIds);
            vm.ShowOkPopup(Sender, msg + $"\n\nЛанч-карт в заказе: {1 + bound.LunchGuests.Count} из {lunches}. Отметки поставятся после закрытия.");
        }

        /* ---------------- оплата баллами ---------------- */

        /// <summary>
        /// Предложить оплату баллами. true — диалог с бармену показан (итоговое окно уже было),
        /// false — оплату баллами не предлагали, вызывающий показывает обычное окно.
        /// </summary>
        private bool OfferRedeem(IOrder order, IOperationService os, IViewManager vm, string code, GuestInfo g, BoundGuest guest, string info)
        {
            var cfg = Config.Current;
            if ((string.IsNullOrWhiteSpace(cfg.RedeemPayment) && string.IsNullOrWhiteSpace(cfg.RedeemDiscount)) || g.Legacy || g.Balance <= 0 || g.MaxRedeemPct <= 0) return false;
            if (!code.StartsWith("PK1:", StringComparison.Ordinal))
            {
                vm.ShowOkPopup(Sender, info + "\n\nГость привязан к заказу. Баллы начислятся после закрытия." +
                    "\n\nОплатить баллами можно только по QR-коду из приложения гостя (не по номеру карты или телефону).");
                return true;
            }
            // 1.7: в первую очередь — тип оплаты (виден в отчёте 48), запасной вариант — скидка, как в 1.2–1.6
            var payType = RedeemPaymentType();
            var type = payType == null ? RedeemDiscountType() : null;
            if (payType == null && type == null)
            {
                PluginContext.Log.Warn($"Карта Патрики: в iiko нет ни типа оплаты «{cfg.RedeemPayment}», ни скидки «{cfg.RedeemDiscount}» — оплата баллами недоступна");
                vm.ShowOkPopup(Sender, info + "\n\nГость привязан к заказу. Баллы начислятся после закрытия." +
                    $"\n\nОплата баллами не настроена: в iiko нет типа оплаты «{cfg.RedeemPayment}».");
                return true;
            }
            // уже внесённые баллами суммы не считаем частью чека
            var sum = order.ResultSum - RedeemPaidSum(order);
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

            string what;
            try
            {
                var creds = CredentialsFor(os, vm);
                if (payType != null)
                {
                    // оплата баллами — отдельный тип оплаты: в отчёте 48 «Итого по смене» своя строка
                    PointsPayment.AddingFor = order.Id.ToString();
                    try
                    {
                        if (payType.Kind == Resto.Front.Api.Data.Payments.PaymentTypeKind.External)
                            // своя платёжная система: при оплате iiko только сверит сумму (PointsPayment.Pay)
                            os.AddExternalPaymentItem(points, false, null, null, payType, order, creds);
                        else if (payType.CanBeExternalProcessed)
                            os.AddExternalPaymentItem(points, true, null, null, payType, order, creds);
                        else
                            os.AddPaymentItem(points, null, payType, order, creds);
                    }
                    finally { PointsPayment.AddingFor = ""; }
                    what = $"оплата «{payType.Name}»";
                }
                else
                {
                    os.AddFlexibleSumDiscount(points, type, order, creds);
                    what = $"скидка «{type.Name}»";
                }
            }
            catch (Exception ex)
            {
                PluginContext.Log.Error($"Карта Патрики: не удалось добавить {(payType != null ? "оплату" : "скидку")} баллами", ex);
                try { Api.RedeemCancel(r.Id); } catch (Exception ex2) { PluginContext.Log.Error($"Карта Патрики: не удалось вернуть баллы ({r.Id})", ex2); }
                vm.ShowErrorPopup("Не удалось провести оплату баллами в заказе, баллы возвращены гостю: " + ex.Message);
                return true;
            }

            guest.RedeemIds.Add(r.Id);
            guest.Redeemed += points;
            guest.Balance = r.Balance;
            Store.SetGuest(order.Id, guest);
            vm.ShowOkPopup(Sender, $"Списано {points} баллов — {what} добавлена в заказ." +
                (payType != null ? $"\nОстаток к оплате гость платит как обычно (наличные / карта)." : "") +
                $"\nОстаток у гостя: {r.Balance} баллов.");
            return true;
        }

        /// <summary>Отменить оплату баллами: убрать оплату / скидку из заказа и вернуть баллы. Возвращает, сколько вернули.</summary>
        private static int CancelRedeem(IOrder order, IOperationService os, IViewManager vm, BoundGuest guest)
        {
            var creds = CredentialsFor(os, vm);
            foreach (var p in RedeemPaymentItems(order))
            {
                try
                {
                    if (p.IsExternal) os.DeleteExternalPaymentItem(p, order, creds);
                    else os.DeletePaymentItem(p, order, creds);
                }
                catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось убрать оплату баллами — {ex.Message}"); }
            }
            foreach (var d in RedeemDiscountItems(order).Concat(guest.AnyLunchGift() ? LunchGiftItems(order) : new List<IDiscountItem>()))
            {
                try { os.DeleteDiscount(d, order, creds); }
                catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось убрать скидку — {ex.Message}"); }
            }
            if (guest.LunchGiftId != null)
            {
                try { Api.LunchGiftCancel(guest.LunchGiftId); }
                catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось вернуть штампы ({guest.LunchGiftId}) — {ex.Message}"); }
                guest.LunchGiftId = null;
            }
            foreach (var lg in guest.LunchGuests.Where(x => x.GiftId != null))
            {
                try { Api.LunchGiftCancel(lg.GiftId); }
                catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: не удалось вернуть штампы ({lg.GiftId}) — {ex.Message}"); }
            }
            guest.LunchGuests.Clear();
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
            if (guest.RedeemIds.Count == 0 && !guest.AnyLunchGift()) return;
            Task.Run(() =>
            {
                foreach (var lg in guest.LunchGuests.Where(x => x.GiftId != null))
                {
                    try { Api.LunchGiftCancel(lg.GiftId); }
                    catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: заказ {order.Number} удалён, штампы ({lg.GiftId}) не вернулись — {ex.Message}"); }
                }
                if (guest.LunchGiftId != null)
                {
                    try { Api.LunchGiftCancel(guest.LunchGiftId); }
                    catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: заказ {order.Number} удалён, штампы ({guest.LunchGiftId}) не вернулись — {ex.Message}"); }
                }
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

        /// <summary>Тип оплаты «Баллы Патрики» (1.7), если он заведён в iiko и включён.</summary>
        private static Resto.Front.Api.Data.Payments.IPaymentType RedeemPaymentType()
        {
            var name = (Config.Current.RedeemPayment ?? "").Trim();
            if (name.Length == 0) return null;
            try
            {
                // сначала — тип оплаты, привязанный к нашей платёжной системе, затем — просто по названию
                return PluginContext.Operations.GetActivePaymentTypes(PointsPayment.Key).FirstOrDefault()
                    ?? PluginContext.Operations.GetPaymentTypes()
                        .FirstOrDefault(p => p.IsEnabled && string.Equals((p.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase));
            }
            catch (Exception ex)
            {
                PluginContext.Log.Warn($"Карта Патрики: не удалось получить типы оплат — {ex.Message}");
                return null;
            }
        }

        private static List<Resto.Front.Api.Data.Payments.IPaymentItem> RedeemPaymentItems(IOrder order)
        {
            var name = (Config.Current.RedeemPayment ?? "").Trim();
            if (order.Payments == null) return new List<Resto.Front.Api.Data.Payments.IPaymentItem>();
            HashSet<Guid> ours;
            try { ours = new HashSet<Guid>(PluginContext.Operations.GetActivePaymentTypes(PointsPayment.Key).Select(t => t.Id)); }
            catch { ours = new HashSet<Guid>(); }
            return order.Payments.Where(p => p.Type != null &&
                (ours.Contains(p.Type.Id) || (name.Length > 0 && string.Equals((p.Type.Name ?? "").Trim(), name, StringComparison.OrdinalIgnoreCase)))).ToList();
        }

        /// <summary>Сколько уже внесено баллами оплатой (для скидки — 0: она и так уменьшает ResultSum).</summary>
        private static decimal RedeemPaidSum(IOrder order) => RedeemPaymentItems(order).Sum(p => p.Sum);

        /// <summary>В заказе есть оплата баллами — оплатой (1.7) или скидкой (1.2–1.6).</summary>
        private static bool HasRedeemDiscount(IOrder order) => RedeemPaymentItems(order).Count > 0 || RedeemDiscountItems(order).Count > 0;

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
                else if (HasRedeemDiscount(order) || HasLunchGift(order)) Task.Run(() =>
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
                // ланч в подарок: скидку оставили — подарок проведён, убрали вручную — штампы вернутся
                request.LunchGift = guest.AnyLunchGift() ? HasLunchGift(order) : (bool?)null;
                // 2.1: дополнительные гости с ланч-картой — каждому штамп за свой ланч
                request.LunchGuests = guest.LunchGuests.Select(x => x.Code).ToList();
                // оплаченное баллами (оплатой) не считается покупкой — как было со скидкой
                request.Sum -= RedeemPaidSum(order);
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
