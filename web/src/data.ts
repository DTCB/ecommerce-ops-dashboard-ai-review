import snapshot from "../../data/demo_aggregates.json";

export type Basis = "total" | "daily";
export type Selection = { month: string; basis: Basis };
export type ProductScope = { state?: string };
export type Diagnosis = { category: string; detail: "volume" | "states"; products?: ProductScope };
export type View = Selection & { diagnosis?: Diagnosis };
export type MetricKey = "gmv" | "orders" | "aov";
export type Metric = { previous: number; current: number; rate: number | null };
export type Category = {
  category: string;
  previous: number;
  current: number;
  delta: number;
  rate: number | null;
};
export type Comparison = {
  metrics: Record<MetricKey, Metric>;
  order_effect: number;
  aov_effect: number;
  gainers: Category[];
  decliners: Category[];
};
export type Month = { month: string; days: number; gmv: number; orders: number; aov: number };
export type Case = { previous: string; hasPrevious?: boolean } & Record<Basis, Comparison>;

export const monthly: Month[] = snapshot.monthly;
export const cases: Record<string, Case> = snapshot.cases;
export const defaultMonth = "2018-06";
export const comparisonMonth = "2018-04";

export function hasCategory({ month, basis }: Selection, category: string, source = cases) {
  const { gainers, decliners } = source[month][basis];
  return [...gainers, ...decliners].some(row => row.category === category);
}

export function readView(): View {
  const params = new URLSearchParams(window.location.search);
  const month = params.get("month") ?? defaultMonth;
  const basis = params.get("basis") ?? "total";
  if (!Object.hasOwn(cases, month) || (basis !== "total" && basis !== "daily")) {
    return { month: defaultMonth, basis: "total" };
  }
  const category = params.get("category");
  const selection: Selection = { month, basis };
  if (category && hasCategory(selection, category)) {
    return { ...selection, diagnosis: { category, detail: params.get("detail") === "states" ? "states" : "volume" } };
  }
  return selection;
}

export function viewUrl({ month, basis, diagnosis }: View) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("month", month);
  url.searchParams.set("basis", basis);
  if (diagnosis) {
    url.searchParams.set("category", diagnosis.category);
    url.searchParams.set("detail", diagnosis.detail);
  }
  return url;
}

const categoryNames: Record<string, string> = {
  watches_gifts: "手表与礼品",
  garden_tools: "园艺工具",
  sports_leisure: "运动与休闲",
  furniture_decor: "家居装饰",
  cool_stuff: "创意好物",
  computers_accessories: "电脑及配件",
  bed_bath_table: "家纺与餐桌用品",
  health_beauty: "美妆与个护",
  housewares: "家居用品",
  office_furniture: "办公家具",
  telephony: "电话通讯",
  fixed_telephony: "固定电话",
  auto: "汽车用品",
  toys: "玩具",
  stationery: "文具",
  baby: "母婴",
  perfumery: "香水",
  luggage_accessories: "箱包配件",
  musical_instruments: "乐器",
  construction_tools_construction: "建筑工具",
  small_appliances: "小家电",
  electronics: "电子产品",
  fashion_bags_accessories: "时尚箱包与配件",
  pet_shop: "宠物用品",
  computers: "电脑",
  home_appliances: "家电",
  home_appliances_2: "家电（第二类）",
  agro_industry_and_commerce: "农业工业与商业",
  consoles_games: "游戏机与游戏",
  signaling_and_security: "标识与安防",
  air_conditioning: "空调",
  unknown: "未分类",
};

export function categoryName(id: string) {
  return categoryNames[id] ?? id.replaceAll("_", " ");
}

export const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

export function signed(value: number, digits = 2) {
  return `${value < 0 ? "−" : value > 0 ? "+" : ""}${formatNumber(Math.abs(value), digits)}`;
}

export const percent = (rate: number) => `${signed(rate * 100)}%`;
export const monthName = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
export const shortMonth = (month: string) => `${Number(month.slice(5))} 月`;
export const basisName = (basis: Basis) => basis === "daily" ? "日均" : "月度总量";

export function gmvAxis(value: number, basis: Basis) {
  return `${formatNumber(value / (basis === "daily" ? 1000 : 10000), 0)}${basis === "daily" ? "千" : "万"}`;
}
