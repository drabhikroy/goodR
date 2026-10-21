# A Shiny app with mistakes on purpose ----
#
# This app has four mistakes, the kind Shiny never points at. Each one is
# underlined and listed above the script, most with a one click fix. Fix
# them one at a time and watch the list shrink, then press Run app.
#
#   1. The server fills output$sumary, but the UI asks for "summary".
#   2. The reactive found is read as found instead of found().
#   3. input$rows is read outside a reactive, so the app stops at once.
#   4. The id "method" is used for two inputs.

library(shiny)

planets <- read.csv("../data/exoplanets.csv")

ui <- fluidPage(
  titlePanel("Planets around other stars"),
  selectInput("method", "How they were found", choices = sort(unique(planets$method))),
  checkboxInput("method", "Show every method", value = FALSE),
  numericInput("rows", "Rows to show", value = 5, min = 1, max = 50),
  verbatimTextOutput("summary"),
  tableOutput("rows_table")
)

server <- function(input, output, session) {
  how_many <- input$rows

  found <- reactive({
    planets[planets$method == input$method, ]
  })

  output$sumary <- renderPrint({
    summary(found()$mass_jupiter)
  })

  output$rows_table <- renderTable({
    head(found, 5)
  })
}

shinyApp(ui, server)
