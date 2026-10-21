# The smallest useful Shiny app ----
#
# Press Run app above the script. Pick a constellation and the page
# answers: how many of its stars you can see, and where they sit, each
# drawn in its own true color. Save after a change and the app reloads.

library(shiny)

stars <- read.csv("../data/bright_stars.csv")
constellations <- sort(unique(stars$constellation))

ui <- fluidPage(
  titlePanel("Star finder"),
  selectInput("constellation", "Constellation", choices = constellations, selected = "Orion"),
  textOutput("summary"),
  plotOutput("chart", height = "380px")
)

server <- function(input, output, session) {
  chosen <- reactive(subset(stars, constellation == input$constellation))

  output$summary <- renderText({
    picked <- chosen()
    brightest <- picked[which.min(picked$magnitude), ]
    paste0(input$constellation, " has ", nrow(picked), " stars bright enough to see from a town. ",
           "The brightest is ", brightest$name, ", ", brightest$distance_ly, " light years away.")
  })

  output$chart <- renderPlot({
    picked <- chosen()
    par(bg = "#0B1020", fg = "#8A93A8", col.axis = "#8A93A8", col.lab = "#C9D1E0", mar = c(4, 4, 1, 1))
    plot(dec_degrees ~ ra_hours, data = picked, pch = 16, col = picked$color,
         cex = 1 + (4.6 - picked$magnitude) * 0.9, xlim = rev(range(picked$ra_hours)) + c(0.2, -0.2),
         xlab = "Right ascension, hours", ylab = "Declination, degrees")
    text(picked$ra_hours, picked$dec_degrees, picked$name, pos = 3, cex = 0.75, col = "#C9D1E0")
  })
}

shinyApp(ui, server)
