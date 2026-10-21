# Sixty years of space launches ----
#
# Press Run app above the script. The app runs beside the code, and
# Stop app ends it. The first run offers to install shiny if it is
# missing. The data sit in this app's own folder, so Share as a web
# page can bundle them with the app.

library(shiny)

launches <- read.csv("launches_by_year.csv")

ui <- fluidPage(
  titlePanel("Space launches, 1957 to 2018"),
  sliderInput("years", "Years", min = 1957, max = 2018, value = c(1957, 2018), sep = ""),
  checkboxGroupInput("who", "Launched by", inline = TRUE,
                     choices = c("Governments" = "state", "Companies" = "private", "Start ups" = "startup"),
                     selected = c("state", "private", "startup")),
  plotOutput("per_year"),
  textOutput("failures")
)

server <- function(input, output, session) {
  shown <- reactive({
    subset(launches, year >= input$years[1] & year <= input$years[2] & agency_type %in% input$who)
  })

  output$per_year <- renderPlot({
    totals <- tapply(shown()$launches, factor(shown()$year, levels = input$years[1]:input$years[2]), sum)
    totals[is.na(totals)] <- 0
    barplot(totals, col = "#1F5F8B", border = NA, las = 2, cex.names = 0.7, ylab = "Launches")
  })

  output$failures <- renderText({
    total <- sum(shown()$launches)
    failed <- sum(shown()$failures)
    paste0(total, " launches, of which ", failed, " failed (", round(100 * failed / max(total, 1), 1), " percent).")
  })
}

shinyApp(ui, server)
