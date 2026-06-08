import { useMemo } from "react";
import Papa from "papaparse";
import { AlertTriangle } from "lucide-react";
import { cn } from "~/lib/utils";
import type { ViewerComponentProps } from "./types";

/**
 * CSV viewer — parses with papaparse and renders as a table with a
 * sticky header. Drives off `content.text` so it reuses the standard
 * `/fs/read` path (no skipContentFetch). Files over the read cap
 * (~100 KB) get the host's truncation banner above the table — what
 * renders is still valid CSV, just clipped.
 *
 * No virtualization yet: thousands of rows render fine; tens of
 * thousands will lag. Easy follow-up if it bites.
 */
export function CsvViewer({ content, className }: ViewerComponentProps) {
  // Hook order must be stable — parse whatever text we have (empty
  // string when content is missing) and let the conditional return
  // below drop the no-content case.
  const text = content?.text ?? "";
  const { rows, headers, error } = useMemo(() => parseCsv(text), [text]);

  if (!content) return null;

  if (error) {
    return (
      <div
        className={cn(
          "text-warning flex h-full flex-col items-center justify-center gap-2 p-4 text-sm",
          className,
        )}
      >
        <AlertTriangle size={16} />
        <p className="max-w-md text-center">{error}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-background-2 h-full w-full overflow-auto font-mono text-xs",
        className,
      )}
    >
      <table className="border-collapse">
        {headers.length > 0 ? (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="bg-background-3 sticky top-0 z-10 whitespace-nowrap border-b border-r px-2 py-1.5 text-left font-semibold"
                >
                  {h || <span className="text-muted-foreground">—</span>}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-background-3/60">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="border-b border-r px-2 py-1 align-top"
                  title={cell}
                >
                  <span className="block max-w-[24rem] truncate">
                    {cell}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  error: string | null;
}

function parseCsv(text: string): ParsedCsv {
  // Papa.parse with header:false so we keep first row as data and
  // promote it ourselves — papaparse's header mode coerces to objects
  // which is more allocation for the render path.
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    return {
      headers: [],
      rows: [],
      error: `Could not parse CSV: ${result.errors[0].message}`,
    };
  }
  const data = (result.data as string[][]).filter((r) => r.length > 0);
  if (data.length === 0) {
    return { headers: [], rows: [], error: "CSV is empty." };
  }
  return { headers: data[0], rows: data.slice(1), error: null };
}
