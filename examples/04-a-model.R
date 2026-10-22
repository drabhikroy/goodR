# A model ----
#
# In 1619 Johannes Kepler found that a planet's year depends on its
# distance from the Sun. Here R finds the same rule again, from
# thousands of planets around other stars, in an open catalog kept by
# the astronomer Hanno Rein. README.md says where the data comes from.

planets <- read.csv("data/exoplanets.csv")
table(planets$method)

# The planets whose year, distance, and star's mass are all known.
known <- subset(planets, period_days > 0 & distance_au > 0 & star_mass_sun > 0)
nrow(known)

plot(log10(period_days) ~ log10(distance_au), data = known, pch = 19, cex = 0.5,
     col = "#1F5F8B", xlab = "Distance from its star, as a power of ten AU",
     ylab = "Length of its year, as a power of ten days")

# Kepler's law says a year grows with the distance to the power 1.5,
# and shrinks with the square root of the star's mass, a power of
# minus 0.5. A linear model of the logarithms estimates both.
fit <- lm(log10(period_days / 365.25) ~ log10(distance_au) + log10(star_mass_sun), data = known)
summary(fit)
confint(fit)

# The model has never seen the Solar System, yet it predicts a year
# of 0.99 for Earth and 11.6 for Jupiter, whose real year is 11.9.
10^predict(fit, data.frame(distance_au = c(1, 5.2), star_mass_sun = 1))

# Checking the fit: residuals against fitted values.
plot(fitted(fit), resid(fit), pch = 19, cex = 0.5, col = "#1F5F8B",
     xlab = "Fitted year, as a power of ten years", ylab = "Residual")
abline(h = 0, lty = 2)

# Does the star's mass matter? Compare with a model without it.
fit_distance <- lm(log10(period_days / 365.25) ~ log10(distance_au), data = known)
anova(fit_distance, fit)
