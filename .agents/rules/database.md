# Database & Supabase

## Migrations
- Always create a migration file via `supabase migration new`.
- Ensure `supabase/schema.sql` is updated using `npm run db:dump` after schema changes.

## Best Practices
- Use snake_case for all tables and columns.
- Always define RLS policies for every new table.
- Use `lib/supabase/server.ts` for server-side operations.

## Gold Standard
- See `supabase/migrations/20260328150000_sync_and_timeline.sql` for table structure patterns.
- Use `types/database.types.ts` for typed database access.

## Code Example
```typescript
// Using generated types
import { createClient } from '@/lib/supabase/server';
import { Database } from '@/types/database.types';

const supabase = createClient<Database>();
const { data, error } = await supabase.from('repos').select('*').eq('id', id);
```
- **DO**: Run `npm run db:types` after any SQL change.
- **DON'T**: Use raw SQL strings in application logic; use the Supabase client.