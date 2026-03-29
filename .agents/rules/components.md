# Component Conventions

## Structure
- **Co-location**: Keep styles, types, and component logic in the same file.
- **Client Components**: If using `useEffect`, `useState`, or `Zustand` hooks, add `'use client'` at the top.
- **Server Components**: Keep page components as server components whenever possible.

## Patterns
- **Zustand**: Access global state through defined stores in `lib/store/` (e.g., `useAppStore`).
- **Props**: Define interfaces for props. Avoid implicit `any`.

## Gold Standard
- Use `app/components/dashboard/RepoCard3D.tsx` for 3D interactions.
- Use `app/components/ui/*.tsx` for reusable shadcn/ui components.

## Code Example
```tsx
'use client';
import { useAppStore } from '@/lib/store/app-store';

export const RepoCard = ({ id }: { id: string }) => {
  const data = useAppStore((s) => s.repos[id]);
  if (!data) return null;
  return <div className="p-4 bg-card">{data.name}</div>;
};
```
- **DO**: Use `clsx` and `tailwind-merge` (via `lib/utils.ts`) for class names.
- **DON'T**: Define complex logic inside the component; move to a hook.