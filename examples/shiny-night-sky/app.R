# Explore the night sky ----
#
# A fuller Shiny app, on the same stars as the plots script. The sliders
# and boxes on the left filter the stars, and all three views on the
# right follow: the sky, the kinds of star, and a table.
#
# Each view reads the same reactive, shown(), so the filtering is
# written once. The App sheet draws this as a map: inputs on the left,
# shown() in the middle, and the three outputs on the right.

library(shiny)

stars <- read.csv("../data/bright_stars.csv")
kinds <- c("main sequence", "subgiant", "giant", "supergiant", "not recorded")

# One dark style for every plot, so the views read as one night sky.
night <- function() {
  par(bg = "#0B1020", fg = "#8A93A8", col.axis = "#8A93A8", col.lab = "#C9D1E0",
      col.main = "#E8ECF4", mar = c(4.5, 5.5, 2.5, 1))
}

ui <- fluidPage(
  titlePanel("The night sky, star by star"),
  sidebarLayout(
    sidebarPanel(
      sliderInput("faintest", "Faintest star to show, as a magnitude",
                  min = -1, max = 4.5, value = 4.5, step = 0.5),
      sliderInput("distance", "Distance, light years",
                  min = 0, max = 2000, value = c(0, 2000), step = 50),
      checkboxGroupInput("kinds", "Kinds of star", choices = kinds, selected = kinds),
      helpText("Lower magnitude means brighter. The Sun's nearest bright",
               "neighbor, Rigil Kentaurus, is 4.3 light years away.")
    ),
    mainPanel(
      textOutput("count"),
      tabsetPanel(
        tabPanel("Sky", plotOutput("sky", height = "460px")),
        tabPanel("Kinds of star", plotOutput("types", height = "460px")),
        tabPanel("Closest", tableOutput("closest"))
      )
    )
  )
)

server <- function(input, output, session) {
  shown <- reactive({
    subset(stars, magnitude <= input$faintest &
                  distance_ly >= input$distance[1] & distance_ly <= input$distance[2] &
                  kind %in% input$kinds)
  })

  output$count <- renderText(paste(nrow(shown()), "of", nrow(stars), "stars shown"))

  output$sky <- renderPlot({
    picked <- shown()
    night()
    plot(dec_degrees ~ ra_hours, data = picked, pch = 16, col = picked$color,
         cex = 0.3 + (4.6 - picked$magnitude) * 0.45, xlim = c(24, 0), ylim = c(-90, 90),
         xaxs = "i", yaxs = "i", xlab = "Right ascension, hours", ylab = "Declination, degrees")
    named <- subset(picked, magnitude < 1)
    text(named$ra_hours, named$dec_degrees, named$name, pos = 3, cex = 0.7, col = "#C9D1E0")
  })

  output$types <- renderPlot({
    picked <- shown()
    night()
    plot(luminosity_sun ~ temperature_k, data = picked, log = "xy", pch = 16, col = picked$color,
         xlim = rev(range(stars$temperature_k)), ylim = range(stars$luminosity_sun), yaxt = "n",
         xlab = "Surface temperature, kelvin", ylab = "")
    axis(2, at = 10^(-1:5), labels = format(10^(-1:5), big.mark = ",", scientific = FALSE), las = 1)
    mtext("Light given off, times the Sun's", side = 2, line = 4.5, col = "#C9D1E0")
  })

  output$closest <- renderTable({
    picked <- shown()
    picked <- picked[order(picked$distance_ly), c("name", "constellation", "distance_ly", "magnitude", "kind")]
    names(picked) <- c("Star", "Constellation", "Light years", "Magnitude", "Kind")
    head(picked, 15)
  })
}

shinyApp(ui, server)
