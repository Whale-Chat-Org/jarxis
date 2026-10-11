export type ContentBlock =
  | { type: 'paragraph' | 'heading' | 'quote' | 'code'; text: string }
  | { type: 'list'; items: string[] };
export type ChatAttachment = { id: string; name: string; size: number; file?: File };
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  blocks?: ContentBlock[];
  attachments?: ChatAttachment[];
  feedback?: 'positive' | 'negative';
};
export type Conversation = {
  id: string;
  title: string;
  group: string;
  pinned: boolean;
  modelId: string;
  messages: ChatMessage[];
};
export const data = {
  profile: { name: 'Alex Morgan', initials: 'AM', label: 'Personal workspace' },
  groups: ['Today', 'Yesterday', 'Previous 7 days'],
  models: [
    {
      id: 'openai',
      name: 'GPT-5',
      provider: 'OpenAI',
      description: 'A versatile everyday companion',
    },
    {
      id: 'anthropic',
      name: 'Claude Sonnet',
      provider: 'Anthropic',
      description: 'Thoughtful writing and analysis',
    },
    {
      id: 'openrouter',
      name: 'Gemini via OpenRouter',
      provider: 'OpenRouter',
      description: 'Explore a different perspective',
    },
    {
      id: 'custom',
      name: 'Local model',
      provider: 'Custom',
      description: 'Your own API-compatible model',
    },
  ],
  suggestions: [
    {
      title: 'Make a plan',
      description: 'Turn a big idea into small steps',
      prompt: 'Help me plan a focused week for my next project.',
    },
    {
      title: 'Explore an idea',
      description: 'Find a fresh perspective',
      prompt: 'Help me explore an idea for a more thoughtful workspace.',
    },
    {
      title: 'Write something',
      description: 'Find the words you are looking for',
      prompt: 'Write a warm introduction for a new team member.',
    },
    {
      title: 'Build something',
      description: 'Work through a technical challenge',
      prompt: 'Show me a simple TypeScript function for grouping tasks.',
    },
  ],
  responses: {
    default: [
      {
        type: 'paragraph',
        text: 'Let’s give this idea a little structure. Start with the outcome you want, then work backwards to a small first step.',
      },
      { type: 'heading', text: 'A practical starting point' },
      {
        type: 'list',
        items: [
          'Define what a good result looks like.',
          'Choose one thing you can move forward today.',
          'Leave room to learn and adjust along the way.',
        ],
      },
      { type: 'quote', text: 'Progress becomes easier when the next step is clear.' },
      { type: 'paragraph', text: 'What would you like to focus on first?' },
    ] as ContentBlock[],
    writing: [
      { type: 'heading', text: 'A warm welcome' },
      {
        type: 'paragraph',
        text: 'Welcome to the team! We’re happy you’re here. Bring your questions, your ideas, and your own perspective — there’s plenty of room for all three.',
      },
      {
        type: 'paragraph',
        text: 'Take your first week to meet the people around you and get comfortable. We’ll help you find your footing, one conversation at a time.',
      },
    ] as ContentBlock[],
    code: [
      {
        type: 'paragraph',
        text: 'Here’s a small, typed helper that groups tasks by their status:',
      },
      {
        type: 'code',
        text: 'type Task = { title: string; status: string };\n\nfunction groupTasks(tasks: Task[]) {\n  return Object.groupBy(tasks, (task) => task.status);\n}',
      },
      {
        type: 'paragraph',
        text: 'It keeps the original tasks intact and returns a group for each status.',
      },
    ] as ContentBlock[],
  },
  conversations: [
    {
      id: 'week',
      title: 'A more focused week',
      group: 'Today',
      pinned: true,
      modelId: 'anthropic',
      messages: [
        {
          id: 'week-user',
          role: 'user',
          text: 'Help me make space for focused work without overloading my week.',
        },
        {
          id: 'week-assistant',
          role: 'assistant',
          text: 'A little structure can make a big difference.',
          blocks: [
            {
              type: 'paragraph',
              text: 'A little structure can make a big difference. Let’s build a week that gives important work room to breathe, while leaving space for the unexpected.',
            },
            { type: 'heading', text: 'Start with three priorities' },
            {
              type: 'list',
              items: [
                'Choose one outcome that matters most this week.',
                'Protect two quiet work sessions before filling your calendar.',
                'Keep a short list of smaller tasks for the gaps between meetings.',
              ],
            },
            { type: 'heading', text: 'A rhythm you can sustain' },
            {
              type: 'paragraph',
              text: 'Use Monday to set direction, Tuesday through Thursday to make progress, and Friday to reflect. Treat this as a rhythm rather than a rigid schedule.',
            },
            {
              type: 'quote',
              text: 'A good plan creates space. It does not have to fill every hour.',
            },
            {
              type: 'paragraph',
              text: 'I’ve included a simple outline you can adapt. Which part of your week tends to feel the most crowded?',
            },
          ],
          attachments: [{ id: 'outline', name: 'Weekly outline.txt', size: 1240 }],
        },
      ],
    },
    {
      id: 'workspace',
      title: 'Ideas for a calmer workspace',
      group: 'Today',
      pinned: false,
      modelId: 'openai',
      messages: [
        { id: 'workspace-user', role: 'user', text: 'What makes a workspace feel calmer?' },
        {
          id: 'workspace-assistant',
          role: 'assistant',
          text: 'Start by reducing visual noise, keeping your most-used tools nearby, and making a clear boundary between focused work and breaks.',
        },
      ],
    },
    {
      id: 'welcome',
      title: 'Welcome note for the team',
      group: 'Yesterday',
      pinned: false,
      modelId: 'anthropic',
      messages: [
        {
          id: 'welcome-user',
          role: 'user',
          text: 'Write a short welcome note for a new teammate.',
        },
        {
          id: 'welcome-assistant',
          role: 'assistant',
          text: 'Welcome aboard! We’re glad you’re here. Take your time settling in, ask plenty of questions, and know that your perspective is already welcome.',
        },
      ],
    },
    {
      id: 'typescript',
      title: 'A small TypeScript helper',
      group: 'Previous 7 days',
      pinned: false,
      modelId: 'custom',
      messages: [
        { id: 'typescript-user', role: 'user', text: 'How can I group a list of tasks?' },
        {
          id: 'typescript-assistant',
          role: 'assistant',
          text: 'Use Object.groupBy to collect tasks with matching statuses.',
          blocks: [
            { type: 'code', text: 'const grouped = Object.groupBy(tasks, (task) => task.status);' },
          ],
        },
      ],
    },
  ] as Conversation[],
};
export function responseFor(prompt: string) {
  return /typescript|code|function/i.test(prompt)
    ? data.responses.code
    : /write|welcome|introduction/i.test(prompt)
      ? data.responses.writing
      : data.responses.default;
}
export function blockText(blocks: ContentBlock[]) {
  return blocks
    .map((block) => (block.type === 'list' ? block.items.join('\n') : block.text))
    .join('\n\n');
}
