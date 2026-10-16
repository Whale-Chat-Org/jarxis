# Jira ticket descriptions

Applies when creating or editing JAR work items (`acli jira workitem ...`). A ticket must be readable by a human in one scan, without losing detail.

## Required sections

Use these `##` headings, in this order. Omit a section only if it truly does not apply.

| Section               | Contents                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Why`                 | The problem and who it affects — not just what to do, but why we are doing it.                                                      |
| `What's included`     | Scope, grouped under bold sub-labels (e.g. **Page and components**, **Features**, **States to handle**). Note what is out of scope. |
| `Acceptance criteria` | Checklist of observable, testable behaviour. If it is testable, it is understandable.                                               |
| `How to test`         | **Manual** numbered steps and **Automated** checks.                                                                                 |
| `Links`               | Epic, depends on / blocks, related tickets, designs, references, estimate.                                                          |
| `Definition of done`  | Checklist: criteria met, evidence attached, checks pass, docs match, human review.                                                  |

## Readability

- One idea per bullet. Split sentences joined by `;`, `/` or "and" into separate bullets.
- Prefer lists, checklists and small tables over paragraphs. Use a table for key → result mappings or sets of values (e.g. viewport sizes).
- Spell out jargon on first use (e.g. "IME typing (Chinese or Japanese input)", "composer (message box)").
- Bold the action or name a reader scans for (**Send**, **Retry**); use code formatting for routes, files and commands.
- Put critical caveats in a warning panel (e.g. "A live check that wasn't run counts as **UNVERIFIED**, not passed").
- When rewriting an existing ticket, restructure only: keep every requirement, criterion, link and estimate. Do not drop or invent scope.

## Editing with acli

- Draft the description and show it to the user before writing to Jira; edits are visible to the whole team.
- Back up first: `acli jira workitem view <KEY> --json > <scratch>/<KEY>-backup.json`.
- Formatted descriptions must be Atlassian Document Format (ADF). Write a JSON file `{"issues": ["<KEY>"], "description": { "type": "doc", "version": 1, "content": [...] }}` and apply it with `acli jira workitem edit --from-json <file> --yes`. Plain `--description` text loses headings, tables and checklists.
- Useful ADF nodes: `heading`, `bulletList`, `orderedList`, `taskList`/`taskItem` (checklists, each needs a unique `localId`), `table`, `panel` (`panelType: warning`), text marks `strong`, `code`, `link`. The `code` mark combines only with `link`; `strong` + `code` on one text node fails with `INVALID_INPUT`, so split it into separate text nodes.
- Parent epic: `edit` cannot set or change it (`unknown field "parent"`); only `create --parent` can. Check the current parent with `acli jira workitem view <KEY> --fields parent --json` — the default view omits it.
- Dependencies as real links: for "<BLOCKER> blocks <KEY>", run `acli jira workitem link create --out <KEY> --in <BLOCKER> --type Blocks --yes` (types: Blocks, Cloners, Duplicate, Relates). acli's `--out`/`--in` are the reverse of its success message, so always verify the direction with `acli jira workitem view <KEY> --fields issuelinks --json`; fix a wrong link with `link delete --id <ID>`.
- Verify after editing: re-fetch with `--json` and confirm every heading, block and link direction saved.
