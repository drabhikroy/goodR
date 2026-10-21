# Data frames ----
#
# Every meteorite people saw fall to Earth, and a random sample of
# 4,000 of the 44,000 found later, from the Meteoritical Society's
# records, published by NASA. Run each line and watch the canvas.

meteorites <- read.csv("data/meteorites.csv")
head(meteorites)
dim(meteorites)

# Press the meteorites card at the top of the canvas to open it in
# the data viewer, where every column shows its type, its range, and
# how many values are missing.
summary(meteorites)

# Real data needs a second look. Some places are written as latitude
# 0 and longitude 0, a spot in the Atlantic Ocean where no meteorite
# was ever found. They mean the place is not known.
unknown <- meteorites$lat == 0 & meteorites$long == 0
sum(unknown, na.rm = TRUE)
meteorites$lat[which(unknown)] <- NA
meteorites$long[which(unknown)] <- NA

# Seen falling, against found later.
table(meteorites$fall)

# The five heaviest, in kilograms.
heaviest <- head(meteorites[order(-meteorites$mass_g), c("name", "fall", "year", "mass_g")], 5)
heaviest$mass_kg <- heaviest$mass_g / 1000
heaviest

# The typical mass of the five most common kinds, by their class.
common <- names(sort(table(meteorites$class), decreasing = TRUE))[1:5]
aggregate(mass_g ~ class, data = subset(meteorites, class %in% common), FUN = median)

# Where are they found? About half of all finds come from
# Antarctica, south of latitude 60, where dark stones are easy to
# spot on the ice and the cold keeps them for thousands of years.
table(antarctica = meteorites$lat < -60, meteorites$fall)
