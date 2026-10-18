---
trigger: always_on
---

# Coding Rules (Next.js Project)

This project uses Next.js (App Router), React, and TypeScript. Before writing code, identify the task type and use the appropriate skill according to the rules below.

## When to Use Each Skill

### `next-best-practices` — Use for All Next.js Code

Follow this skill whenever:

- Adding or modifying any file under `app/` (page, layout, loading, error, or route).
- Deciding whether a component should be a Server Component or Client Component (whether to add `"use client"`).
- Implementing data fetching, Server Actions, or Route Handlers.
- Configuring metadata, images (`next/image`), or fonts (`next/font`).
- Handling hydration errors, Suspense, or error boundaries.

### `vercel-react-best-practices` — Use When Writing or Modifying React Components

- Creating any component.
- Working with state, effects, memoization, or performance issues.
- Addressing slow or repeated component rendering.

### `vercel-composition-patterns` — Use When Components Become Complex

- A component exceeds approximately 150 lines or has more than approximately six props.
- Multiple boolean props control different display options (such as a mix of `isCompact`, `showHeader`, and `variant`).
- Building reusable shared components (buttons, cards, forms, dialogs, and similar elements).
- Refactoring existing components.

### `web-design-guidelines` — Use to Review Completed UI

- Run a review with this skill after completing a page or major UI section.
- Use it when the user requests a UI review, accessibility check, or design audit.

### `frontend-design` — Use When Designing a New Interface from Scratch

- Creating a landing page, new page layout, or interface that needs visual direction.
- Not required for bug fixes or logic-only changes.

### `next-upgrade` / `next-cache-components` — Use Only for Specific Tasks

- Use `next-upgrade` when upgrading the Next.js version.
- Use `next-cache-components` when working with `"use cache"`, Cache Components, or PPR.

## Code Cleanliness Rules (Apply to All Tasks)

### File Structure

- Place pages and routes in `app/`.
- Place shared components in `components/`, with one component per file.
- Place utility functions in `lib/`.
- Place type definitions in `types/`.
- Use kebab-case for filenames (such as `user-card.tsx`) and PascalCase for component names (such as `UserCard`).

### Components

- Use Server Components by default. Add `"use client"` only when interaction requires state, event handlers, or browser APIs.
- Place `"use client"` on the smallest, lowest-level components possible; avoid applying it to an entire page.
- Split any single component that exceeds 150 lines.

### TypeScript

- Do not use `any`. Use `unknown` for uncertain types, then narrow them.
- Define types for all props.

### Code Style

- Do not leave commented-out old code.
- Do not leave `console.log` calls unless the user requests debugging.
- Order imports as follows: external packages → internal modules (`@/`) → relative paths → styles.
- Prefer early returns to deeply nested `if` statements.

## Checks Before Completing a Task

1. Run `npx eslint --fix` and `npx prettier --write` on the modified files.
2. Run `npx tsc --noEmit` to confirm there are no type errors.
3. Confirm that the file structure and component rules above are followed.
