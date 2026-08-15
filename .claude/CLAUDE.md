# SubScript Project Guidelines

## Skills
Read and follow these skill files when relevant to the task:

- **Frontend Design**: Read `~/.claude/skills/frontend-design/SKILL.md` when building or redesigning any UI component. Follow its principles for distinctive, intentional visual design.
- **UI/UX Pro Max**: Read `~/.claude/skills/ui-ux-pro-max/SKILL.md` when making UI/UX decisions. Follow its accessibility, performance, and design system guidelines.
- **Humanizer**: Read `~/.claude/skills/humanizer/SKILL.md` when writing ANY user-facing text. Apply its patterns to make copy feel human, not machine-generated. Use contractions, short sentences, and plain language.

## Project Architecture
- Next.js App Router project with Web3 (wagmi/viem) integration
- Two dashboards: Merchant (`src/app/dashboard/page.tsx`) and User (`src/app/dashboard/user/page.tsx`)
- Shared sidebar: `src/components/dashboard/DashboardSidebar.tsx`
- Shared header: `src/components/DashboardHeader.tsx`
- Shared notification bell: `src/components/dashboard/NotificationBell.tsx`
- Design accent colors: Merchant = `#00d2b4` (teal), User = `#ccff00` (lime)
- Dark theme with glassmorphism throughout

## Code Style
- Preserve all existing comments and docstrings unrelated to changes
- Use sentence case for user-facing headings (not ALL CAPS)
- Apply humanizer patterns to all new or modified user-facing text
