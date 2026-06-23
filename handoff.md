# INZU Workstation — Session Handoff

_Last updated: end of this working session._

## 1. Goal

Build **INZU Workstation** — an integrated **Transport, Safety & Compliance Management System** for
**INZU MCS Limited**, which operates at two First Quantum Minerals (FQM) sites in Zambia:

- **FQM Trident** (Kalumbila) — projects/sections: Pit, Sentinel, Enterprise, Security, Omega, **Dewatering**.
- **Kansanshi** (Solwezi) — sections: Inside the Mine, Outside the Mine. _(Note: it's just "Kansanshi", not "FQM Kansanshi".)_

It's being built **incrementally, frontend-first**. There is **no backend yet** — every module is a
localStorage-backed mock that's structured so a real API can replace each store later without touching UI.

**Stack:** React 18 + Vite + TypeScript + Tailwind; react-router-dom v6; lucide-react; recharts; xlsx; jsPDF + jspdf-autotable.

## 2. How to work in this repo (important conventions)

- **App lives in `frontend/`.** Run commands from there.
- **The user runs the dev server themselves** (Chrome). **Do NOT start a preview/dev server.**
- **Verify with `npx tsc --noEmit`** (run in `frontend/`). Then tell the user to **hot-reload**.
- **When a store's seed shape changes**, tell the user to clear the relevant `localStorage` key
  (or use **Admin → Data → Clear/Restore**), because stores only re-seed when their key is absent.
- **Data layer pattern:** localStorage-backed reactive stores via `useSyncExternalStore`; a generic
  `makeStore<T>` factory in several modules; audit stamping via `getActor()` (`lib/audit/actor.ts`).
  Binary uploads (scans/photos/attachments) live in **IndexedDB** via `lib/storage/fileStore.ts`.
- **Match surrounding code style** (compact, idiomatic, Tailwind tokens). Design tokens: brand `#D16B21`,
  navy `#0F1B33`, status good `#2E7D4F`, warning text `#8a6d10`, critical `#B3261E`, canvas `#F2F2F2`.

## 3. Current state of the code (what's built & working)

`npx tsc --noEmit` is **clean** as of session end.

### Auth & Admin (this session)
- **Login required** with admin-created accounts (no self sign-up). Client-side "backend":
  `lib/auth/users.ts` (users, authenticate, sessions/login history), `auth/AuthContext.tsx`.
  - **Seed account only: `admin` / `admin123`** (role **Administrator**). Demo accounts were removed.
  - Passwords stored in localStorage (shell phase — **not hashed**; this is the piece to move to a real server later).
- **Permissions engine** (`lib/permissions.ts`): editable per-role defaults (`rolePermsStore`) + per-user
  overrides; `permFor/canView/canEdit` apply the current user's overrides via `setActivePermissions`.
  - New **`administrator`** role (in `lib/roles.ts`) — **always full access**, can't be locked out
    (short-circuits in `permFor`, hidden-pages ignored in AuthContext).
- **Admin page** (`pages/admin/Admin.tsx`) tabs: **Users** (CRUD, role, branch, extra-branch access,
  per-user permission overrides, hide sub-pages, "is employee" → creates HR profile, reset password,
  activate/deactivate), **Roles & Permissions** (editable matrix; Administrator row fixed), **Sessions**
  (last login, login count, recent history), **Approval order** (`lib/auth/approvals.ts` — reorder/add/remove),
  **Branches** (rename client/branch display names — `brandingStore` in `lib/roles.ts`), **Data** (clear/restore).
- **Branch display names are admin-editable** with corrected defaults: Kansanshi = "Kansanshi",
  Trident = "FQM Trident". `BRANCHES` is a live `export let` rebuilt on change; AuthContext bumps re-render.
- **Admin is the top nav item** and the **landing page** for admins (`login()` returns a `landing` path).
- Self-lockout guards (can't delete/deactivate/strip-admin from your own account).

### Safety module (this session)
- Sub-pages all built: **Overview, Incidents, Driver Compliance, Training Records, Hazard Register,
  CAP Tracker, LOTO Register, Tool Inspections** (`pages/safety/*`, `lib/safety/registers.ts`).
- **Incidents** generalised beyond speed: speed-escalated **and** Safety-registered (near miss, accident, etc.).
  Flow: Safety investigates + report + evidence (charge statement / exculpatory / memo / **incident report**)
  → **proposes a verdict** → Ops **approves/rejects**; approved fine → **payroll deduction**
  (`lib/payroll/deductions.ts`). Audit trail + stepper in `components/safety/CaseModal.tsx`.
  Closing an incident also **closes its linked speed event**.
- **Driver Compliance** is an **FQM class matrix** (drivers × classes), prerequisites **Medical + Silicosis**
  gate the trainings, per-cell date/expiry/where + proof upload, score per driver, side drawer.
  Classes are **admin-add/removable** with editable flags (expiry / prerequisite / requires-proof).
- Medical was **removed from the Driver profile** (it lives in Safety → Driver Compliance now).

### Drivers module (this session)
- **Bulk Excel upload + export** for drivers (`lib/drivers/excel.ts`, `components/drivers/DriverImportModal.tsx`).
- **Roster** reworked to **three columns: Day / Night / Off**, sorted by section, with section-staffing
  summary (counts per section + on-shift, shortage flags), section filter, and a **Cover** toggle
  (mark a rest-day driver as covering → Overtime). Adding drivers is NOT done here (Profiles only);
  the pencil opens a crew/section **Reassign** modal.
- **Work Schedule calendar** (`pages/drivers/DriverSchedule.tsx`) — month grid, Day/Night/Off colour-coded,
  coverage rows, today highlight. Rotation model in `lib/drivers/schedule.ts`.
- **Rotation is derived from section** (`sectionPattern`): **Pit → 14/7**, **Security & Dewatering → 10/5**,
  others → **7/7 split** (Day for crew A, Night for crew B). Per-driver you only set the **cycle start (anchor)**.
- **Schedule drives shift status everywhere**: `driverShiftState` uses the rotation; **overtime = working a
  scheduled rest day**. Roster, dashboard "on shift now", and the calendar are one source of truth.

### Fleet module (this session)
- **Licensing & Documents redesigned** to **select-a-vehicle** cards with a left colour accent:
  green = compliant, yellow = expiring, red = action needed (expired/some missing),
  **deeper red = no documents registered**. Click → `components/fleet/VehicleDocsModal.tsx`
  (view/upload each of Road Tax, Fitness, Insurance, FQM Inspection). Filter chips + search.
- **"Vehicles missing required documents"** surfaced on the **dashboard Needs-attention** feed and the
  **notification bell**, targeted at **Workshop (acts)** + **Operations/Asst Ops (aware)**.
- **Branch transfer cascades documents**: changing a vehicle's branch moves its docs too; a startup
  reconcile (`reconcileVehicleDocBranches` in `lib/fleet/store.ts`, called from Layout) heals old mismatches.

### Dashboard (this session)
- **"Needs your attention"** redesigned + **fully real** (severity summary pills, colour accents,
  per-item icons, sorted critical→to-do), role-targeted; data-entry roles see "Your tasks today".
- Domain cards/visuals now **real**: Fleet, Drivers (active/on-shift/overtime from real records),
  Operations (today's allocations), HR (employee headcount), Speed & Safety cards, OpsInsight staffing
  (fleet donut, drivers-by-section, overtime, drivers-on-shift). **Workshop & Payroll cards removed**
  (those modules have no real store yet).

### Speed module (this session)
- **Overview**: compare any **two months** (default current vs previous).
- **Confirmed** status is now **green**; status counters (StatChips) on the events page; each event row
  shows its linked incident stage ("→ Incident: …").
- Speed access permissions: **Tracker + Ops + Asst Ops** edit; **MD/Directors** view; **Safety has none**.

### Messaging (this session)
- Reworked to **role-to-role** (testable across logins) with **attachments** (images inline, docs as chips).
  `lib/messaging/store.ts` (role-keyed conversations), `pages/messages/Messages.tsx` (+ Close button).

### Notifications (this session)
- Role-targeted (`lib/notifications/store.ts`): incidents (safety/ops/closed), confirmed-speed→escalators,
  fuel authorisations→ops, mileage pending→ops, **missing vehicle docs→workshop+ops**, licensing/grounded→all.
  Admins see everything.

## 4. Files actively edited this session (the hot set)

- `frontend/src/lib/permissions.ts`, `frontend/src/lib/roles.ts` (roles + branding store), `frontend/src/auth/AuthContext.tsx`
- `frontend/src/lib/auth/users.ts`, `frontend/src/lib/auth/approvals.ts`, `frontend/src/pages/admin/Admin.tsx`, `frontend/src/pages/auth/LoginPage.tsx`
- `frontend/src/lib/safety/cases.ts`, `frontend/src/lib/safety/registers.ts`, `frontend/src/components/safety/*`, `frontend/src/pages/safety/*`
- `frontend/src/lib/payroll/deductions.ts`
- `frontend/src/lib/drivers/schedule.ts`, `frontend/src/lib/drivers/types.ts`, `frontend/src/lib/drivers/store.ts`, `frontend/src/lib/drivers/excel.ts`
- `frontend/src/pages/drivers/DriverRoster.tsx`, `DriverSchedule.tsx`, `DriverProfiles.tsx`; `frontend/src/components/drivers/{ReassignModal,SetScheduleModal,DriverImportModal,DriverDetail}.tsx`
- `frontend/src/pages/fleet/Licensing.tsx`, `frontend/src/components/fleet/VehicleDocsModal.tsx`, `frontend/src/lib/fleet/store.ts`, `frontend/src/lib/documents/store.ts`
- `frontend/src/pages/Dashboard.tsx`, `frontend/src/components/dashboard/OpsInsight.tsx`
- `frontend/src/pages/speed/{SpeedOverview,SpeedEvents}.tsx`, `frontend/src/lib/speed/{analytics,types}.ts`
- `frontend/src/lib/messaging/store.ts`, `frontend/src/pages/messages/Messages.tsx`
- `frontend/src/lib/notifications/store.ts`, `frontend/src/components/layout/{Topbar,Sidebar,Layout}.tsx`
- `frontend/src/App.tsx`, `frontend/src/lib/nav.tsx`, `frontend/src/lib/demo/reset.ts`
- Removed: `frontend/src/components/RoleSwitcher.tsx`

## 5. Things tried that failed / bugs hit (and the fix)

- **Messaging "can't reply after receiving an attachment".** Root cause: a persisted message without an
  `attachments` array → `m.attachments.map(...)` threw → error boundary replaced the page (persisted, so it
  recurred every load). **Fix:** `load()` now `coerce()`s/repairs persisted state (guarantees `attachments`
  is an array, drops un-migratable legacy records) + render guards `(m.attachments ?? [])` + `useFileUrl`
  `.catch`. The first guard attempt (just tightening `isValidState` to *discard*) was wrong — destructive and
  still crashed in some paths.
- **Messaging page "looked weird" — composer pushed off-screen.** Classic flex bug: a `flex-1` scroll area
  needs `min-h-0` to scroll instead of growing. **Fix:** added `min-h-0` to columns + scroll areas and
  `shrink-0` to header/composer.
- **Kansanshi still showed INZ 110 after transfer to Trident.** Documents carry their own `branch`, set at
  upload, and didn't follow the vehicle. **Fix:** cascade branch on vehicle update + startup reconcile.
- **Dashboard showed drivers/numbers that don't exist.** It was MOCK data. **Fix:** wired to real stores;
  removed cards (Workshop/Payroll) that had no real data rather than fake them.

## 6. Explicit PENDING / next steps

1. **Default branch = FQM Trident (NOT done).** The user asked for new logins/users to default to Trident and
   for Trident to be listed first; I started but was interrupted before editing. Likely changes:
   `BRANCH_CODES` order in `lib/roles.ts` (Trident first), AuthContext `viewBranch` fallback, and new-user
   default in `Admin` UserModal. The user also restated Trident project context (Enterprise/Sentinel differ
   in billing & work schedules — already reflected in mileage + schedule code).
2. **Wire approval order into enforcement.** `approvalsStore` chains are editable/stored but the actual
   workflows (incident verdict, mileage, fuel) still have approver roles inline. Make each read the chain.
3. **Auto-stagger anchors per section** so continuous patterns (Pit/Security/Dewatering) give round-the-clock
   coverage instead of everyone resting on the same days.
4. **DriverDetail "shift window" line** still uses the old crew/section model — switch it to show the rotation
   (today's shift + next rest day) for full consistency.
5. **Log the specific covered shift** when a rest-day driver is marked covering (currently just an overtime flag).
6. **Build Workshop / HR / Payroll modules** (currently placeholders / no real stores) — once they exist,
   their dashboard cards and attention items will light up automatically (the patterns are already there).
7. **Real backend** for production: move auth (hashed passwords, sessions) and ideally all stores server-side.
   Designed so the swap is isolated to `lib/auth/users.ts` + `auth/AuthContext.tsx` first.

## 7. Quick start for the next session

1. `cd frontend` → user runs their dev server (don't start one).
2. Log in as **`admin` / `admin123`** (Administrator → lands on Admin page).
3. If data looks stale after a seed-shape change: **Admin → Data → Restore demo data** (or Clear), then re-login.
4. Make changes → `npx tsc --noEmit` → ask user to hot-reload.
