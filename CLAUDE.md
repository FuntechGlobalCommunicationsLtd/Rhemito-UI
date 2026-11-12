# Rhemito UI

## Context

Rhemito is a retail money transfer responsive application based out of the United Kingdom. We are building a world class professional, modern premium UI/UX and completely working prototype.

The user/end-customer must register to use Rhemito.
As a part of registration the end-user/Customer must verify his email.
Live rates for currency-Country Corridors are provided to the customer and he can enter the desired amount to send.
The End user must pass KYC before creating a Transaction.

**Two types of KYC:**
1. **Mini KYC:** Country, First name, Last name, DOB, Address Line 1 (mandatory), Address Line 2 (optional), City, PIN/ZIP/POST Code, Phone (optional).
2. **Full KYC:** When threshold is hit — ID document upload + Selfie liveness check.

After adding the beneficiary/recipient (narration/TXN remarks is optional but mandatory for Nigerian beneficiaries), the Sender reviews the Transaction and Pays using a selected payment method.

Additional features: receiving/requesting payments, GroupPay funding campaigns, bonuses and discounts, collection accounts, managing recipients/beneficiaries and senders, help tickets, and notifications (bell + PUSH).

### Supported Currencies & Countries

**Currencies:** GBP, USD, EUR, NGN, CAD, AUD, JPY, CNY, INR, ZAR, KES, GHS, AED

**Countries:** UK, USA, Nigeria, Canada, Ghana, Kenya, South Africa, Germany, France, India, China, UAE

## Rules

- Always ask me queries one by one in case of confusion or if you need clarity.
- Ask before implementing if you have a good suggestion.
- UI/UX will always be world class, modern and premium.
- Every new page or element must match the basic/default theme.
- Always implement proper messaging display (popup/toast) after any submission or processing so that the customer knows what is happening.
- Mind the back buttons for going back to the previous step/screen.
- Keep always close/abort button on the popups if they are not mandatory/modals that can not be closed.
- Always plan before coding and get approval of what you are implementing if it is a suggestion.
- I can share images/screenshots but before implementing them blindly mind the theme/colour and logic/flow for Fintech/money transfer.
- Mind the functionality and effects across the application when we are implementing something new (a field/flow or Text) so that we don't break the flow/functionality while adding or changing anything.
- In all forms, always keep mandatory fields on top above optional fields (keeping postal Address Line 2 grouped directly under Address Line 1).

## UX-First Rule (Mandatory — No Exceptions)

**For ANY change that affects how something looks or feels**, the UX designer
must be consulted first — before any engineer writes a single line of UI code.
This includes: new pages, new components, animations, visual improvements,
layout changes, redesigns, and UI enhancements of any size.

**The required sequence for ALL UI work:**
1. `uiux-designer` researches best-in-class benchmarks for the specific pattern
2. `uiux-designer` proposes 1–3 design directions with clear rationale
3. User reviews the proposal and either approves or requests changes
4. `uiux-designer` iterates until user explicitly approves
5. `frontend-web-engineer` implements exactly what was approved — nothing more, nothing less

**The engineer never decides the design.** If a visual improvement is
requested (e.g. "improve the countdown timer", "make this more modern"),
the UX designer owns the proposal. The engineer owns the implementation.
These are two separate and sequential steps — never combined.

## Git Workflow

1. **Branch before changes:** Always create a new branch before making any changes. Use a clear branch name describing the feature or fix (e.g., `feature/add-UI-validation`, `fix/payment-amount-display`).
2. **Run all tests:** After changes are made, run all tests (unit tests, integration tests, and UI/E2E tests) to catch any broken functionality before committing.
3. **Open a Pull Request:** Once testing is successful, push the branch and open a pull request to merge back into the main branch.
4. **Review before merge:** Ensure the pull request includes a review step, so potential conflicts or risks are spotted before merging.
5. **Delete branch after merge:** After merging, delete the feature/fix branch both locally and remotely to keep the repository clean.
6. **Monitor after merge:** After merging, monitor the functionality — if any issue arises, roll back or fix it in a new branch.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| Routing | Wouter 3 (NOT React Router) |
| Server State | TanStack React Query 5 |
| Styling | Tailwind CSS 4 + shadcn/ui (New York style) |
| Animation | Framer Motion |
| Forms | React Hook Form + Zod validation |
| Icons | Lucide React |
| Backend | Express.js + TypeScript (via tsx) |
| Database | PostgreSQL + Drizzle ORM |
| Session Auth | express-session + connect-pg-simple |
| E2E Testing | Playwright |
| Unit Testing | Vitest + Testing Library |

## Project Structure

```
client/src/
  components/ui/    # shadcn/ui primitives — add via CLI, do NOT edit manually
  components/       # App-level shared components (modals, layout, etc.)
  pages/            # Route page components
  hooks/            # Custom React hooks (use-toast, use-mobile)
  lib/queryClient.ts # apiRequest(), getQueryFn(), queryClient config
  lib/utils.ts      # cn() utility (clsx + tailwind-merge)
  data/             # Static data (knownSenders, payoutAccounts)
  index.css         # Theme CSS variables and Tailwind base
  App.tsx            # Root: ErrorBoundary → QueryProvider → Router

server/
  index.ts          # Express server entry point
  routes.ts         # API route definitions
  vite.ts           # Vite dev middleware integration

shared/
  schema.ts         # Drizzle ORM schema + Zod insert schemas

tests/e2e/          # Playwright E2E specs (.spec.js)
```

