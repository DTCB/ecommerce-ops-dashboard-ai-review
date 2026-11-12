import type { AmountScope, OrderLine } from "./csv-import";
import type { Basis, Case, Category, Comparison, Month } from "./data";
import type { LocalCheck, Period, ProductCheck, StateCheck, VolumeCheck } from "./diagnostic-data";

type Bucket = { cents: number; orders: Set<string> };
type RegionBucket = Bucket & { products: Map<string, Bucket> };
type CategoryBucket = RegionBucket & { regions: Map<string, RegionBucket> };
type MonthBucket = Bucket & { categories: Map<string, CategoryBucket> };

export type ImportedData = {
  filename: string;
  currency: string;
  scope: AmountScope;
  months: Month[];
  cases: Record<string, Case>;
  defaultMonth: string;
  hasRegions: boolean;
  hasProducts: boolean;
  check: LocalCheck;
};

function bucket(): Bucket {
  return { cents: 0, orders: new Set() };
}

function getOrCreate<T>(map: Map<string, T>, key: string, create: () => T): T {
  const existing = map.get(key);
  if (existing) return existing;
  const value = create();
  map.set(key, value);
  return value;
}

function add(bucket: Bucket, line: OrderLine) {
  bucket.cents += line.cents;
  bucket.orders.add(line.order);
}

function previousMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5));
  return index === 1 ? `${String(year - 1).padStart(4, "0")}-12` : `${year}-${String(index - 1).padStart(2, "0")}`;
}

function daysInMonth(month: string) {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
}

function measure(bucket: Bucket | undefined, days: number): Period {
  const cents = bucket?.cents ?? 0;
  const orders = bucket?.orders.size ?? 0;
  return { gmv: cents / (100 * days), orders: orders / days, aov: orders ? cents / (100 * orders) : null };
}

function volumeCheck(before: Period | null, after: Period): VolumeCheck {
  if (before?.aov == null || after.aov === null) return { before, after, status: "insufficient" };
  const orderEffect = (after.orders - before.orders) * before.aov;
  const aovEffect = after.orders * (after.aov - before.aov);
  const delta = after.gmv - before.gmv;
  const orderIsLarger = Math.abs(orderEffect) > Math.abs(aovEffect);
  const decisive = Math.abs(delta) >= 0.005 && Math.abs(Math.abs(orderEffect) - Math.abs(aovEffect)) >= 0.005
    && (orderIsLarger ? orderEffect : aovEffect) * delta > 0;
  return {
    before, after, status: decisive ? "determined" : "mixed",
    driver: decisive ? (orderIsLarger ? "order_volume" : "aov") : null,
    order_effect: orderEffect, aov_effect: aovEffect,
    order_share: Math.abs(delta) >= 0.005 ? orderEffect / delta : null,
  };
}

function compare(before: MonthBucket | undefined, after: MonthBucket, priorDays: number, days: number): Comparison {
  const current = measure(after, days);
  const prior = before ? measure(before, priorDays) : null;
  const metric = (key: keyof Period) => {
    const previous = prior?.[key] ?? 0;
    const value = current[key] ?? 0;
    return { previous, current: value, rate: previous && current[key] !== null ? (value - previous) / previous : null };
  };
  const categories: Category[] = [];
  for (const category of new Set([...before?.categories.keys() ?? [], ...after.categories.keys()])) {
    const previous = measure(before?.categories.get(category), priorDays).gmv;
    const current = measure(after.categories.get(category), days).gmv;
    const delta = current - previous;
    categories.push({ category, previous, current, delta, rate: previous ? delta / previous : null });
  }
  const gainers = categories.filter(row => row.delta >= 0.005).sort((a, b) => b.delta - a.delta).slice(0, 5);
  const decliners = categories.filter(row => row.delta <= -0.005).sort((a, b) => a.delta - b.delta).slice(0, 5);
  if (!prior || (!gainers.length && !decliners.length)) {
    gainers.splice(0, gainers.length, ...categories.filter(row => after.categories.has(row.category))
      .sort((a, b) => b.current - a.current).slice(0, 5));
  }
  const volume = volumeCheck(prior, current);
  return {
    metrics: { gmv: metric("gmv"), orders: metric("orders"), aov: metric("aov") },
    order_effect: volume.status === "insufficient" ? 0 : volume.order_effect,
    aov_effect: volume.status === "insufficient" ? 0 : volume.aov_effect,
    gainers, decliners,
  };
}

