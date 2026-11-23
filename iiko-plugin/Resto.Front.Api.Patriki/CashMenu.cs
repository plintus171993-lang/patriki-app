using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Resto.Front.Api.Data.Assortment;
using Resto.Front.Api.Data.Orders;

namespace Resto.Front.Api.Patriki
{
    /// <summary>
    /// Меню приложения официантов, собранное прямо с кассы: все активные блюда и товары, которые кассир видит
    /// в меню iikoFront (включая «свободные» блюда с ценой на месте и позиции с кривыми названиями),
    /// с папками номенклатуры, ценами, размерами и модификаторами. Формат — как у меню из облака
    /// ({id, name, groups:[{id, name, items:[{id, name, price, sizeId, sizes?, mods, open?}]}]}).
    /// </summary>
    internal static class CashMenu
    {
        public static Dictionary<string, object> Build()
        {
            var os = PluginContext.Operations;
            var sections = os.GetHostTerminalRestaurantSections().ToList();
            var sectionIds = new HashSet<Guid>(sections.Select(s => s.Id));
            IPriceCategory category = null;
            try { category = sections.Select(s => s.DefaultPriceCategory).FirstOrDefault(c => c != null); } catch { /* нет категорий */ }

            var all = os.GetAllProducts()
                .Where(p => p != null && p.IsActive && (p.Type == ProductType.Dish || p.Type == ProductType.Goods))
                .ToList();

            // только то, что включено в меню залов этой кассы (так же видит кассир); если API ничего не сказал — всё активное
            var inMenu = all.Where(p => InMenu(p, sectionIds)).ToList();
            var products = inMenu.Count > 0 ? inMenu : all;

            var groups = new Dictionary<Guid, (IProductGroup g, List<IProduct> items)>();
            var noGroup = new List<IProduct>();
            foreach (var p in products)
            {
                IProductGroup g = null;
                try { g = os.TryGetParentByProduct(p); } catch { /* корень */ }
                if (g == null) { noGroup.Add(p); continue; }
                if (!groups.TryGetValue(g.Id, out var e)) groups[g.Id] = e = (g, new List<IProduct>());
                e.items.Add(p);
            }

            var outGroups = groups.Values
                .OrderBy(x => Path(x.g)).ThenBy(x => x.g.Name, StringComparer.CurrentCultureIgnoreCase)
                .Select(x => Group(x.g.Id.ToString(), x.g.Name, x.items, category))
                .ToList();
            if (noGroup.Count > 0) outGroups.Add(Group("root", "Без группы", noGroup, category));

            return new Dictionary<string, object>
            {
                ["id"] = "pos",
                ["name"] = "Меню кассы",
                ["at"] = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                ["count"] = products.Count,
                ["groups"] = outGroups.Where(g => ((List<object>)g["items"]).Count > 0).Cast<object>().ToList(),
            };
        }

        private static bool InMenu(IProduct p, HashSet<Guid> sectionIds)
        {
            try
            {
                var list = PluginContext.Operations.TryGetIncludedInMenuSectionsByProduct(p);
                if (list == null) return false;
                foreach (var s in list) { if (sectionIds.Count == 0 || sectionIds.Contains(s.Id)) return true; }
                return false;
            }
            catch { return false; }
        }

        /// <summary>Ключ сортировки групп: индексы меню по цепочке папок от корня.</summary>
        private static string Path(IProductGroup g)
        {
            var parts = new List<string>();
            var guard = 0;
            for (var x = g; x != null && guard++ < 20;)
            {
                parts.Insert(0, Num(x, "MenuIndex").ToString("000000", CultureInfo.InvariantCulture) + (x.Name ?? ""));
                IProductGroup up = null;
                try { up = PluginContext.Operations.TryGetParentByProductGroup(x); } catch { /* корень */ }
                x = up;
            }
            return string.Join("/", parts);
        }

        private static Dictionary<string, object> Group(string id, string name, List<IProduct> items, IPriceCategory category) =>
            new Dictionary<string, object>
            {
                ["id"] = id,
                ["name"] = string.IsNullOrWhiteSpace(name) ? "Без названия" : name.Trim(),
                ["items"] = items
                    .OrderBy(p => Num(p, "MenuIndex")).ThenBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase)
                    .Select(p => Item(p, category)).Where(x => x != null).Cast<object>().ToList(),
            };

