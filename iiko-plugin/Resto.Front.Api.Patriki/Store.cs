using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace Resto.Front.Api.Patriki
{
    public sealed class BoundGuest
    {
        public string Code { get; set; }
        public string Name { get; set; }
        public int Balance { get; set; }
        public string Tier { get; set; }
        public DateTime At { get; set; } = DateTime.Now;
    }

    /// <summary>Какой гость привязан к какому открытому заказу (переживает перезапуск кассы).</summary>
    internal static class Store
    {
        private static readonly object Sync = new object();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static Dictionary<string, BoundGuest> guests = new Dictionary<string, BoundGuest>();
        private static string FilePath => Path.Combine(PluginContext.Integration.GetConfigsDirectoryPath(), "patriki-guests.json");

        public static void Init()
        {
            lock (Sync)
            {
                try
                {
                    if (File.Exists(FilePath))
                        guests = Json.Deserialize<Dictionary<string, BoundGuest>>(File.ReadAllText(FilePath, Encoding.UTF8)) ?? new Dictionary<string, BoundGuest>();
                    // привязки старше 3 суток — мусор
                    foreach (var k in guests.Where(g => g.Value.At < DateTime.Now.AddDays(-3)).Select(g => g.Key).ToList()) guests.Remove(k);
                }
                catch (Exception ex)
                {
                    PluginContext.Log.Error("Карта Патрики: не удалось прочитать привязки гостей", ex);
                    guests = new Dictionary<string, BoundGuest>();
                }
            }
        }

        public static BoundGuest GetGuest(Guid orderId)
        {
            lock (Sync) return guests.TryGetValue(orderId.ToString(), out var g) ? g : null;
        }

        public static void SetGuest(Guid orderId, BoundGuest g)
        {
            lock (Sync) { guests[orderId.ToString()] = g; Save(); }
        }

        public static void RemoveGuest(Guid orderId)
        {
            lock (Sync) { if (guests.Remove(orderId.ToString())) Save(); }
        }

        private static void Save()
        {
            try { File.WriteAllText(FilePath, Json.Serialize(guests), Encoding.UTF8); }
            catch (Exception ex) { PluginContext.Log.Error("Карта Патрики: не удалось сохранить привязки гостей", ex); }
        }
    }

    /// <summary>Чеки, которые не удалось отправить из-за связи. Повтор до 24 часов.</summary>
    internal static class Queue
    {
        public sealed class Entry
        {
            public CloseRequest Request { get; set; }
            public DateTime Added { get; set; }
        }

        private static readonly object Sync = new object();
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static string FilePath => Path.Combine(PluginContext.Integration.GetConfigsDirectoryPath(), "patriki-queue.json");

        public static void Add(CloseRequest r)
        {
            lock (Sync)
            {
                var list = Load();
                if (list.All(e => e.Request.OrderId != r.OrderId)) list.Add(new Entry { Request = r, Added = DateTime.Now });
                Save(list);
            }
        }

        public static void Flush()
        {
            List<Entry> list;
            lock (Sync) list = Load();
            if (list.Count == 0) return;

            var keep = new List<Entry>();
            foreach (var e in list)
            {
                if (e.Added < DateTime.Now.AddHours(-24))
                {
                    PluginContext.Log.Warn($"Карта Патрики: заказ {e.Request.Number} не отправлен за 24 часа, удалён из очереди");
                    continue;
                }
                try
                {
                    var r = Api.Close(e.Request);
                    PluginContext.Log.Info($"Карта Патрики: из очереди отправлен заказ {e.Request.Number}, +{r.Points}");
                }
                catch (ApiException ex)
                {
                    PluginContext.Log.Warn($"Карта Патрики: заказ {e.Request.Number} из очереди — {ex.Message}");
                }
                catch (Exception)
                {
                    keep.Add(e); // всё ещё нет связи
                }
            }
            lock (Sync)
            {
                // за время отправки могли добавиться новые чеки — сохраняем и их
                var sent = new HashSet<string>(list.Select(e => e.Request.OrderId));
                keep.AddRange(Load().Where(e => !sent.Contains(e.Request.OrderId)));
                Save(keep);
            }
        }

        private static List<Entry> Load()
        {
            try
            {
                return File.Exists(FilePath) ? Json.Deserialize<List<Entry>>(File.ReadAllText(FilePath, Encoding.UTF8)) ?? new List<Entry>() : new List<Entry>();
            }
            catch { return new List<Entry>(); }
        }

        private static void Save(List<Entry> list)
        {
            try { File.WriteAllText(FilePath, Json.Serialize(list), Encoding.UTF8); }
            catch (Exception ex) { PluginContext.Log.Error("Карта Патрики: не удалось сохранить очередь", ex); }
        }
    }
}