function regionCheck(before: CategoryBucket | undefined, after: CategoryBucket | undefined,
  hasPrevious: boolean, priorDays: number, days: number): StateCheck {
  const net = measure(after, days).orders - measure(before, priorDays).orders;
  const direction = hasPrevious && Math.abs(net) > 1e-9 ? Math.sign(net) : 0;
  const rows: StateCheck["rows"] = [];
  for (const state of new Set([...before?.regions.keys() ?? [], ...after?.regions.keys() ?? []])) {
    const prior = measure(before?.regions.get(state), priorDays);
    const current = measure(after?.regions.get(state), days);
    const delta = current.orders - prior.orders;
    if (hasPrevious && (Math.abs(delta) < 1e-9 || delta * direction < 0)) continue;
    rows.push({
      state, previous_orders: hasPrevious ? prior.orders : null, current_orders: current.orders,
      order_delta: hasPrevious ? delta : null, gmv_delta: hasPrevious ? current.gmv - prior.gmv : null,
    });
  }
  rows.sort((a, b) => Math.abs(b.order_delta ?? b.current_orders) - Math.abs(a.order_delta ?? a.current_orders)
    || a.state.localeCompare(b.state));
  return { direction, rows: rows.slice(0, 5) };
}

function productCheck(before: RegionBucket | undefined, after: RegionBucket | undefined, hasPrevious: boolean,
  priorDays: number, days: number, names: Map<string, string>): ProductCheck {
  const rows: ProductCheck["rows"] = [];
  for (const product of new Set([...before?.products.keys() ?? [], ...after?.products.keys() ?? []])) {
    const prior = measure(before?.products.get(product), priorDays);
    const current = measure(after?.products.get(product), days);
    rows.push({
      product, name: names.get(product), previous_gmv: hasPrevious ? prior.gmv : null, current_gmv: current.gmv,
      previous_orders: hasPrevious ? prior.orders : null, current_orders: current.orders,
      gmv_delta: hasPrevious ? current.gmv - prior.gmv : null,
    });
  }
  return { rows, gmv_delta: hasPrevious ? measure(after, days).gmv - measure(before, priorDays).gmv : null };
}

export function buildImportedData(filename: string, currency: string, lines: OrderLine[], scope: AmountScope): ImportedData {
  const data = new Map<string, MonthBucket>();
  const names = new Map<string, string>();
  let hasRegions = false;
  let hasProducts = false;
  for (const line of lines) {
    const month = getOrCreate(data, line.month, () => ({ ...bucket(), categories: new Map() }));
    if (!line.delivered) continue;
    add(month, line);
    if (scope === "order") continue;
    if (line.region) hasRegions = true;
    const category = getOrCreate(month.categories, line.category, () => ({ ...bucket(), products: new Map(), regions: new Map() }));
    const region = getOrCreate(category.regions, line.region, () => ({ ...bucket(), products: new Map() }));
    add(category, line);
    add(region, line);
    if (line.sku) {
      hasProducts = true;
      if (line.productName && !names.has(line.sku)) names.set(line.sku, line.productName);
      add(getOrCreate(category.products, line.sku, bucket), line);
      add(getOrCreate(region.products, line.sku, bucket), line);
    }
  }
  const months = [...data.keys()].sort().map(month => {
    const result = measure(data.get(month), 1);
    return { month, days: daysInMonth(month), ...result, aov: result.aov ?? 0 };
  });
  const cases = Object.fromEntries(months.map(({ month, days }) => {
    const previous = previousMonth(month);
    const before = data.get(previous);
    const after = data.get(month)!;
    return [month, {
      previous, hasPrevious: Boolean(before),
      total: compare(before, after, 1, 1),
      daily: compare(before, after, daysInMonth(previous), days),
    }];
  }));
  const check: LocalCheck = ({ month, basis, category, operation, state }) => {
    const { previous, hasPrevious } = cases[month];
    const before = data.get(previous)?.categories.get(category);
    const after = data.get(month)?.categories.get(category);
    const priorDays = basis === "daily" ? daysInMonth(previous) : 1;
    const days = basis === "daily" ? daysInMonth(month) : 1;
    if (operation === "volume_aov") return volumeCheck(hasPrevious ? measure(before, priorDays) : null, measure(after, days));
    if (operation === "state_orders") return regionCheck(before, after, hasPrevious, priorDays, days);
    return productCheck(state === undefined ? before : before?.regions.get(state),
      state === undefined ? after : after?.regions.get(state), hasPrevious, priorDays, days, names);
  };
  return {
    filename, currency, scope, months, cases, hasRegions, hasProducts, check,
    defaultMonth: months.filter(({ month }) => cases[month].hasPrevious).at(-1)?.month ?? months[months.length - 1].month,
  };
}