## Path Aliases

Configured in `tsconfig.json` — always use these, never cross-boundary relative paths:
- `@/*` → `./client/src/*`
- `@shared/*` → `./shared/*`

## Coding Conventions

### Components
- Functional components with TypeScript interfaces for props
- shadcn/ui components live in `components/ui/` — add new ones via shadcn CLI
- Use CVA (`class-variance-authority`) for component variants
- Use `cn()` from `@/lib/utils` to merge Tailwind classes

### State Management
- **Server state:** TanStack Query (`useQuery`, `useMutation`) — never store API data in local React state
- **Local UI state:** `useState` / `useReducer`
- Query client uses `staleTime: Infinity` — invalidate manually after mutations

### API Patterns
```typescript
// Queries — queryKey doubles as the URL
import { getQueryFn } from "@/lib/queryClient";
useQuery({
  queryKey: ["/api/endpoint"],
  queryFn: getQueryFn({ on401: "returnNull" }), // or "throw"
});

// Mutations
import { apiRequest } from "@/lib/queryClient";
const res = await apiRequest("POST", "/api/endpoint", body);
```
All requests use `credentials: "include"` for session cookies.

### Forms
- React Hook Form + `@hookform/resolvers/zod` for validation
- Use shadcn `<Form>`, `<FormField>`, `<FormItem>`, `<FormLabel>`, `<FormMessage>`
- Define Zod schemas in `shared/schema.ts` using `drizzle-zod` when tied to DB

### Styling
- **Tailwind CSS only** — no inline styles, no CSS modules
- Theme variables in `client/src/index.css` — use via `hsl(var(--variable))`
- Always use shadcn color tokens: `primary`, `secondary`, `muted`, `accent`, `destructive`
- Headings: `font-display` (Plus Jakarta Sans) / Body: `font-sans` (Inter)

### Animation
- Framer Motion for page transitions and micro-interactions
- Keep animations subtle and premium — no flashy or distracting motion

### Routing
- **Wouter** (`Switch`, `Route`, `useLocation`, `useRoute`)
- All routes defined in `App.tsx`

### Toasts & Feedback
- Use `useToast()` from `@/hooks/use-toast` — Toaster is already mounted in App.tsx
- Always show a toast after: form submissions, API errors, state changes

## Theme

```css
--primary: 217 91% 60%;           /* Blue — brand color */
--destructive: 0 84% 60%;         /* Red — errors */
--teal: 168 76% 42%;              /* Teal — success */
--purple: 258 90% 66%;            /* Purple — accent */
--background: 210 20% 98%;        /* Page background */
--card: 0 0% 100%;                /* Card surfaces */
--radius: 0.75rem;                /* Base border radius */
```

Fonts: `Plus Jakarta Sans` (display), `Inter` (body). See `components.json` for full shadcn/ui config.

## Testing

### E2E (Playwright) — run from project root, dev server must be running

```bash
npx.cmd playwright test --reporter=line          # Full suite
npx.cmd playwright test tests/e2e/dashboard.spec.js  # Single file
npx.cmd playwright test --ui                      # Debug UI mode
```

### Unit Tests (Vitest)

```bash
npx vitest run    # Single run (config: vitest.config.ts)
npx vitest        # Watch mode
```

### Pre-commit — always run before git commit

```bash
npx.cmd playwright test --reporter=line
```

## Rewards contract tests

Promo Code, Bonus (one bonus balance, `credit_source` REFERRAL / SCHEME / MANUAL), Referral and the Send Money payment flow are implemented and working. Their rules are pinned by contract tests so a wrong change fails loudly.

- **Before changing** promo, bonus, referral or payment-flow code (`server/promo/*`, `server/bonus/*`, `server/rewardsService.ts`, `server/rewardsRoutes.ts`, `server/sendMoneyRoutes.ts`, `client/src/features/{promo,bonus}/**`, `client/src/lib/{rewards,sendMoney}.ts`, `SendMoney.tsx`, `BonusAndDiscounts.tsx`, `ReferEarnCard.tsx`), run `npm run test:contracts`. The UI contracts are in `tests/e2e/rewards_contract.spec.js` (`npm run e2e:contracts`, dev server running).
- **When one fails**, read the `CONTRACT <id> BROKEN` block at the top of the failure: it states the rule, WHY it exists, HOW it is implemented / the fix, and the CODE files. Restore the implemented behaviour; do not edit the test to make it pass.
- **Only change a contract** if the product owner (Mohammad) has explicitly changed the rule. Then update the test (and its `why` / `fix` text) in the same PR and state the reason in the PR description.
- Tests live in `client/src/__tests__/contracts/` (`promo`, `bonus`, `referral`, `payment-flow`; helper `_contract.ts` provides `rule(id, title, { why, fix, where }, fn)`, `_mitoStub.ts` is a stub Mito service wired to the real Rhemito routes).
