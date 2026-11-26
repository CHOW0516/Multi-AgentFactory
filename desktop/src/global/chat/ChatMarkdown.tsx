// Shows the orchestrator's Markdown reply as formatted text: headings, paragraphs, bullet and numbered lists,
// tables, **bold**, *italic* and `code`. Builds React elements only (no HTML injection).
import type { ReactNode } from "react";
import { MachineStatusBadge } from "../../components/StatusBadge";
import type { MachineStatus } from "../../api/types";

const MACHINE_STATUSES: MachineStatus[] = ["running", "idle", "setup", "down", "maintenance"];

/** A table cell that is only a machine status ("Running", "**Down**") shows as the same pill as the rest of the app. */
function tableCell(cell: string): ReactNode {
  const status = cell.replace(/\*/g, "").trim().toLowerCase() as MachineStatus;
  return MACHINE_STATUSES.includes(status) ? <MachineStatusBadge status={status} /> : renderInline(cell);
}

type Block =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ kind: "heading", text: heading[1] }); index += 1; continue; }

    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) { tableLines.push(lines[index]); index += 1; }
      const rows = tableLines.filter((tableLine) => !TABLE_DIVIDER.test(tableLine)).map(tableCells);
      const hasHeader = tableLines.length > 1 && TABLE_DIVIDER.test(tableLines[1]);
      blocks.push({ kind: "table", header: hasHeader ? rows[0] : [], rows: hasHeader ? rows.slice(1) : rows });
      continue;
    }

    const listPattern = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null;
    if (listPattern) {
      const items: string[] = [];
      let itemMatch: RegExpExecArray | null;
      while (index < lines.length && (itemMatch = listPattern.exec(lines[index])) !== null) { items.push(itemMatch[1]); index += 1; }
      blocks.push({ kind: listPattern === BULLET ? "bullets" : "numbers", items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !HEADING.test(lines[index]) && !lines[index].trim().startsWith("|")
      && !BULLET.test(lines[index]) && !NUMBER.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }
  return blocks;
}

/** **bold**, *italic* and `code`. Anything else stays plain text. */
export function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${match.index}`;
    if (token.startsWith("**")) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    else parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      {parseBlocks(text).map((block, blockIndex) => {
        switch (block.kind) {
          case "heading":
            return <h4 key={blockIndex}>{renderInline(block.text)}</h4>;
          case "paragraph":
            return <p key={blockIndex}>{renderInline(block.text)}</p>;
          case "bullets":
            return <ul key={blockIndex}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>;
          case "numbers":
            return <ol key={blockIndex}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ol>;
          case "table":
            return (
              <div key={blockIndex} className="chat-table-wrap">
                <table className="chat-table">
                  {block.header.length > 0 ? (
                    <thead><tr>{block.header.map((cell, cellIndex) => <th key={cellIndex}>{renderInline(cell)}</th>)}</tr></thead>
                  ) : null}
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{tableCell(cell)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
