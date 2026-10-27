import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const SEARCH_FAILURE =
  'Web search is unavailable. Tell the user you could not search and avoid claiming current facts.';

type SearchResult = { title: string; link: string; snippet: string };

const searchResultSchema = z.array(
  z.object({ title: z.string(), link: z.string(), snippet: z.string() }),
);
const searchInputSchema = z.object({ query: z.string().min(1) });

export const webSearchTool = tool(async ({ query }) => query, {
  name: 'web_search',
  description: 'Search the web for current information. Input is a concise search query.',
  schema: searchInputSchema,
});

function conciseResults(raw: string): string {
  const results = searchResultSchema.parse(JSON.parse(raw) as unknown);
  const cleaned: SearchResult[] = results.slice(0, 5).map((result) => ({
    title: result.title.replace(/<[^>]*>/g, '').slice(0, 200),
    link: result.link.slice(0, 500),
    snippet: result.snippet.replace(/<[^>]*>/g, '').slice(0, 500),
  }));
  return cleaned.length ? JSON.stringify(cleaned) : 'No web search results found.';
}

export function createWebSearch() {
  const searchEngine = new DuckDuckGoSearch({ maxResults: 5 });
  return async (query: string) => conciseResults(await searchEngine.invoke(query));
}

export async function executeWebSearch(
  args: unknown,
  search: (query: string) => Promise<string>,
): Promise<string> {
  try {
    const { query } = searchInputSchema.parse(args);
    return await search(query);
  } catch {
    return SEARCH_FAILURE;
  }
}
