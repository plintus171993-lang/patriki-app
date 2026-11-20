using System;
using System.Collections.Generic;
using System.Linq;
using Resto.Front.Api.Data.Orders;
using Resto.Front.Api.Data.Organization;
using Resto.Front.Api.Data.Payments;
using Resto.Front.Api.Data.Security;
using Resto.Front.Api.Exceptions;
using Resto.Front.Api.UI;

namespace Resto.Front.Api.Patriki
{
    /// <summary>
    /// Платёжная система «Баллы Патрики» (1.7). Нужна, чтобы оплата баллами шла отдельным типом оплаты
    /// и была видна отдельной строкой в отчёте 48 «Итого по смене».
    ///
    /// В iikoOffice: Розничные продажи → Типы оплат → Добавить:
    ///   Наименование «Баллы Патрики», Тип «Внешний тип оплаты», Безналичный тип «Баллы Патрики»
    ///   (появляется в списке после запуска iikoFront с этим плагином), «Запрещать вводить вручную».
    ///
    /// Баллы списываются на сервере в момент нажатия «Карта Патрики» → «Оплатить баллами»,
    /// плагин сам добавляет оплату в заказ. Здесь только проверки:
    ///  • вручную на экране оплаты этот тип выбрать нельзя — только через кнопку «Карта Патрики»;
    ///  • при оплате заказа сверяем, что сумма совпадает со списанными баллами;
    ///  • возвраты/отмены возвращают баллы гостю, если это ещё возможно.
    /// </summary>
    internal sealed class PointsPayment : IPaymentProcessor
    {
        public const string Key = "PatrikiPoints";
        private const string Sender = "Карта Патрики";

        // заказ, в который плагин прямо сейчас сам добавляет оплату баллами (чтобы CollectData не мешал)
        internal static volatile string AddingFor = "";

        public string PaymentSystemKey => Key;
        public string PaymentSystemName => "Баллы Патрики";

        public void CollectData(Guid orderId, Guid paymentTypeId, IUser cashier, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context)
        {
            if (AddingFor == orderId.ToString()) return;
            // кассир выбрал «Баллы Патрики» на экране оплаты вручную — не даём: баллы списываются только по QR гостя
            throw new PaymentActionFailedException("Оплата баллами — только через кнопку «Карта Патрики» в заказе (по QR-коду из приложения гостя).");
        }

        public void OnPaymentAdded(IOrder order, IPaymentItem paymentItem, IUser cashier, IOperationService operations, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context) { }

        public bool OnPreliminaryPaymentEditing(IOrder order, IPaymentItem paymentItem, IUser cashier, IOperationService operations, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context) => false;

        public void OnPaymentDeleting(IOrder order, IPaymentItem paymentItem, IUser cashier, IOperationService operations, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context)
        {
            // баллы вернутся гостю при закрытии / удалении заказа (если оплаты баллами в нём не останется)
            PluginContext.Log.Info($"Карта Патрики: из заказа {order?.Number} убрана оплата баллами {paymentItem?.Sum}");
        }

        public void Pay(decimal sum, IOrder order, IPaymentItem paymentItem, Guid transactionId, IPointOfSale pointOfSale, IUser cashier, IOperationService operations, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context)
            => Check(sum, order);

        public bool CanPaySilently(decimal sum, Guid? orderId, Guid paymentTypeId, IPaymentDataContext context) => true;

        public void PaySilently(decimal sum, IOrder order, IPaymentItem paymentItem, Guid transactionId, IPointOfSale pointOfSale, IUser cashier, IReceiptPrinter printer, IPaymentDataContext context)
            => Check(sum, order);

        /// <summary>Сумма оплаты баллами должна быть подтверждена сервером (списана по QR гостя).</summary>
        private static void Check(decimal sum, IOrder order)
        {
            var guest = order == null ? null : Store.GetGuest(order.Id);
            // заказ могли начать на другой кассе — тогда привязки здесь нет; сервер всё равно держит списание за заказом
            if (guest == null) { PluginContext.Log.Warn($"Карта Патрики: оплата баллами {sum} в заказе {order?.Number} без привязки гостя на этой кассе"); return; }
            if (sum > guest.Redeemed + 0.01m)
                throw new PaymentActionFailedException($"Оплата баллами {sum:0} больше, чем списано у гостя ({guest.Redeemed}). Отмените оплату баллами через «Карта Патрики» и проведите заново.");
        }

        public void EmergencyCancelPayment(decimal sum, Guid? orderId, Guid paymentTypeId, Guid transactionId, IPointOfSale pointOfSale, IUser cashier, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context)
            => Return(sum, orderId, "аварийная отмена оплаты");

        public void EmergencyCancelPaymentSilently(decimal sum, Guid? orderId, Guid paymentTypeId, Guid transactionId, IPointOfSale pointOfSale, IUser cashier, IReceiptPrinter printer, IPaymentDataContext context)
            => Return(sum, orderId, "аварийная отмена оплаты");

        public void ReturnPayment(decimal sum, Guid? orderId, Guid paymentTypeId, Guid transactionId, IPointOfSale pointOfSale, IUser cashier, IReceiptPrinter printer, IViewManager viewManager, IPaymentDataContext context)
            => Return(sum, orderId, "возврат");

        public void ReturnPaymentSilently(decimal sum, Guid? orderId, Guid paymentTypeId, Guid transactionId, IPointOfSale pointOfSale, IUser cashier, IReceiptPrinter printer, IPaymentDataContext context)
            => Return(sum, orderId, "возврат");

        public void ReturnPaymentWithoutOrder(decimal sum, Guid? orderId, Guid paymentTypeId, IPointOfSale pointOfSale, IUser cashier, IReceiptPrinter printer, IViewManager viewManager)
            => Return(sum, orderId, "возврат без заказа");

        /// <summary>
        /// Возврат / отмена: пока заказ не закрыт — возвращаем баллы гостю. Возврат по уже закрытому чеку
        /// возврат не блокирует, но баллы нужно вернуть вручную (админка приложения) — пишем в лог и на экран.
        /// </summary>
        private static void Return(decimal sum, Guid? orderId, string what)
        {
            var guest = orderId.HasValue ? Store.GetGuest(orderId.Value) : null;
            if (guest != null && guest.RedeemIds.Count > 0)
            {
                var back = 0;
                foreach (var id in guest.RedeemIds.ToList())
                {
                    try { back += Api.RedeemCancel(id); }
                    catch (Exception ex) { PluginContext.Log.Warn($"Карта Патрики: {what} — не удалось вернуть баллы ({id}): {ex.Message}"); }
                }
                guest.RedeemIds.Clear(); guest.Redeemed = 0;
                Store.SetGuest(orderId.Value, guest);
                PluginContext.Operations.AddNotificationMessage($"Оплата баллами отменена ({what}) — гостю {guest.Name} возвращено {back} баллов", Sender, TimeSpan.FromSeconds(15));
                return;
            }
            PluginContext.Log.Warn($"Карта Патрики: {what} оплаты баллами {sum:0} по заказу {orderId} — баллы гостю вернуть вручную в админке приложения");
            PluginContext.Operations.AddNotificationMessage($"Возврат оплаты баллами {sum:0}: баллы гостю верните вручную в админке приложения", Sender, TimeSpan.FromSeconds(30));
        }
    }
}
