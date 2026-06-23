# INZU Workstation

Integrated **Transport, Safety & Compliance** management system for **INZU MCS Limited**, operating at FQM Trident (Kalumbila) and Kansanshi (Solwezi), Zambia.

This is the frontend shell (React + Vite + TypeScript + Tailwind). Data is currently held in the browser (localStorage + IndexedDB for file uploads) as a working mock, ready to be swapped for a real backend.

## Modules
Dashboard · Fleet (owned + operated vehicles, licensing) · Drivers (roster, work/rest calendar, duty reports) · Speed Management · Operations (daily plan, weekly plan, bus allocation, mileage, fuel) · Safety · Messaging · Admin (users, roles, permissions, branches).

## Develop
```bash
cd frontend
npm install
npm run dev
```

## Build
```bash
cd frontend
npm run build      # tsc + vite build → frontend/dist
```

## Deploy (Netlify)
Build config lives in [`netlify.toml`](netlify.toml): base `frontend`, build `npm run build`, publish `frontend/dist`, with an SPA redirect for client-side routing. Connect the GitHub repo in Netlify and it deploys automatically on every push to `main`.

## Sign in
Default admin account: `admin` / `admin123` (create the rest in Admin → Users). Open separate browser windows/tabs to test multiple users at once.
