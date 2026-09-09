import * as XLSX from "xlsx";

const MAX_DOCUMENT_BYTES = 150_000;

export function extractActionDocument(fileName: string, contentBase64: string) {
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) throw new Error("Action document is empty or exceeds 1 MB");
  const normalized = fileName.toLowerCase();
  if (/\.(?:txt|csv)$/u.test(normalized)) return bytes.toString("utf8").trim();
  if (!/\.xlsx$/u.test(normalized)) throw new Error("Only .txt, .csv, and .xlsx files are supported");
  const workbook = XLSX.read(bytes, { type: "buffer", cellText: true, cellFormula: false, cellHTML: false });
  const text = workbook.SheetNames.map((name) => `[Sheet: ${name}]\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })}`).join("\n\n").trim();
  if (!text) throw new Error("Action document contains no readable cells");
  return text.slice(0, 60_000);
}
