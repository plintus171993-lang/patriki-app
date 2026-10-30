using System;
using System.Collections.Generic;
using System.Linq;
using System.Reactive.Linq;
using System.Threading.Tasks;
using Resto.Front.Api.Attributes;
using Resto.Front.Api.Attributes.JetBrains;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.View;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.Patriki
{
    /// <summary>
    /// «Карта Патрики»: бармен сканирует QR гостя из приложения «Патрики», при закрытии заказа
    /// плагин отправляет чек на сервер лояльности, сервер начисляет баллы.
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

            subscriptions.Add(PluginContext.Operations.AddButtonToOrderEditScreen("Карта Патрики", x => OnCardButton(x.order, x.vm), CardIcon));

            // Заказы, закрытые до запуска плагина, не трогаем
            foreach (var o in PluginContext.Operations.GetOrders().Where(o => o.Status == OrderStatus.Closed))
                sentOrders.Add(o.Id);

            subscriptions.Add(PluginContext.Notifications.OrderChanged
                .Select(e => e.Entity)
                .Where(o => o.Status == OrderStatus.Closed)
                .Subscribe(OnOrderClosed));

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
        private void OnCardButton(IOrder order, IViewManager vm)
        {
            try
            {
                var bound = Store.GetGuest(order.Id);
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
                Store.SetGuest(order.Id, new BoundGuest { Code = closeCode, Name = g.Name, Balance = g.Balance, Tier = g.TierText });

                vm.ShowOkPopup(Sender,
                    $"{g.Name}\nУровень: {g.TierText}\nБаланс: {g.Balance} баллов" +
                    (g.Legacy ? "\n(старая карта — приложение ещё не установлено)" : "") +
                    "\n\nГость привязан к заказу. Баллы начислятся после закрытия.");
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

        /* ---------------- закрытие заказа ---------------- */
        private void OnOrderClosed(IOrder order)
        {
            lock (sync)
            {
                if (sentOrders.Contains(order.Id)) return;
                sentOrders.Add(order.Id);
            }
            var guest = Store.GetGuest(order.Id);
            if (guest == null) return; // заказ без карты — ничего не отправляем

            try
            {
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
