// The R code behind the Import Data dialog. Each file type is read by the
// function people would write themselves, with an argument only where an
// option differs from that function's default, so the code stays short
// enough to read and copy into a script. A second, limited version of the
// same call reads just the first rows for the preview, so a large file
// previews quickly.

export type ImportFormat = "text" | "excel" | "spss" | "stata" | "sas" | "rds" | "rdata" | "parquet" | "feather" | "json";

export type ImportOptions = {
  /** The path as the code should name it: relative to R's working folder
   * when the file is inside it, otherwise in full. */
  path: string;
  name: string;
  format: ImportFormat;
  sep: "," | ";" | "\t" | " ";
  header: boolean;
  dec: "." | ",";
  na: string;
  skip: number;
  sheet: string;
};

const FORMATS: Record<string, ImportFormat> = {
  csv: "text",
  tsv: "text",
  txt: "text",
  xlsx: "excel",
  xls: "excel",
  sav: "spss",
  dta: "stata",
  sas7bdat: "sas",
  rds: "rds",
  rdata: "rdata",
  rda: "rdata",
  parquet: "parquet",
  feather: "feather",
  json: "json",
};

/** The package each format needs beyond base R, if any. */
export const FORMAT_PACKAGE: Partial<Record<ImportFormat, string>> = {
  excel: "readxl",
  spss: "haven",
  stata: "haven",
  sas: "haven",
  parquet: "arrow",
  feather: "arrow",
  json: "jsonlite",
};

/** Plain names for each format, for the dialog. */
export const FORMAT_NAMES: Record<ImportFormat, string> = {
  text: "Text with columns, such as CSV",
  excel: "Excel workbook",
  spss: "SPSS data",
  stata: "Stata data",
  sas: "SAS data",
  rds: "Saved R object",
  rdata: "Saved R workspace",
  parquet: "Parquet",
  feather: "Feather",
  json: "JSON",
};

/** The format a file's extension implies, or null for one this cannot read. */
export function formatOf(path: string): ImportFormat | null {
  const extension = (path.split(".").pop() ?? "").toLowerCase();
  return FORMATS[extension] ?? null;
}

/** A valid R name from a file name: survey 2026.csv becomes survey_2026. */
export function objectName(path: string) {
  const file = path.split(/[\\/]/).pop() ?? "data";
  const base = file.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base) return "data";
  return /^[A-Za-z.]/.test(base) && !/^\.[0-9]/.test(base) ? base : `x${base}`;
}

/** True when a name can be assigned to without backticks. */
export function isValidName(name: string) {
  // ..1, ..2, and so on name the arguments passed through ..., so they
  // cannot be assigned to either.
  return /^([A-Za-z]|\.[A-Za-z._])[A-Za-z0-9._]*$|^\.$/.test(name) && !RESERVED.has(name) && !/^\.\.\d+$/.test(name);
}

const RESERVED = new Set(["if", "else", "repeat", "while", "function", "for", "next", "break", "TRUE", "FALSE", "NULL", "Inf", "NaN", "NA", "NA_integer_", "NA_real_", "NA_complex_", "NA_character_", "in", "..."]);

/** Names a file in R code: relative to the working folder when inside it,
 * with forward slashes, which R accepts on every system. */
export function pathForCode(path: string, workingDir: string) {
  const forward = path.replace(/\\/g, "/");
  const base = workingDir.replace(/\\/g, "/").replace(/\/$/, "");
  return base && forward.startsWith(`${base}/`) ? forward.slice(base.length + 1) : forward;
}

/** A name as the left side of an assignment: as it is when R accepts it
 * plainly, otherwise in backticks, so no name can break the code. */
