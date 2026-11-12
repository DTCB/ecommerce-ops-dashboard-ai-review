import type { Cell } from "exceljs";
import { parseCsvRows, type SourceRow, type SourceSheet } from "./csv-import";

export type CsvEncoding = "auto" | "utf-8" | "gb18030";

export function readMerchantCsv(bytes: ArrayBuffer, encoding: CsvEncoding) {
  const candidates = encoding === "auto" ? ["utf-8", "gb18030"] as const : [encoding];
  for (const candidate of candidates) {
    let text;
    try {
      text = new TextDecoder(candidate, { fatal: true }).decode(bytes);
      if (text.includes("\0")) continue;
    } catch {
      continue;
    }
    return { sheet: { name: "CSV", rows: parseCsvRows(text) }, encoding: candidate };
  }
  throw new Error("无法解码 CSV，请尝试切换 UTF-8 或 GB18030。");
}

function spreadsheetValue(cell: Cell) {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  if (value && typeof value === "object" && "richText" in value) return value.richText.map(run => run.text).join("");
  if (value && typeof value === "object" && "text" in value) return value.text;
  return value;
}

export async function readMerchantExcel(bytes: ArrayBuffer): Promise<SourceSheet[]> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    // The browser build accepts ArrayBuffer; ExcelJS uses the Node Buffer type in its declarations.
    await workbook.xlsx.load(bytes as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new Error("无法读取 Excel 工作簿，请确认文件为可打开的 .xlsx。");
  }
  return workbook.worksheets.filter(sheet => sheet.state === "visible").map(sheet => {
    const rows: SourceRow[] = [];
    sheet.eachRow((row, line) => {
      const cells: string[] = [];
      const unsafeIds = new Set<number>();
      const paddedIds = new Map<number, string>();
      const merged = new Set<number>();
      row.eachCell((cell, column) => {
        const source = cell.isMerged ? cell.master : cell;
        const value = spreadsheetValue(source);
        const index = column - 1;
        if (source !== cell) merged.add(index);
        if (value instanceof Date) {
          cells[index] = Number.isFinite(value.valueOf()) ? value.toISOString() : "";
        } else if (typeof value === "number") {
          cells[index] = String(value);
          if (Math.abs(value) >= 1e15) unsafeIds.add(index);
          if (Number.isSafeInteger(value) && value >= 0 && /^0{2,}$/.test(source.numFmt)) {
            paddedIds.set(index, cells[index].padStart(source.numFmt.length, "0"));
          }
        } else if (typeof value === "string" || typeof value === "boolean") {
          cells[index] = String(value).trim();
        }
      });
      if (cells.some(Boolean)) {
        rows.push({
          line,
          cells: Array.from({ length: cells.length }, (_, index) => cells[index] ?? ""),
          unsafeIds,
          paddedIds,
          merged,
        });
      }
    });
    return { name: sheet.name, rows };
  });
}
