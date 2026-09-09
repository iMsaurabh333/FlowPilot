import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { extractActionDocument } from "../src/reports/action-document.js";

describe("action-document extraction", () => {
  it("normalizes an Excel sheet into reviewable source text", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Operation", "Flow"], ["deploy", "iflow1"]]), "Actions");
    const contentBase64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
    expect(extractActionDocument("actions.xlsx", contentBase64)).toContain("deploy,iflow1");
  });

  it("accepts text and rejects unsupported formats", () => {
    expect(extractActionDocument("actions.txt", Buffer.from("deploy iflow1").toString("base64"))).toBe("deploy iflow1");
    expect(() => extractActionDocument("actions.pdf", "eA==")).toThrow(/Only/);
  });
});
