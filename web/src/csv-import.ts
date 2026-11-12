import Papa from "papaparse";

export const csvFields = {
  order_id: "订单号",
  line_id: "订单行号",
  order_date: "下单日期",
  category: "品类",
  sku: "商品 ID / SKU",
  line_amount: "行金额",
  order_amount: "订单实付",
  order_status: "订单状态",
  product_name: "商品名",
  buyer_region: "买家地区",
} as const;
type Field = keyof typeof csvFields;
export type Mapping = Partial<Record<Field, number>>;
export type AmountScope = "line" | "order";
export type SourceRow = { line: number; cells: string[]; unsafeIds?: Set<number>; paddedIds?: Map<number, string>; merged?: Set<number> };
export type SourceSheet = { name: string; rows: SourceRow[] };
export type CsvFile = { headers: string[]; records: SourceRow[] };
export type OrderLine = {
  order: string; month: string; category: string; sku: string;
  cents: number; delivered: boolean; productName: string; region: string;
};

export const csvFieldKeys = Object.keys(csvFields) as Field[];
export const coreFields: Field[] = ["order_id", "order_date", "order_status"];
export const amountField = (scope: AmountScope): Field => scope === "line" ? "line_amount" : "order_amount";
const aliases: Partial<Record<Field, string[]>> = {
  order_id: ["主订单号", "主订单编号", "父订单号", "订单编号", "订单ID", "主订单ID", "交易订单号", "平台订单号"],
  line_id: ["子订单号", "子订单编号", "子订单ID", "商品单ID", "订单明细ID", "订单商品ID", "明细序号"],
  order_date: ["下单时间", "订单创建时间", "订单创建日期", "创建时间", "拍下时间", "交易创建时间"],
  category: ["商品品类", "商品类目", "商品分类", "类目", "一级类目", "货类"],
  sku: ["SKU编码", "商家SKU", "商家编码", "货号", "商品ID", "商品编号", "SKU ID", "商品编码"],
  line_amount: ["商品实付金额", "商品实付", "子订单实付金额", "子订单实付", "子单实付金额", "商品行实付金额", "行实付金额", "商品行金额"],
  order_amount: ["订单实付金额", "主订单实付金额", "主订单实付", "订单实付款", "订单支付金额", "整单实付金额"],
  order_status: ["交易状态", "订单交易状态", "主订单状态", "订单当前状态", "状态"],
  product_name: ["商品名称", "商品标题", "货品名称", "宝贝标题"],
  buyer_region: ["收货省份", "收货省", "省份", "买家省份", "收货地区", "地区", "州"],
};

export function parseCsvRows(text: string): SourceRow[] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: SourceRow[] = [];
  let cursor = 0;
  let line = 1;
  Papa.parse<string[]>(source, {
    delimiter: ",",
    step: ({ data, errors, meta }) => {
      if (errors.length) throw new Error(`CSV 第 ${line} 行格式错误，请检查引号和逗号。`);
      const cells = data.map(cell => cell.trim());
      if (cells.some(Boolean)) rows.push({ line, cells });
      for (; cursor < meta.cursor; cursor++) {
        if (source[cursor] === "\n" || (source[cursor] === "\r" && source[cursor + 1] !== "\n")) line++;
      }
    },
  });
  return rows;
}

export function readTable(sheet: SourceSheet, header: number): CsvFile {
  const row = sheet.rows.find(row => row.line === header);
  return { headers: row?.cells ?? [], records: sheet.rows.filter(row => row.line > header) };
}

function normalizeHeader(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_/-]+/g, "").replace(/\(元\)$/, "");
}

export function matchHeaders(headers: string[]): Mapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: Mapping = {};
  for (const field of csvFieldKeys) {
    for (const alias of [field, csvFields[field], ...(aliases[field] ?? [])]) {
      const name = normalizeHeader(alias);
      const column = normalized.indexOf(name);
      if (column >= 0 && column === normalized.lastIndexOf(name)) {
        mapping[field] = column;
        break;
      }
    }
  }
  return mapping;
}

const summaryDates = ["日期", "月份", "统计日期", "统计月份", "时间"];
const summaryAmounts = ["成交额", "成交金额", "销售额", "gmv", "支付金额"];
const summaryFields = new Set([...summaryDates, ...summaryAmounts, "访客数", "浏览量", "成交订单数", "订单数",
  "支付买家数", "支付订单数", "品类", "商品类目", "店铺", "店铺名称", "渠道", "省份", "地区"]);

export function isSummaryReport(headers: string[], mapping: Mapping) {
  if (mapping.order_id !== undefined || mapping.order_status !== undefined || mapping.line_id !== undefined || mapping.sku !== undefined) {
    return false;
  }
  const columns = headers.map(normalizeHeader).filter(Boolean);
  return columns.every(column => summaryFields.has(column))
    && columns.some(column => summaryDates.includes(column))
    && columns.some(column => summaryAmounts.includes(column));
}

export function suggestTable(sheets: SourceSheet[]) {
  let selection = { sheet: 0, header: sheets[0]?.rows[0]?.line ?? 1 };
  let best = -1;
  sheets.forEach((sheet, index) => {
    for (const row of sheet.rows.slice(0, 30)) {
      const mapping = matchHeaders(row.cells);
      const score = coreFields.filter(field => mapping[field] !== undefined).length * 4
        + Number(mapping.line_amount !== undefined || mapping.order_amount !== undefined) * 4
        + Object.keys(mapping).length;
      if (score > best) {
        best = score;
        selection = { sheet: index, header: row.line };
      }
    }
  });
  return selection;
}

