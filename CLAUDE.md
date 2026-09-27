# Claude instructions

Read [AGENTS.md](AGENTS.md) and follow the `.agent/rules/` files it lists for your task (architecture, design system, security, testing, collaboration). Prisma is the required ORM; inspect the schema and versioned migrations before database changes. For any UI work, follow [.agent/rules/design-system.md](.agent/rules/design-system.md): check the shadcn MCP registry before creating components and use design tokens only.

Read and follow [.agent/rules/git-rules.md](.agent/rules/git-rules.md) before starting work. Branch before feature/fix work; do not commit, push or open a PR/MR without an explicit user request. If no Git repository exists, report that branching is unavailable rather than initializing it without authorization.

Keep shared instructions in `.agent/rules/` (indexed by AGENTS.md) rather than duplicating them here.
