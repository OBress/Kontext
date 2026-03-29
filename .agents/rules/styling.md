# Styling Conventions

## Methodology
- Use Tailwind CSS utility classes exclusively.
- Avoid global CSS unless necessary for base resets.
- Use `cn()` helper from `lib/utils.ts` for class merging.

## Design Tokens
- Follow the color palette defined in `app/globals.css`.
- Use `tailwindcss-animate` for consistent animations (e.g., transitions on modal open).

## Code Example
```tsx
import { cn } from "@/lib/utils";

<div className={cn("flex items-center space-x-2", className)}>
  <Button variant="ghost">Click me</Button>
</div>
```
- **DO**: Keep responsive design in mind using `sm:`, `md:`, `lg:` prefixes.
- **DON'T**: Overuse `!important` tags.