import { Fragment, type ReactNode } from "react";

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  const values = cells(line);
  return values.length > 0 && values.every((value) => /^:?-{3,}:?$/u.test(value));
}

function tableAt(lines: string[], index: number): MarkdownTable | undefined {
  if (!lines[index + 1] || !lines[index].includes("|") || !isSeparator(lines[index + 1])) {
    return undefined;
  }
  const headers = cells(lines[index]);
  if (headers.length !== cells(lines[index + 1]).length) return undefined;
  const rows: string[][] = [];
  for (let cursor = index + 2; cursor < lines.length && lines[cursor].includes("|"); cursor += 1) {
    const row = cells(lines[cursor]);
    if (row.length !== headers.length) break;
    rows.push(row);
  }
  return { headers, rows };
}

function inline(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/u).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function MessageContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const table = tableAt(lines, index);
    if (table) {
      blocks.push(
        <div className="markdown-table" key={`table-${index}`}>
          <table aria-label="Response data">
            <thead>
              <tr>{table.headers.map((header, column) => <th key={`${header}-${column}`} scope="col">{inline(header)}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>{row.map((cell, column) => <td key={`${rowIndex}-${column}`}>{inline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index += table.rows.length + 2;
      continue;
    }
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !tableAt(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{inline(line)}</Fragment>)}</p>);
  }
  return <>{blocks}</>;
}