function assignable(name: string) {
  return isValidName(name) ? name : `\`${name.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
}

/** Quotes text as an R string. */
function quote(text: string) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Missing value markers typed as a comma separated list. */
function naValues(text: string) {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, all) => all.indexOf(item) === index);
}

/** The reading call, with a row limit for the preview when one is given. */
function readCall(options: ImportOptions, limit?: number): string {
  const file = quote(options.path);
  const nas = naValues(options.na);
  switch (options.format) {
    case "text": {
      const args = [file];
      if (options.sep !== ",") args.push(`sep = ${options.sep === "\t" ? '"\\t"' : quote(options.sep)}`);
      if (!options.header) args.push("header = FALSE");
      if (options.dec !== ".") args.push(`dec = ${quote(options.dec)}`);
      if (nas.length && !(nas.length === 1 && nas[0] === "NA")) args.push(`na.strings = c(${nas.map(quote).join(", ")})`);
      if (options.skip > 0) args.push(`skip = ${options.skip}`);
      if (limit) args.push(`nrows = ${limit}`);
      return `read.csv(${args.join(", ")})`;
    }
    case "excel": {
      const args = [file];
      if (options.sheet) args.push(`sheet = ${quote(options.sheet)}`);
      if (options.skip > 0) args.push(`skip = ${options.skip}`);
      if (nas.length && !(nas.length === 1 && nas[0] === "")) args.push(`na = c(${nas.map(quote).join(", ")})`);
      if (limit) args.push(`n_max = ${limit}`);
      return `readxl::read_excel(${args.join(", ")})`;
    }
    case "spss":
    case "stata":
    case "sas": {
      const reader = { spss: "read_sav", stata: "read_dta", sas: "read_sas" }[options.format];
      return `haven::${reader}(${file}${limit ? `, n_max = ${limit}` : ""})`;
    }
    case "rds":
      return `readRDS(${file})`;
    case "rdata":
      return `load(${file})`;
    case "parquet":
      return `arrow::read_parquet(${file})`;
    case "feather":
      return `arrow::read_feather(${file})`;
    case "json":
      return `jsonlite::fromJSON(${file})`;
  }
}

/** The code the dialog runs, shows, and can add to the script. */
export function importCode(options: ImportOptions) {
  // A saved workspace brings back its own objects under their own names.
  if (options.format === "rdata") return readCall(options);
  return `${assignable(options.name)} <- ${readCall(options)}`;
}

/** The code that reads the first rows for the preview. Nothing it makes is
 * kept, since R runs it in a scratch environment. */
export function previewCode(options: ImportOptions, rows = 50) {
  if (options.format === "rdata") return `local({ saved <- new.env(); load(${quote(options.path)}, envir = saved); data.frame(object = ls(saved)) })`;
  const limited = ["text", "excel", "spss", "stata", "sas"].includes(options.format);
  const call = readCall(options, limited ? rows : undefined);
  return limited ? call : `utils::head(as.data.frame(${call}), ${rows})`;
}

/** The code that lists an Excel workbook's sheets. */
export function sheetsCode(path: string) {
  return `data.frame(sheet = readxl::excel_sheets(${quote(path)}))`;
}

/** The code that reads a text file's first lines, so the dialog can guess
 * how its columns are separated. */
export function firstLinesCode(path: string) {
  return `data.frame(line = readLines(${quote(path)}, n = 8, warn = FALSE))`;
}

/**
 * Guesses how a text file's columns are separated from its first lines:
 * the candidate that splits every line into the same number of columns,
 * more than one, wins. A semicolon file usually writes decimals with a
 * comma, as spreadsheets in much of Europe save them, so that is guessed
 * too when the numbers show it.
 */
export function guessLayout(lines: string[]): { sep: ImportOptions["sep"]; dec: ImportOptions["dec"] } {
  const rows = lines.filter((line) => line.trim()).slice(0, 8);
  const fits = (sep: string) => {
    const counts = rows.map((line) => line.split(sep).length - 1);
    return counts.length > 0 && counts[0] > 0 && counts.every((count) => count === counts[0]) ? counts[0] : 0;
  };
  // Tab and semicolon are checked before comma, since a comma inside a
  // decimal number would otherwise look like a separator.
  const order: ImportOptions["sep"][] = ["\t", ";", ","];
  const sep = order.find((candidate) => fits(candidate) > 0) ?? ",";
  const decimalComma = sep !== "," && rows.slice(1).some((line) => /(^|[^\d])\d+,\d+([^\d]|$)/.test(line));
  return { sep, dec: decimalComma ? "," : "." };
}
