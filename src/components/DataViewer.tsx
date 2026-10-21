// The data viewer: a data frame in R, a page at a time. Each column header
// shows its type, a sketch of its distribution, a summary, and how many
// values are missing, so the shape of the data is visible before anyone
// scrolls (Shneiderman 1996: overview first, then zoom and detail on
// demand). Choosing a column opens its details beside the table. Values
// are read live from the session and never copied anywhere else.

import { useEffect, useState } from "react";
import { dataMeta, dataRows, runInConsole } from "../lib/app";
import { useStore } from "../lib/store";
import type { DataColumn, DataMeta, DataRow } from "../lib/types";
import { ArrowIcon, ChartIcon } from "./Icons";

const PAGE = 100;

/** Plain names for R's column types, for people who do not know them. */
const TYPE_WORDS: Record<string, string> = {
  num: "Numbers",
  int: "Whole numbers",
  fct: "Categories",
  chr: "Text",
  lgl: "True or false",
  date: "Dates",
  dttm: "Dates and times",
  list: "Lists",
};

const NUMERIC = new Set(["num", "int"]);

/** A number for display, with thousands separators and few decimals. */
function show(value: number | null | undefined) {
  if (value === null || value === undefined) return "None";
  return value.toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 3 : 1 });
}

/** R code naming a column, quoted when its name needs it. */
function columnRef(frame: string, column: string) {
  const safe = /^[A-Za-z.][A-Za-z0-9._]*$/.test(column) ? column : `\`${column.replace(/`/g, "\\`")}\``;
  return `${frame}$${safe}`;
}

type Sort = { column: string; descending: boolean } | null;