function orderDate(value: string) {
  const normalized = value.normalize("NFKC").replace(/[年月/]/g, "-").replace(/日/, "").trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.exec(normalized);
  if (!match || Number(match[1]) < 1000) return null;
  const day = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day ? day : null;
}

function amountInCents(value: string) {
  value = value.normalize("NFKC").replace(/^(?:¥|RMB|CNY)\s*/i, "").replace(/\s*元$/, "").trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function validateCsv(file: CsvFile, mapping: Mapping, delivered: ReadonlySet<string>, scope: AmountScope) {
  const issues: string[] = [];
  const lines: OrderLine[] = [];
  const orders = new Map<string, { day: string; status: string; region: string; cents: number }>();
  const orderLines = new Map<string, number>();
  const includedOrders = new Set<string>();
  const summary = { includedRows: 0, orders: 0, cents: 0, first: "", last: "" };
  const money = amountField(scope);
  const fields = [...coreFields, money];
  if (scope === "line") {
    for (const field of ["sku", "line_id"] as const) {
      if (mapping[field] !== undefined) fields.push(field);
    }
  }

  if (!file.records.length) issues.push("所选表头之后没有订单记录。");
  for (const field of fields) {
    if (mapping[field] === undefined) issues.push(`缺少字段映射：${csvFields[field]}。`);
  }
  const activeFields = scope === "order" ? fields : csvFieldKeys.filter(field => field !== "order_amount");
  const columns = activeFields.map(field => mapping[field]).filter(column => column !== undefined);
  if (new Set(columns).size !== columns.length) issues.push("同一列只能映射到一个字段。");
  if (delivered.size === 0) issues.push("请确认至少一种已交付状态。");
  if (issues.length) return { issues, lines, summary };

  for (const { line, cells, unsafeIds, paddedIds, merged } of file.records) {
    const start = issues.length;
    const issue = (message: string) => issues.push(`第 ${line} 行 ${message}`);
    if (cells.slice(file.headers.length).some(Boolean)) {
      issue("列数与表头不一致。");
      continue;
    }
    const get = (field: Field) => {
      const column = mapping[field] ?? -1;
      if ((field === "line_amount" || field === "line_id" || field === "sku") && merged?.has(column)) return "";
      return cells[column] ?? "";
    };
    const id = (field: "order_id" | "line_id" | "sku") => {
      const column = mapping[field] ?? -1;
      const raw = get(field);
      const value = raw ? paddedIds?.get(column) ?? raw : "";
      if (unsafeIds?.has(column) || /^\d+(?:\.\d+)?e\+\d+$/i.test(value)) {
        issue(`${csvFields[field]}疑似已丢失精度，请从原系统重新导出文本编号。`);
      }
      return value;
    };
    const status = get("order_status");
    const isDelivered = delivered.has(status);
    for (const field of fields) {
      if (!isDelivered && !coreFields.includes(field)) continue;
      if (!get(field)) issue(`${csvFields[field]}为空。`);
    }
    const day = orderDate(get("order_date"));
    const cents = isDelivered ? amountInCents(get(money)) : 0;
    if (get("order_date") && !day) issue("日期无效，请检查下单时间格式。");
    if (get(money) && cents === null) issue("金额无效，请填写最多两位小数的非负金额。");
    if (issues.length !== start || day === null || cents === null) continue;

    const order = id("order_id");
    const sku = scope === "line" && isDelivered ? id("sku") : "";
    const category = scope === "line" ? get("category") || "未分类" : "";
    const region = scope === "line" ? get("buyer_region") : "";
    const productName = scope === "line" ? get("product_name") : "";
    if (scope === "line" && isDelivered) {
      const detail = id("line_id");
      const lineKey = detail ? JSON.stringify([order, detail]) : JSON.stringify([order, sku, category, cents, productName]);
      const original = orderLines.get(lineKey);
      if (original !== undefined) issue(detail ? "订单号和订单行号组合重复。" : `与第 ${original} 行疑似重复，请核对并补充子订单号。`);
      orderLines.set(lineKey, line);
    }
    const existing = orders.get(order);
    if (existing && (existing.day !== day || existing.status !== status || (existing.region && region && existing.region !== region))) {
      issue("同一订单的日期、状态或买家地区存在冲突。");
    } else if (!existing || (!existing.region && region)) {
      orders.set(order, { day, status, region, cents });
    }
    if (scope === "order" && existing && existing.cents !== cents) issue("同一订单的实付金额存在冲突。");
    if (issues.length !== start) continue;

    if (isDelivered) {
      summary.includedRows++;
      includedOrders.add(order);
      if (!summary.first || day < summary.first) summary.first = day;
      if (!summary.last || day > summary.last) summary.last = day;
      if (scope === "line" || !existing) summary.cents += cents;
    }
    if (scope === "order" && existing) continue;
    lines.push({
      order, month: day.slice(0, 7), category, sku, cents, delivered: isDelivered, productName, region,
    });
  }
  summary.orders = includedOrders.size;
  if (!Number.isSafeInteger(summary.cents)) issues.push("已交付订单金额合计超过可精确计算的范围。");
  if (!issues.length && !lines.some(line => line.delivered)) issues.push("当前状态设置下没有已交付记录。");
  for (const line of lines) line.region = orders.get(line.order)?.region ?? "";
  return { issues, lines, summary };
}
