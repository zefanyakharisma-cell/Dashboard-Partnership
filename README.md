# Petra Partnership Dashboard

A responsive web dashboard for managing Petra Christian University's (Universitas Kristen Petra) partnership portfolio — **MoU**, **MoA**, and **IA** agreements across domestic and international institutions. Built as a single-page application using **vanilla JavaScript + Tailwind CSS + Chart.js + Lucide Icons**, with `localStorage` persistence over a real institutional dataset served from `/data`.

> The architecture documented below also describes how to lift this directly into a **Next.js + Supabase/PostgreSQL** stack for production deployment.

---

## At a Glance

| | |
|---|---|
| Dataset | **2,289** agreements · **1,201** institutions · **38** departments · **1,130** new partners |
| Agreement types | MoU · MoA · IA |
| Coverage | 1,584 domestic · 705 international |
| Scope tags | Learning · Research · Student Affairs · Community Service |
| Institution types | Education · Industry · Organization · Government · Foundation |
| Stack | Vanilla JS · Tailwind (CDN) · Chart.js · Lucide |
| Auth | **Supabase Auth** (email + password, magic-link, sign-up) |
| Storage | `localStorage` (client) · JSON files (source of truth) |
| Snapshot date | 2026-05-21 |

---

## Features

### Guest / Public View
- Executive landing dashboard with KPIs
- Status distribution pie chart
- Agreements by department bar chart
- Monthly activity (created vs. signed) line chart
- Expiration timeline chart
- Partner country distribution chart
- Recent activity feed and recently-signed list
- Public **Archive Library** (signed/completed/active agreements) with full search & filter
- Public **Analytics** page

### Admin (Authenticated)
- **Supabase Auth** sign-in — email/password + magic-link, with sign-up from the login page
- Role-based access (Admin / Manager / Staff / Viewer) — Supabase session is matched to a local user record by email
- **Dashboard** with KPI cards, charts, expiring agreements, "My Agreements"
- **Agreement List** with multi-column filter (status, type, department), full-text search, sortable, paginated
- **Agreement Detail** with workflow visualization, document attachments, status history timeline, activity log
- **Add / Edit Agreement Form** with validation
- **Workflow Engine** — Drafting → Internal Review → Legal Review → Partner Review → Waiting Signature → Signed → Completed → Archived
- **Lifecycle Statuses** — Active, Auto-renewed, Open-ended, Pending Approval, Renewal In Progress, Ended, Expired, Unknown (mapped from the source dataset)
- **Auto-Archive** — when status reaches a terminal/signed state the record automatically appears in the Library
- **Document upload** (simulated; production-ready hook point for Supabase Storage / S3)
- **Archive Library** with advanced search
- **Analytics & Reports** with multiple chart types
- **User Management** (Admin only) — create, enable/disable, delete users
- **Notification Center** with expiration alerts and unread badge
- **Settings** — profile, theme, data export (JSON + CSV), reset to source data
- **Export to CSV** from list / archive / settings
- Print-to-PDF friendly stylesheet
- **Dark / light mode** with persistence
- **Toasts**, **confirmation modals**, **empty states**, **loading states**

---

## Run Locally

This is a static SPA, but it **must be served over HTTP** — `fetch()` is blocked on `file://`, so opening `index.html` directly will not work. The app will show a clear error screen if you try.

```bash
# From the project root, run any static server. Examples:

# Python (built-in)
python3 -m http.server 8080

# Node (one-off)
npx serve -l 8080 .

# Then visit http://localhost:8080
```

### Supabase Setup

Auth is backed by **Supabase Auth**, so the dashboard needs a Supabase project before sign-in works.

