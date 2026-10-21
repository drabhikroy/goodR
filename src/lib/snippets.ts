// Ready made code for common first tasks, offered in the search under
// Insert rather than in a gallery of its own, so there is one place to
// look for anything. Each uses base R, apart from reading Excel, so it
// works on a fresh install. Blanks to fill in are written as ${name}, and
// Tab moves from one to the next after the code goes in.

export type Snippet = { id: string; title: string; words: string; code: string };

export const SNIPPETS: Snippet[] = [
  { id: "read-csv", title: "Read a CSV file", words: "import load data spreadsheet comma", code: 'data <- read.csv("${data.csv}")\nhead(data)' },
  { id: "read-excel", title: "Read an Excel sheet", words: "import load xlsx readxl spreadsheet", code: 'library(readxl)\ndata <- read_excel("${data.xlsx}", sheet = ${1})\nhead(data)' },
  { id: "look", title: "Look at a data frame", words: "summary structure columns str overview", code: "str(${data})\nsummary(${data})" },
  { id: "filter", title: "Keep only some rows", words: "filter subset select where", code: "${smaller} <- subset(${data}, ${column} > ${value})" },
  { id: "group-means", title: "Average by group", words: "mean aggregate summarize group by", code: "aggregate(${value} ~ ${group}, data = ${data}, FUN = mean)" },
  { id: "count", title: "Count each category", words: "table frequency counts", code: "table(${data}$${column})" },
  { id: "histogram", title: "Make a histogram", words: "plot distribution chart hist", code: 'hist(${data}$${column}, main = "${Title}", xlab = "${Label}")' },
  { id: "bar-chart", title: "Make a bar chart", words: "plot barplot categories chart", code: 'barplot(table(${data}$${column}), main = "${Title}")' },
  { id: "scatter", title: "Make a scatter plot", words: "plot points relationship chart", code: 'plot(${y} ~ ${x}, data = ${data}, pch = 19, main = "${Title}")' },
  { id: "box-plot", title: "Make a box plot by group", words: "plot boxplot compare groups chart", code: "boxplot(${value} ~ ${group}, data = ${data})" },
  { id: "t-test", title: "Compare two groups with a t-test", words: "test difference means statistics", code: "t.test(${value} ~ ${group}, data = ${data})" },
  { id: "chi-squared", title: "Test two categories with chi-squared", words: "test association table statistics", code: "chisq.test(table(${data}$${first}, ${data}$${second}))" },
  { id: "correlation", title: "Find a correlation", words: "cor relationship pearson statistics", code: "cor.test(${data}$${x}, ${data}$${y})" },
  { id: "linear-model", title: "Fit a linear model", words: "regression lm model statistics", code: "fit <- lm(${y} ~ ${x}, data = ${data})\nsummary(fit)" },
  { id: "save-plot", title: "Save a plot as a PNG file", words: "export image picture png", code: 'png("${plot.png}", width = 1600, height = 1200, res = 200)\n${plot(1:10)}\ndev.off()' },
  { id: "write-csv", title: "Save a data frame as a CSV file", words: "export write save data", code: 'write.csv(${data}, "${data.csv}", row.names = FALSE)' },
];
