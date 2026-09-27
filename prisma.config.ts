import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx scripts/seed.ts' },
  // Generation and schema-only diff never connect; deploy still requires a real URL.
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://generate:generate@localhost:5432/generate_only',
  },
});