export function DataViewer({ name }: { name: string }) {
  // The object's summary changes when the data does, which is the signal
  // to read the columns again.
  const summary = useStore((state) => state.objects.find((object) => object.name === name)?.summary ?? "");
  const rStatus = useStore((state) => state.r.status);
  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (rStatus !== "ready" && rStatus !== "busy") return;
    let current = true;
    dataMeta(name)
      .then((next) => {
        if (!current) return;
        setMeta(next);
        setError("");
      })
      .catch(() => current && setError(`${name} is not in R right now. Run the code that creates it, then open it again from the Objects list.`));
    return () => {
      current = false;
    };
  }, [name, summary, rStatus]);

  useEffect(() => {
    if (!meta) return;
    let current = true;
    dataRows(name, offset, PAGE, sort?.column ?? "", sort?.descending ?? false)
      .then((next) => current && setRows(next))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [name, meta, offset, sort]);

  if (error) {
    return (
      <section className="data-viewer" aria-label={`Data viewer, ${name}`}>
        <p className="data-empty">{error}</p>
      </section>
    );
  }
  if (!meta) {
    return (
      <section className="data-viewer" aria-label={`Data viewer, ${name}`} aria-busy="true">
        <p className="data-empty">Reading {name} from R</p>
      </section>
    );
  }

  const column = meta.columns[selected] ?? meta.columns[0];
  const last = Math.min(meta.rows, offset + PAGE);
  const sortedBy = sort ? `Sorted by ${sort.column}, ${sort.descending ? "largest first" : "smallest first"}` : "In original order";

  return (
    <section className="data-viewer" aria-label={`Data viewer, ${name}`}>
      <header className="data-head">
        <h1>
          <code>{name}</code>
        </h1>
        <span className="muted">
          {meta.rows.toLocaleString()} rows, {meta.columns.length} columns
        </span>
        <span className="muted data-sorted">{sortedBy}</span>
      </header>
      <div className="data-body">
        <div className="data-table-wrap">
          <table className="data-table" aria-rowcount={meta.rows + 1}>
            <thead>
              <tr>
                <th scope="col" className="data-rownum">
                  <span className="visually-hidden">Row</span>
                </th>
                {meta.columns.map((col, index) => (
                  <th key={col.name} scope="col" aria-sort={sort?.column === col.name ? (sort.descending ? "descending" : "ascending") : undefined} className={index === selected ? "is-selected" : ""}>
                    <button type="button" className="data-col" aria-pressed={index === selected} onClick={() => setSelected(index)}>
                      <span className="data-col-name">
                        <code>{col.name}</code>
                        <span className="type-badge">{col.type}</span>
                      </span>
                      <span className="sketch" aria-hidden="true">
                        {col.bars.map((height, bar) => (
                          <span key={bar} style={{ height: `${Math.max(4, height)}%` }} />
                        ))}
                      </span>
                      <span className="data-col-summary">{col.summary}</span>
                      <span className={col.missing ? "data-col-missing" : "muted"}>{col.missing ? `${col.missing.toLocaleString()} missing` : "None missing"}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.n}>
                  <th scope="row" className="data-rownum">
                    {row.n}
                  </th>
                  {row.values.map((value, index) => (
                    <td key={index} className={`${NUMERIC.has(meta.columns[index]?.type) ? "is-number" : ""} ${index === selected ? "is-selected" : ""}`}>
                      {row.na[index] ? <span className="na">NA</span> : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ColumnDetails frame={name} column={column} rows={meta.rows} sort={sort} onSort={(next) => (setSort(next), setOffset(0))} />
      </div>
      <footer className="data-foot">
        <span>
          Rows {meta.rows ? (offset + 1).toLocaleString() : 0} to {last.toLocaleString()} of {meta.rows.toLocaleString()}
        </span>
        <button type="button" className="button quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          <ArrowIcon direction="left" size={14} /> Previous {PAGE}
        </button>
        <button type="button" className="button quiet" disabled={last >= meta.rows} onClick={() => setOffset(offset + PAGE)}>
          Next {PAGE} <ArrowIcon direction="right" size={14} />
        </button>
      </footer>
    </section>
  );
}

function ColumnDetails({ frame, column, rows, sort, onSort }: { frame: string; column: DataColumn; rows: number; sort: Sort; onSort: (sort: Sort) => void }) {
  const numeric = NUMERIC.has(column.type);
  const plot = numeric
    ? `hist(${columnRef(frame, column.name)}, main = ${JSON.stringify(column.name)}, xlab = ${JSON.stringify(column.name)})`
    : `barplot(table(${columnRef(frame, column.name)}), main = ${JSON.stringify(column.name)})`;
  const sortedHere = sort?.column === column.name;
  return (
    <aside className="column-details" aria-label={`Details for ${column.name}`}>
      <h2>
        <code>{column.name}</code>
      </h2>
      <p className="muted">{TYPE_WORDS[column.type] ?? column.type}</p>
      {numeric ? (
        <dl className="stat-grid">
          <div>
            <dt>Mean</dt>
            <dd>{show(column.stats.mean)}</dd>
          </div>
          <div>
            <dt>Median</dt>
            <dd>{show(column.stats.median)}</dd>
          </div>
          <div>
            <dt>Range</dt>
            <dd className="small">
              {show(column.stats.min)} to {show(column.stats.max)}
            </dd>
          </div>
          <div>
            <dt>Missing</dt>
            <dd>{column.missing ? `${column.missing} of ${rows}` : "None"}</dd>
          </div>
        </dl>
      ) : (
        <div className="top-values">
          <h3>Most common values</h3>
          <ul>
            {column.top.map((item) => (
              <li key={item.value}>
                <span className="truncate">{item.value}</span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${(100 * item.count) / (column.top[0]?.count || 1)}%` }} />
                </span>
                <span className="count">{item.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <p className="muted">{column.missing ? `${column.missing} missing of ${rows}` : "None missing"}</p>
        </div>
      )}
      <div className="column-actions">
        <button type="button" className="button primary" onClick={() => runInConsole(plot)}>
          <ChartIcon size={14} /> Plot this column
        </button>
        <div className="button-row">
          <button type="button" className="button quiet" aria-pressed={sortedHere && !sort?.descending} onClick={() => onSort({ column: column.name, descending: false })}>
            Sort smallest first
          </button>
          <button type="button" className="button quiet" aria-pressed={sortedHere && sort?.descending} onClick={() => onSort({ column: column.name, descending: true })}>
            Sort largest first
          </button>
          {sort && (
            <button type="button" className="button quiet" onClick={() => onSort(null)}>
              Original order
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
