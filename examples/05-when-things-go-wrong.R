# When things go wrong ----
#
# Each line below fails, or warns, on purpose. Run them one at a
# time. Instead of R's terse message, the canvas says what happened
# in plain words, marks the exact spot in the script, and offers a
# fix where one is clear. The original message is one press away.

planets <- read.csv("data/exoplanets.csv")

# A misspelled name. The canvas offers the closest match.
mean(planet$mass_jupiter, na.rm = TRUE)

# A column that is not there.
lm(period_days ~ distance, data = planets)

# Text where a number was expected.
"10" + 5

# A warning: the line runs, but R noticed something worth a look.
as.numeric(c("1.2", "about 4", "7"))

# A package that is not installed. The app offers to install it.
library(notapackage)

# A missing closing bracket is found by asking R's own parser.
sum(1, 2
