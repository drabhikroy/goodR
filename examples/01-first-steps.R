# First steps ----
#
# Put the cursor on a line and press Command Return to run it.
# The result appears in the canvas on the right, with a link
# back to this line. Lines that print nothing, such as an
# assignment, get a small check in the margin instead.

1 + 1

# Light travels 299,792.458 kilometers every second, and the Sun is
# about 149.6 million kilometers away. How many minutes does
# sunlight take to reach us?
149.6e6 / 299792.458 / 60

# R works on whole vectors at once. These are the planets' average
# distances from the Sun, in astronomical units, where Earth is 1.
distance_au <- c(Mercury = 0.39, Venus = 0.72, Earth = 1.00, Mars = 1.52,
                 Jupiter = 5.20, Saturn = 9.54, Uranus = 19.19, Neptune = 30.07)
distance_au
mean(distance_au)

# Every object you make appears as a small card along the top of the
# canvas. Point at a card to see what it is.
light_minutes <- round(distance_au * 8.32, 1)
light_minutes

# A plot lands in the canvas at full width. Press it to see it
# full size.
barplot(light_minutes, las = 2, col = "#1F5F8B", border = NA,
        main = "Minutes for sunlight to arrive", ylab = "Minutes")

# Type R straight into the box under the script, too. Try
# summary(light_minutes) there, or ?barplot to open its help page.