1. Create a project at [supabase.com](https://supabase.com) → **Project Settings → API**.
2. Copy the **Project URL** and **anon public key**.
3. Open `js/supabase-client.js` and fill in:

   ```js
   const SUPABASE_URL = 'https://<your-project-ref>.supabase.co';
   const SUPABASE_ANON_KEY = '<your-anon-public-key>';
   ```

4. (Optional) In **Authentication → Providers**, enable **Email** with password and/or magic-link. If "Confirm email" is on, new sign-ups must verify before logging in.

If the keys are missing, the login screen surfaces a banner saying Supabase isn't configured. The rest of the app (guest dashboard, library, analytics) still works against the bundled `/data` JSON.

### Admin Account

| Role  | Email                       |
|-------|-----------------------------|
| Admin | zefanya.kharisma@gmail.com  |

Sign-in is handled by Supabase Auth — create the account in your Supabase project (or sign up via the login page) using the email above so the local Admin role is matched on login. Any Supabase user whose email doesn't match a seeded record is dropped to a **Viewer** role. Additional users can be added in **User Management** once signed in.

State persists in `localStorage` (key `unicollab_state_v2`). To wipe local edits and reload from `/data`: **Settings → Reset to demo data**, or in DevTools console: `localStorage.removeItem('unicollab_state_v2')` then refresh.

---

## Screenshots

Add screenshots under `docs/screenshots/` and they will render here.

| | |
|---|---|
| ![Guest dashboard](docs/screenshots/guest-dashboard.png) | ![Admin agreements list](docs/screenshots/admin-list.png) |
| **Guest landing** — KPIs, status mix, country map | **Agreement list** — filter / search / sort / paginate |
| ![Agreement detail](docs/screenshots/agreement-detail.png) | ![Analytics](docs/screenshots/analytics.png) |
| **Agreement detail** — workflow, files, activity log | **Analytics** — trend, expirations, breakdowns |

> Live demo: _add a hosted URL here once deployed (e.g. Vercel)._

---

## Project Structure

```
Dashboard Partnership/
├── index.html              # SPA shell, CDN imports, Tailwind config
├── css/
│   └── style.css           # Custom styles, animations, themed pills
├── js/
│   ├── main.js             # Full SPA: router, store, auth, views, charts
│   └── supabase-client.js  # Supabase URL + anon key bootstrap (window.supabaseClient)
├── data/
│   ├── partnerships_1.json        # Raw source database (input)
│   ├── institutions.json          # Deduped institutions w/ institution_type tags (generated)
│   ├── departments.json           # Departments / faculties / units (generated)
│   ├── agreements.json            # Normalized agreements w/ units, scope_tags, flags (generated)
│   └── meta.json                  # Totals + status/type/kind/scope/institution_type breakdowns (generated)
├── scripts/
│   └── convert_partnerships.py    # Source → normalized JSON converter
└── README.md
```

### `main.js` modules (logical, single-file)

| Module | Responsibility |
|--------|----------------|
| `Store` | Load source JSON, normalize, persist to `localStorage`, reset |
| `Auth` | Supabase Auth wrapper — login, sign-up, magic-link, logout; maps Supabase session → local user by email |
| `Theme` | Dark/light mode with persistence |
| `Router` | Hash-based SPA router with `requireAuth` guard |
| `Toast` | Animated stackable notifications |
| `Modal` | Generic + confirm modal with backdrop |
| `Charts` | Chart.js wrappers (pie, bar, line, timeline) |
| `UI` | Atomic helpers — KPI card, card, pill, progress bar, empty state |
| `Views` | Page renderers — Guest, Admin, Agreement, Library, Users, etc. |

---

## Data Pipeline

The dashboard reads from four normalized JSON files in `/data`. These are derived from `partnerships_1.json` via a deterministic Python script.

```
partnerships_1.json   (international[] + domestic[])
        │
        │   python3 scripts/convert_partnerships.py
        ▼
institutions.json  +  departments.json  +  agreements.json  +  meta.json
        │
        │   fetch() on app boot
        ▼
   Store.state  ──persist──▶  localStorage
```

Re-run the converter whenever the source changes:

```bash
python3 scripts/convert_partnerships.py
```

The script:
- Repairs mojibake (Latin-1 → UTF-8 round-trip) in names and addresses
- Dedupes institutions by canonical key (trims trailing country/city suffixes) and aggregates `institution_type` tags across all of an institution's agreements to pick a dominant display type
- Derives departments from the per-agreement `units` array — the first unit becomes the primary department, the rest are still registered so they appear in filters
- Normalizes the new `scope` array (`learning` / `research` / `student_affairs` / `community_service`) into `scope_tags` plus a human label
- Classifies `end_date` strings into `date` / `auto_renewed` / `no_limit` / `na` / `unknown`, parses Indonesian note patterns (`belum pengusulan`, `proses pembaruan`, `end`, …) and maps each agreement to a lifecycle status relative to `TODAY` (2026-05-21)
- Preserves `new_partner`, `agenda`, `degree_program`, `non_degree_program`, `renewal_info`, and `realization` from the source row
- Writes `meta.json` with totals plus breakdowns by status, type, kind, institution_type, and scope

After regenerating, hard-refresh the browser **and** reset local data (Settings → Reset) so the cached `localStorage` snapshot is rebuilt.

---

## Database Schema (Production Reference)

The in-memory `Store.state` mirrors a normalized relational schema. Below is the suggested **PostgreSQL / Supabase** layout.

### ERD

```
            ┌───────────────┐
            │ departments   │
            │───────────────│
            │ id  (PK)      │◄────┐
            │ name          │     │
            │ short         │     │
            └───────────────┘     │
                                  │
┌───────────┐   ┌───────────────┐ │   ┌──────────────────┐
│ users     │   │ institutions  │ │   │ uploaded_files   │
│───────────│   │───────────────│ │   │──────────────────│
│ id (PK)   │◄┐ │ id (PK)       │◄┤   │ id (PK)          │
│ name      │ │ │ name          │ │   │ agreement_id (FK)│─┐
│ email UQ  │ │ │ country       │ │   │ name, size, url  │ │
│ password  │ │ │ type          │ │   │ uploaded_at      │ │
│ role      │ │ └───────────────┘ │   └──────────────────┘ │
│ dept (FK) │─┘                   │                        │
│ active    │                     │                        │
└───────────┘                     │   ┌──────────────────┐ │
       ▲                          │   │ agreements       │◄┘
       │                          │   │──────────────────│
       │                          └──►│ id (PK)          │
       │   ┌──────────────────────┐   │ code UQ          │
       └───│ activity_logs        │◄──│ title            │
           │──────────────────────│   │ type (MoU/MoA/IA)│
           │ id (PK)              │   │ status           │
           │ agreement_id (FK)    │──►│ progress         │
           │ user_id (FK)         │   │ institution_id FK│
           │ action               │   │ department_id FK │
           │ message              │   │ pic_user_id FK   │
           │ at                   │   │ start_date       │
           └──────────────────────┘   │ end_date         │
                                      │ signed_date      │
           ┌──────────────────────┐   │ description      │
           │ notifications        │   │ notes            │
           │──────────────────────│   │ tags (jsonb)     │
           │ id (PK)              │   │ created_at       │
           │ user_id (FK)         │   │ updated_at       │
           │ agreement_id (FK)    │   └──────────────────┘
           │ type, title, message │            ▲
           │ read, at             │            │
           └──────────────────────┘   ┌──────────────────┐
                                      │ archive_library  │
                                      │──────────────────│
                                      │ agreement_id (PK)│
                                      │ archived_at      │
                                      │ category         │
                                      └──────────────────┘
```

### SQL DDL (PostgreSQL / Supabase)

```sql
-- departments
CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  short       text NOT NULL,
  is_faculty  boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- institutions
CREATE TABLE institutions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  canonical_name  text,
  country         text NOT NULL,
  city            text,
  address         text,
  kind            text CHECK (kind IN ('Domestic','International')),
  type            text NOT NULL CHECK (type IN ('University','Industry','Government','NGO')),
  created_at      timestamptz DEFAULT now()
);

-- users  (use Supabase Auth.users + a profile table in production)
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL, -- if not using Supabase Auth
  role          text NOT NULL CHECK (role IN ('Admin','Manager','Staff','Viewer')),
  department_id uuid REFERENCES departments(id),
  avatar        text,
  active        boolean DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

-- agreements
CREATE TYPE agreement_type   AS ENUM ('MoU','MoA','IA');
CREATE TYPE agreement_status AS ENUM (
  -- workflow stages
  'Drafting','Internal Review','Legal Review','Partner Review',
  'Waiting Signature','Signed','Completed','Archived',
  -- lifecycle statuses (from the real partnership dataset)
  'Active','Auto-renewed','Open-ended','Pending Approval',
  'Renewal In Progress','Ended','Expired','Unknown'
);

CREATE TABLE agreements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  title           text NOT NULL,
  type            agreement_type NOT NULL,
  status          agreement_status NOT NULL DEFAULT 'Drafting',
  progress        int  NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  institution_id  uuid NOT NULL REFERENCES institutions(id),
  department_id   uuid NOT NULL REFERENCES departments(id),
  pic_user_id     uuid NOT NULL REFERENCES users(id),
  start_date      date NOT NULL,
  end_date        date,
  signed_date     date,
  description     text,
  notes           text,
  tags            jsonb DEFAULT '[]'::jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CHECK (end_date IS NULL OR end_date > start_date)
);

CREATE INDEX idx_agreements_status      ON agreements(status);
CREATE INDEX idx_agreements_end_date    ON agreements(end_date);
CREATE INDEX idx_agreements_department  ON agreements(department_id);
CREATE INDEX idx_agreements_institution ON agreements(institution_id);

-- uploaded_files
CREATE TABLE uploaded_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id   uuid NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  name           text NOT NULL,
  storage_path   text NOT NULL,   -- supabase storage object path
  mime_type      text,
  size_bytes     bigint,
  uploaded_by    uuid REFERENCES users(id),
  uploaded_at    timestamptz DEFAULT now()
);

-- activity_logs (audit trail)
CREATE TABLE activity_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id   uuid REFERENCES agreements(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id),
  action         text NOT NULL,    -- CREATED | UPDATED | STATUS_CHANGE | FILE_UPLOAD | DELETED
  from_status    agreement_status,
  to_status      agreement_status,
  message        text,
  at             timestamptz DEFAULT now()
);

-- notifications
CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id),
  agreement_id   uuid REFERENCES agreements(id) ON DELETE CASCADE,
  type           text NOT NULL,    -- expiration | info | warning
  title          text NOT NULL,
  message        text,
  read           boolean DEFAULT false,
  at             timestamptz DEFAULT now()
);

-- archive_library (auto-populated trigger below)
CREATE TABLE archive_library (
  agreement_id   uuid PRIMARY KEY REFERENCES agreements(id) ON DELETE CASCADE,
  archived_at    timestamptz DEFAULT now(),
  category       text
);

-- Trigger: auto-archive on terminal/live status
CREATE OR REPLACE FUNCTION auto_archive_agreement() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN (
    'Signed','Completed','Archived',
    'Active','Auto-renewed','Open-ended','Ended','Expired'
  ) THEN
    INSERT INTO archive_library (agreement_id, category)
    VALUES (NEW.id, NEW.type::text)
    ON CONFLICT (agreement_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_archive
AFTER INSERT OR UPDATE OF status ON agreements
FOR EACH ROW EXECUTE FUNCTION auto_archive_agreement();
```

---

## Suggested API Routes (Next.js / Express)

| Method | Path                                  | Description                          | Auth   |
|--------|---------------------------------------|--------------------------------------|--------|
| POST   | `/api/auth/login`                     | Login (returns JWT)                  | —      |
| POST   | `/api/auth/logout`                    | Logout                               | ✓      |
| GET    | `/api/agreements`                     | List + filter + paginate             | ✓      |
| POST   | `/api/agreements`                     | Create                               | ✓      |
| GET    | `/api/agreements/:id`                 | Detail                               | ✓      |
| PUT    | `/api/agreements/:id`                 | Update                               | ✓      |
| DELETE | `/api/agreements/:id`                 | Delete                               | ✓      |
| POST   | `/api/agreements/:id/advance`         | Move to next workflow stage          | ✓      |
| POST   | `/api/agreements/:id/files`           | Upload PDF (multipart)               | ✓      |
| GET    | `/api/agreements/:id/files`           | List attachments                     | ✓      |
| GET    | `/api/agreements/:id/logs`            | Activity & status history            | ✓      |
| GET    | `/api/library`                        | Public archive (signed/active)       | —      |
| GET    | `/api/analytics/kpis`                 | KPI summary                          | —      |
| GET    | `/api/analytics/charts`               | Chart datasets                       | —      |
| GET    | `/api/institutions`                   | CRUD                                 | ✓      |
| GET    | `/api/departments`                    | CRUD                                 | ✓      |
| GET    | `/api/users`                          | List users                           | Admin  |
| POST   | `/api/users`                          | Create user                          | Admin  |
| GET    | `/api/notifications`                  | Current user notifications           | ✓      |
| PATCH  | `/api/notifications/:id`              | Mark read/unread                     | ✓      |

---

## Production Migration Path

To convert this prototype into a deployable enterprise stack:

1. **Scaffold**: `npx create-next-app@latest petra-partnership --typescript --tailwind --app`
2. **Install**: `@supabase/supabase-js`, `recharts`, `shadcn/ui`, `react-hook-form`, `zod`, `lucide-react`
3. **Database**: Apply SQL DDL above on a Supabase project; enable Row Level Security per role.
4. **Storage**: Create `agreement-files` bucket on Supabase Storage; wire `uploaded_files.storage_path`.
5. **Auth**: Use Supabase Auth (email/password) → map `auth.users.id` to `users.id` profile table.
6. **Seed**: Adapt `scripts/convert_partnerships.py` to write directly into Supabase via `psql` or the REST API.
7. **API**: Replace `Store.*` calls in `main.js` with `fetch('/api/...')` against Next.js route handlers.
8. **Charts**: Swap Chart.js (used here for CDN simplicity) with Recharts components.
9. **Email**: Hook expiration trigger (cron / Supabase scheduled function) → SendGrid / Resend.
10. **Deploy**: Vercel (frontend) + Supabase (DB + storage + auth + cron).

The component layout, page structure, and routes in this prototype map 1:1 to the Next.js app router pages.

---

## Development & Contributing

### Prerequisites
- A modern browser (Chrome, Firefox, Edge, Safari)
- **Python 3.9+** — only if you want to regenerate the normalized JSON from `partnerships_1.json`
- Any static file server (Python, Node, `caddy file-server`, `live-server`, etc.)

### Workflow

```bash
# 1. Start a dev server from the project root
python3 -m http.server 8080

# 2. (Optional) regenerate /data after editing the source dataset
python3 scripts/convert_partnerships.py

# 3. After regenerating data, reset local state in the app
#    Settings → "Reset to demo data"   (or clear localStorage in DevTools)
```

There is no build step. Tailwind runs from CDN, and `main.js` is loaded as a plain script — edits to `js/main.js` or `css/style.css` are picked up on refresh.

### Code conventions
- **Single-file SPA** — keep new functionality in `js/main.js` under the appropriate module (`Store`, `Auth`, `Router`, `Views`, etc.). Don't introduce a bundler or split files unless migrating to the Next.js path.
- **No frameworks** — render via template strings + `innerHTML`, then re-bind events. Escape user-controlled strings with `escapeHtml()`.
- **Tailwind utility classes only** — avoid adding to `css/style.css` unless an effect can't be expressed with utilities (animations, print styles, themed pills).
- **Status handling** — when adding a status, update `WORKFLOW_STAGES` / `LIFECYCLE_STATUSES` / `ARCHIVE_STATUSES` consistently and check `stageProgress()` covers it.
- **Persisted state** — anything written via `Store.save()` lands in `localStorage`. Bump `STORAGE_KEY` when making breaking shape changes so existing users get a clean reload.

### Contributing
1. Fork & create a feature branch (`feat/...`, `fix/...`, `docs/...`).
2. Test the change locally against the **full** dataset (2,289 agreements) — pagination, filtering, and chart rendering all change behavior at scale.
3. Verify both **guest** and **admin** views, and both **light** and **dark** modes.
4. Open a PR describing the change and any data-shape implications.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Boot error: "fetch blocked on file://" | Opened `index.html` directly | Serve over HTTP (see [Run Locally](#run-locally)) |
| `data/*.json → HTTP 404` | Server not started from project root | `cd` into the project root before running the server |
| Login banner: "Supabase isn't configured" | `SUPABASE_URL` / `SUPABASE_ANON_KEY` blank | Fill them in `js/supabase-client.js` (see [Supabase Setup](#supabase-setup)) |
| Sign-up succeeds but login fails | Supabase "Confirm email" is enabled | Verify the confirmation email, or disable confirmation in **Authentication → Providers** |
| Signed-in user lands as Viewer | Email doesn't match a seeded local user | Sign in with the seeded Admin email, or add the user via **User Management** |
| Stale data after `convert_partnerships.py` | `localStorage` snapshot is older | Settings → Reset, or `localStorage.clear()` |
| `QuotaExceeded` on save | Browser localStorage limit (~5 MB) | Use Settings → Export, then reset; or switch to a backend |
| Charts blank in dark mode | Chart instance cached with old theme | Toggle theme once, or refresh |

---

## Sample Data

The bundled dataset is Petra Christian University's real partnership portfolio (snapshot 2026-05-21):

- **38 departments / faculties / units** (Engineering, Business, Communication, Informatics, Civil & Planning, etc.)
- **1,201 institutions** across domestic and international partners
- **2,289 agreements** spanning every workflow stage and lifecycle status
- **1,130 flagged as new partners** in the source dataset
- **1 seeded Admin user** (added on top of the dataset — the source has no user records)
- **Activity logs** for every status transition
- **Notifications** auto-generated for upcoming expirations

Breakdown by status (from `data/meta.json`):

| Status | Count |
|---|---|
| Expired | 1,101 |
| Active | 423 |
| Auto-renewed | 314 |
| Unknown | 169 |
| Pending Approval | 157 |
| Ended | 74 |
| Renewal In Progress | 51 |

Breakdown by type:

| Type | Count |
|---|---|
| MoU | 1,055 |
| MoA | 1,046 |
| IA | 126 |
| Unknown | 62 |

Breakdown by kind:

| Kind | Count |
|---|---|
| Domestic | 1,584 |
| International | 705 |

Breakdown by institution type (an agreement can carry multiple tags):

| Institution type | Count |
|---|---|
| Education | 1,201 |
| Industry | 671 |
| Organization | 296 |
| Government | 102 |
| Foundation | 12 |

Breakdown by scope (an agreement can carry multiple tags):

| Scope | Count |
|---|---|
| Learning | 684 |
| Research | 542 |
| Student Affairs | 469 |
| Community Service | 459 |

---

## Keyboard / UX Niceties
- `/` global search shortcut (top bar, focusable via tab)
- Enter on global search jumps to filtered Agreement List
- All destructive actions go through a confirmation modal
- Toasts auto-dismiss; click X to dismiss earlier
- Theme preference persists across reloads

---

## License
MIT — Use freely for educational and institutional purposes.
