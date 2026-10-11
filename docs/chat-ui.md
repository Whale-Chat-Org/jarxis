# Chat UI demo

Open `/chat` for the interactive frontend demo. Mock models, profile, conversation history,
suggestions and structured replies live in `const data = {}` in
`src/components/chat/chat-data.ts`. React state resets to these fixtures on refresh.

The composer supports Enter to send, Shift+Enter for a newline, model selection, in-memory
attachments, simulated progressive replies and stopping. History supports search, pinning,
renaming and confirmed deletion. Messages support copying, editing, retrying and feedback.
Editing or retrying replaces subsequent turns. Switching conversations cancels generation.
Files are represented by local chips; they are never uploaded or processed by a model.

There are no chat API calls, credentials, database changes or real provider connections.
The surrounding application retains its existing global providers and theme support.

## Verification

```sh
pnpm build
pnpm exec playwright test --config playwright.chat.config.ts
```

The separate browser configuration starts a production server on port 3020 with an unreachable
disposable database target. API calls from the inherited session provider are intercepted;
no migration, fixture user, sign-in, or database service is required. Tests cover both themes,
empty and populated chats at 375×667, 440×956, 768×1024, 960×1440, 1280×800 and 1440×900,
as well as the mobile sidebar breakpoint, short mobile heights and local interactions.
Screenshots are saved under the ignored `test-results/` directory.

The UI uses the official shadcn MessageScroller, Message, Bubble, Attachment and Marker registry
items. The `shadcn/tailwind.css` import supplies their scrolling and shimmer utilities. Registry
styles are converted to the project tokens; chat feature compositions are covered by the same
ESLint primitive and token rules as the other feature directories.
