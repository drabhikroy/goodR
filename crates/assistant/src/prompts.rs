//! The words sent to the model for each kind of help. Every request carries
//! the same short instructions: plain language, short answers, R code in one
//! fenced block, no invented functions. It also carries what the model needs
//! to know about the person's session: the R version and the names of the
//! objects in it, with column names for tables. Values inside the data are
//! never sent, even though the model runs on this computer, because a
//! name is enough to write correct code and values can be private.

use crate::ollama::ChatMessage;
use serde::Deserialize;

/// What the person asked for.
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Task {
    /// A free question about R or the session.
    Ask { question: String },
    /// Why a statement failed, and a fixed version.
    ExplainError { code: String, message: String, plain: String },
    /// What some code does.
    ExplainCode { code: String },
    /// Code that does what the person describes.
    WriteCode { request: String },
    /// A clearer or safer version of some code.
    Improve { code: String },
    /// The same code with comments added.
    Comment { code: String },
}

/// Facts about the session that make answers fit it.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Context {
    pub r_version: String,
    /// Each object as "name (class): column, column".
    pub objects: Vec<String>,
    /// Packages the script loads.
    pub packages: Vec<String>,
}

const INSTRUCTIONS: &str = "You help people write and understand R code inside an R editor. \
Write for someone who is new to R. Use plain, everyday words, and when a technical word is needed, explain it in a few words. \
Keep answers short: a few sentences, then code if code helps. \
Put R code in a single fenced block that starts with ```r. \
Use base R unless the person's code already uses a package, and then prefer that package. \
Only use functions and packages that really exist. If you are not sure, say so. \
Never claim to have run code. The person decides what to run.";

fn context_text(context: &Context) -> String {
    let mut lines = Vec::new();
    if !context.r_version.is_empty() {
        lines.push(format!("R version: {}", context.r_version));
    }
    if !context.packages.is_empty() {
        lines.push(format!("Packages the script loads: {}", context.packages.join(", ")));
    }
    if !context.objects.is_empty() {
        // A long session is cut to the first few dozen objects, which keeps
        // the request inside a small model's working memory.
        let shown: Vec<&String> = context.objects.iter().take(40).collect();
        lines.push(format!("Objects in the session:\n{}", shown.iter().map(|object| format!("- {object}")).collect::<Vec<_>>().join("\n")));
    }
    lines.join("\n")
}

fn fenced(code: &str) -> String {
    format!("```r\n{}\n```", code.trim_end())
}

/// The request for a task, as chat messages. `history` holds earlier turns
/// of a conversation, so a follow up question has its background.
pub fn messages(task: &Task, context: &Context, history: &[ChatMessage]) -> Vec<ChatMessage> {
    let mut system = INSTRUCTIONS.to_string();
    let facts = context_text(context);
    if !facts.is_empty() {
        system.push_str("\n\n");
        system.push_str(&facts);
    }
    let request = match task {
        Task::Ask { question } => question.trim().to_string(),
        Task::ExplainError { code, message, plain } => format!(
            "This R code did not run.\n\n{}\n\nR said: {}\n\nIn plain words: {}\n\nExplain why it failed in two or three short sentences, then give the corrected code.",
            fenced(code),
            message.trim(),
            plain.trim()
        ),
        Task::ExplainCode { code } => format!("Explain what this R code does, step by step, in plain words. Do not rewrite it.\n\n{}", fenced(code)),
        Task::WriteCode { request } => format!("Write R code that does the following. Add a short comment above each step.\n\n{}", request.trim()),
        Task::Improve { code } => format!(
            "Suggest a clearer or safer version of this R code that gives the same result. Say in one or two sentences what changed and why, then give the new code.\n\n{}",
            fenced(code)
        ),
        Task::Comment { code } => format!(
            "Return this R code with a short plain comment above each step. Do not change the code itself. Give only the code block.\n\n{}",
            fenced(code)
        ),
    };
    let mut out = vec![ChatMessage { role: "system".into(), content: system }];
    // Only the last few turns are kept, so a long conversation does not push
    // the instructions out of a small model's working memory.
    let start = history.len().saturating_sub(6);
    out.extend(history[start..].iter().cloned());
    out.push(ChatMessage { role: "user".into(), content: request });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_error_request_carries_the_code_the_message_and_the_session() {
        let context = Context { r_version: "4.6.1".into(), objects: vec!["penguins (data.frame): species, body_mass".into()], packages: vec![] };
        let task = Task::ExplainError { code: "lm(body_mass ~ flipper, data = penguins)".into(), message: "object 'flipper' not found".into(), plain: "R could not find flipper".into() };
        let messages = messages(&task, &context, &[]);
        assert_eq!(messages[0].role, "system");
        assert!(messages[0].content.contains("plain, everyday words"));
        assert!(messages[0].content.contains("penguins (data.frame): species, body_mass"));
        assert!(messages[1].content.contains("```r\nlm(body_mass ~ flipper, data = penguins)\n```"));
        assert!(messages[1].content.contains("object 'flipper' not found"));
    }

    #[test]
    fn a_follow_up_keeps_only_recent_turns() {
        let history: Vec<ChatMessage> = (0..10).map(|index| ChatMessage { role: if index % 2 == 0 { "user" } else { "assistant" }.into(), content: index.to_string() }).collect();
        let messages = messages(&Task::Ask { question: "and then?".into() }, &Context::default(), &history);
        assert_eq!(messages.len(), 1 + 6 + 1);
        assert_eq!(messages[1].content, "4");
        assert_eq!(messages.last().unwrap().content, "and then?");
    }

    #[test]
    fn tasks_read_from_the_interface_shape() {
        let task: Task = serde_json::from_str(r#"{"kind":"writeCode","request":"a bar chart of species"}"#).unwrap();
        assert_eq!(task, Task::WriteCode { request: "a bar chart of species".into() });
    }
}
