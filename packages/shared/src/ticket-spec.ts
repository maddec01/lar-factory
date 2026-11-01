// Ticket text shared by local conversion and subsequent Spec writes.
export function formatTicketSpec(spec: string, original: string): string {
  return `<!-- lar-factory:spec -->\n${spec}\n\n<!-- lar-factory:original -->\n<details>\n<summary>Original</summary>\n\n${original}\n\n</details>\n<!-- lar-factory:end -->`;
}
