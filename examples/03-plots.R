# Plots ----
#
# Each plot lands in the canvas at full width. Full size shows it
# over the window, where the arrow keys move between plots, and
# Export saves it at a size for a slide, a document, or a journal
# column. Edit labels, under a plot, changes its title in the code.

meteorites <- read.csv("data/meteorites.csv")

# Meteorites range from a gram to tens of tonnes, so their masses
# are shown as powers of ten.
hist(log10(meteorites$mass_g), breaks = 30, col = "#1F5F8B", border = "white",
     main = "Meteorite masses", xlab = "Mass, as a power of ten grams")

# A map, made from nothing but longitude and latitude. Places
# written as 0, 0 mean unknown, so they are left out.
placed <- subset(meteorites, !is.na(lat) & !(lat == 0 & long == 0))
plot(lat ~ long, data = placed, pch = 19, cex = 0.4,
     col = ifelse(placed$fall == "fell", "#C8601F", "#1F5F8B"),
     main = "Where meteorites were seen to fall, and where they were found",
     xlab = "Longitude", ylab = "Latitude")

# A line that adds to a plot redraws that plot rather than making a
# new one.
legend("bottomleft", c("Seen falling", "Found later"), pch = 19,
       col = c("#C8601F", "#1F5F8B"), bty = "n")

# More people, more witnesses: falls seen in each decade.
seen <- subset(meteorites, fall == "fell" & year >= 1800)
barplot(table(floor(seen$year / 10) * 10), las = 2, col = "#1F5F8B", border = NA,
        main = "Meteorites seen falling, by decade")

# Do the ones people see falling tend to be bigger?
boxplot(log10(mass_g) ~ fall, data = subset(meteorites, mass_g > 0),
        names = c("Seen falling", "Found later"), col = c("#C8601F", "#1F5F8B"),
        ylab = "Mass, as a power of ten grams")

# The night sky ----
#
# bright_stars.csv holds every star you could see from a town on a
# clear night: its name, how bright it looks, how far away it is, and
# its true color, as a hex code ready for plotting.

stars <- read.csv("data/bright_stars.csv")

# The whole sky, flattened, on a dark background. Brighter stars are
# shown larger, as the eye sees them. Lower magnitude means brighter.
old <- par(bg = "#0B1020", fg = "#8A93A8", col.axis = "#8A93A8",
           col.lab = "#C9D1E0", col.main = "#E8ECF4", mar = c(5, 6, 4, 2))
plot(dec_degrees ~ ra_hours, data = stars, pch = 16,
     cex = 0.25 + (4.6 - stars$magnitude) * 0.42, col = stars$color,
     xlim = c(24, 0), ylim = c(-90, 90), xaxs = "i", yaxs = "i",
     main = "Every star brighter than magnitude 4.5",
     xlab = "Right ascension, hours", ylab = "Declination, degrees")
brightest <- subset(stars, magnitude < 1)
text(brightest$ra_hours, brightest$dec_degrees, brightest$name,
     pos = 3, cex = 0.6, col = "#C9D1E0")

# Temperature against the light a star gives off, on log scales: the
# Hertzsprung-Russell diagram. Most stars sit on one diagonal band,
# the main sequence. The giants float above it.
plot(luminosity_sun ~ temperature_k, data = stars, log = "xy",
     xlim = rev(range(stars$temperature_k)), pch = 16, col = stars$color,
     yaxt = "n", main = "Hot, cool, faint, and brilliant",
     xlab = "Surface temperature, kelvin", ylab = "")
axis(2, at = 10^(-1:5), labels = format(10^(-1:5), big.mark = ",", scientific = FALSE), las = 1)
mtext("Light given off, times the Sun's", side = 2, line = 4.5, col = "#C9D1E0")
par(old)