        private static Dictionary<string, object> Item(IProduct p, IPriceCategory category)
        {
            try
            {
                var os = PluginContext.Operations;
                IProductSize def = null;
                var sizes = new List<IProductSize>();
                if (p.Scale != null)
                {
                    var disabled = new HashSet<Guid>();
                    try { foreach (var d in os.TryGetDisabledSizesByProduct(p) ?? Enumerable.Empty<IProductSize>()) disabled.Add(d.Id); } catch { /* */ }
                    sizes = os.GetProductScaleSizes(p.Scale).Where(s => !disabled.Contains(s.Id)).ToList();
                    def = (p.Scale.DefaultSize != null && !disabled.Contains(p.Scale.DefaultSize.Id)) ? p.Scale.DefaultSize : sizes.FirstOrDefault();
                }
                var it = new Dictionary<string, object>
                {
                    ["id"] = p.Id.ToString(),
                    ["name"] = string.IsNullOrWhiteSpace(p.Name) ? "Без названия" : p.Name.Trim(),
                    ["price"] = Price(p, def, category),
                    ["sizeId"] = def?.Id.ToString(),
                    ["mods"] = Mods(p, category),
                };
                if (sizes.Count > 1)
                    it["sizes"] = sizes.Select(s => (object)new Dictionary<string, object> { ["id"] = s.Id.ToString(), ["name"] = s.Name ?? "", ["price"] = Price(p, s, category) }).ToList();
                bool open = false;
                try { open = p.CanSetOpenPrice; } catch { /* */ }
                if (open) it["open"] = true;
                return it;
            }
            catch (Exception ex)
            {
                PluginContext.Log.Warn($"Официанты Патрики: позиция «{p?.Name}» не попала в меню — {ex.Message}");
                return null;
            }
        }

        private static List<object> Mods(IProduct p, IPriceCategory category)
        {
            var list = new List<object>();
            try
            {
                foreach (var g in p.GetGroupModifiers(category))
                {
                    var items = g.Items.Where(c => c.Product != null)
                        .Select(c => (object)new Dictionary<string, object> { ["id"] = c.Product.Id.ToString(), ["name"] = (c.Product.Name ?? "").Trim(), ["price"] = Price(c.Product, null, category) })
                        .ToList();
                    if (items.Count == 0) continue;
                    list.Add(new Dictionary<string, object>
                    {
                        ["id"] = g.ProductGroup.Id.ToString(), ["group"] = true, ["name"] = (g.ProductGroup.Name ?? "").Trim().TrimStart('-', ' '),
                        ["min"] = Num(g, "MinimumAmount", "MinAmount"), ["max"] = Num(g, "MaximumAmount", "MaxAmount"), ["def"] = 0,
                        ["items"] = items,
                    });
                }
            }
            catch (Exception ex) { PluginContext.Log.Warn($"Официанты Патрики: групповые модификаторы «{p.Name}» — {ex.Message}"); }
            try
            {
                foreach (var m in p.GetSimpleModifiers(category))
                {
                    if (m.Product == null) continue;
                    list.Add(new Dictionary<string, object>
                    {
                        ["id"] = "single:" + m.Product.Id, ["group"] = false, ["name"] = (m.Product.Name ?? "").Trim().TrimStart('-', ' '),
                        ["min"] = Num(m, "MinimumAmount", "MinAmount"), ["max"] = Num(m, "MaximumAmount", "MaxAmount"), ["def"] = Num(m, "DefaultAmount"),
                        ["items"] = new List<object> { new Dictionary<string, object> { ["id"] = m.Product.Id.ToString(), ["name"] = (m.Product.Name ?? "").Trim().TrimStart('-', ' '), ["price"] = Price(m.Product, null, category) } },
                    });
                }
            }
            catch (Exception ex) { PluginContext.Log.Warn($"Официанты Патрики: модификаторы «{p.Name}» — {ex.Message}"); }
            return list;
        }

        private static decimal Price(IProduct p, IProductSize size, IPriceCategory category)
        {
            var os = PluginContext.Operations;
            try { return ToDec(os.GetPrice(p, size, category, DateTime.Now)); }
            catch
            {
                try { return ToDec(os.GetPrice(p, size, null, DateTime.Now)); } catch { return 0; }
            }
        }

        private static decimal ToDec(object v) => v == null ? 0 : Convert.ToDecimal(v, CultureInfo.InvariantCulture);

        /// <summary>Числовое свойство по имени (ограничения модификаторов в разных версиях API называются по-разному).</summary>
        private static int Num(object o, params string[] names)
        {
            if (o == null) return 0;
            foreach (var n in names)
            {
                try
                {
                    var pr = o.GetType().GetProperty(n);
                    if (pr == null)
                        foreach (var itf in o.GetType().GetInterfaces()) { pr = itf.GetProperty(n); if (pr != null) break; }
                    if (pr == null) continue;
                    var v = pr.GetValue(o, null);
                    if (v != null) return (int)Math.Round(Convert.ToDecimal(v, CultureInfo.InvariantCulture));
                }
                catch { /* */ }
            }
            return 0;
        }
    }
}
