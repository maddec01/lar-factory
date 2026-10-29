# The board writes descriptions as Markdown

The board's description editor reads and writes Markdown only, on GitHub and Azure DevOps. Editing an Azure work item whose description is HTML converts it to Markdown, and saving switches the field to Markdown for good, since Azure can't switch it back. One format keeps one editor and one save path. Formatting Markdown can't express, such as colours or merged table cells, is lost on that first save, and we accept the loss over keeping a second, HTML editor.
