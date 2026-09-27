# Collaboration rules

- Other agents work concurrently. Edit only assigned files; preserve unrelated staged, unstaged and untracked changes. Do not reformat or revert others' work.
- Never print secrets, put them in prompts, or commit live .env files, passwords, tokens, cookies or credential-bearing URLs. Runtime tools may load .env without displaying it; use .env.example for variable names.
- When delegating, use bounded Claude CLI requests for implementation or review as requested by the project owner. Independently validate results and give concurrent workers disjoint file ownership.
