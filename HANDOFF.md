# Podium 1 Racing — Production Tracker Handoff
**Last updated:** July 2026
**Previous AI:** Claude (Anthropic)
**Handoff to:** ChatGPT / Codex
**Live URL:** https://p1production.netlify.app (migrating to Vercel)

## What This App Is

A mobile-first PWA (single HTML file) used daily on the production floor at Podium 1 Racing in Nashville, TN. It tracks simulator build progress, kitting, and pick list allocation. Every system ships fully built and configured — this app tracks that process from parts arrival through quality control.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Single-file HTML + vanilla JS + CSS (no framework) |
| Hosting | Netlify → migrating to Vercel |
| Serverless | Netlify Functions → Vercel API Routes |
| Database | Supabase (Postgres) |
| Board data | Monday.com API (GraphQL) |
| Parts/WO data | P1 NetSuite API |
| Auth | SHA-256 hashed PIN per user, stored in Supabase user_pins |

## Credentials & Keys

**Gate (first-launch device lock):**
- Username: podium1racing
- Passcode: AlWaYsBeRaCiNg
- SHA-256 hashes stored in HTML — never plain text

**Admin:** Elijah Moosekian | Setup code: 5248

**APIs (also in p1proxy.js):**
- Monday API Key: eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY3NDQwMzIwMCwiYWFpIjoxMSwidWlkIjo3MzA3NzY1NCwiaWFkIjoiMjAyNi0wNi0yM1QxNTozMjowOC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTcyNTAyMjIsInJnbiI6InVzZTEifQ.aQ2XoeK3ZCasOe6C4ocU5tow3bWga-myr-CAH6MUVtA
- Monday Board ID: 7847112819
- P1 API URL: https://submission-api-331638234113.us-central1.run.app
- P1 API Key: p1r-0ed3fa51376c78f8ad9df9b43728e46d59f6ca7f447d8645
- Supabase URL: https://paufeygvqwyidyasuubr.supabase.co
- Supabase Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhdWZleWd2cXd5aWR5YXN1dWJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTEzNTMsImV4cCI6MjA5Nzk2NzM1M30._LRmmxQdzqUJaFdCa_w6P82rtcQVUJgwec79COxKxGE

## Team

| Name | Role | Notes |
|---|---|---|
| Alex Inthavone | MS Builder (ms) | |
| Mason McKnight | MS Builder (ms) | |
| Thomas Persichina | MS Builder / Lead (ms) | Next Up assign button, team dashboard |
| Daniel Barbarino | Chassis Builder (chassis) | |
| Ray Simonson | Chassis Builder (chassis) | |
| Sepan Ali | Chassis Builder / Lead (chassis) | Next Up assign button, team dashboard |
| Billy Vankham | Chassis Builder (chassis) | |
| Pete Jeji | Kitter (kit) | Kit screen, pick list button, submit kit flow |
| Elijah Moosekian | Admin | Full desktop analytics |

Role constants: MS_ROLE="ms", CHASSIS_ROLE="chassis", KIT_ROLE="kit"

## Supabase Tables

**user_pins** — cross-device PIN storage
- name (PK), pin_hash, updated_at

**timer_sessions** — builder timer events

**kit_completions** — Pete's kit submissions
- item_id, item_name, user_name, missing_items (text[]), completed_at, date_str

**build_updates** — % progress updates with optional photos
- item_id, item_name, user_name, col_type (ms/chassis), ms_total_ms, chassis_total_ms, photo_base64, date_str

**picklists** — one row per work order
- id (uuid PK), wo_number (UNIQUE), customer_name, monday_item_id
- status: in_queue / missing_items / fully_kitted / complete / exclude
- has_changes (bool), changes_note, completed_at, completed_by

**picklist_items** — NetSuite line items
- id (bigint PK), wo_number, customer_name, brand, item_name, memo, quantity
- allocated (bool) — Pete checks as he pulls
- builder_confirmed (bool) — Thomas/Sepan confirm grab
- picklist_id (FK → picklists.id)
- label (text) — pre-built display string, source of truth for display
- last_synced_at

## Pick List Status Mapping (Monday Group → App Status)

- Pick Ticket Printed → in_queue
- Parts Pulled → missing_items
- Building Queue - In Progress → missing_items
- Stand By - Pending MS or Chassis → missing_items
- Configuration → missing_items
- Quality Control (Support) → missing_items (Complete button active HERE)
- Pending Shipping → missing_items
- Hold → missing_items
- Pending Parts Pulled → exclude (hidden entirely)
- Complete Pick List button pressed → complete (terminal)
- All items checked → fully_kitted (auto-set)

## Dual Checkboxes (PC / Monitor / Seat)

These items get TWO checkboxes — Pete's (allocated) and Builder's (builder_confirmed):
- PC: item label matches /50[6-9]0\s*pc/i (5060, 5070, 5080, 5090 PC)
- Monitor: label contains 32", 45", or 55"
- Seat: label contains "seat" but NOT "seat slider" or "seat bracket"

Who sees the builder checkbox:
- Sepan Ali (chassis lead) → Seat only
- Thomas Persichina (MS lead) → Monitor + PC only
- Admin → all three

## Key Functions

**Auth:** submitGate(), signOutCompletely(), savePinToSupabase(name, hash), syncPinsFromSupabase()

**Monday:** mondayQuery(gql, version), discoverColumns(columns), cvText(item, colId), parsePeople(item, colId), getShipDate(item)

**Board:** loadBoard(), renderDash(items), renderPartsPulled(items, isMS), grabBuild(itemId), grabBuildAs(itemId, memberName), updateProgress(itemId, pct, photo)

**Kit (Pete):** showKitScreen(), loadKitBoard(), buildKitChecklistAsync(item), submitKitFromPickList(plId, woNum, e), confirmSubmitKitFromPickList(...), openPetePickListOverview()

**Pick Lists:** openPickListForItem(itemId, woNum, e), openPickListScreen(), loadPickLists(woNum), ensurePickList(woNum), syncPickListItems(woNum), syncPickListStatusFromMonday(woNum), mondayGroupToPlStatus(groupTitle), renderPickLists(), togglePickListItem(itemId, plId, e), toggleBuilderConfirm(itemId, plId, e), completePickList(plId, e), confirmCompletePickList(plId, e), acknowledgePickListChanges(plId, e), buildItemLabel(it), isBuilderGrabItem(label), isServiceItem(it), isLead(), isChassisLead(), isMSLead(), cleanMondayName(name)

**Leads:** openNextUpAssign(), assignBuildFromModal(itemId, e), renderLeadDashboard()

**Admin:** loadAdminData(), isDesktop(), renderAdminDesktop(...), renderAdminDash(...), setAdminRange(r)

**Supabase:** sbFetch(path, opts), sbUpsertTimer(...), sbEndTimer(...), sbRecordKitCompletion(...)

## Screens

- screen-gate — first-launch device credentials
- screen-login — name select + PIN pad
- screen-dash — builder dashboard
- screen-kit — Pete's kitting screen
- screen-admin-login — admin PIN
- screen-admin — admin view (mobile) / full analytics (desktop Mac ≥900px, no touch)
- screen-picklist — pick list screen
- screen-updates — build updates photo feed
- screen-history — builder history
- screen-setup — first-time PIN setup

## Vercel Migration

vercel.json rewrites /.netlify/functions/p1proxy → /api/p1proxy so NO frontend changes needed.

Steps:
1. Push to GitHub
2. Connect repo in Vercel dashboard
3. No build command (static HTML)
4. Add vercel.json and api/p1proxy.js (provided in handoff zip)
5. Convert mondaywebhook.js to api/mondaywebhook.js using same Vercel handler pattern

## Important Gotchas

1. Monday item names come back as "224310 Joe Lynch" — always use cleanMondayName(name) to strip the leading number prefix before storing to Supabase.

2. Column discovery (discoverColumns) happens at board load. If COL.ms_who is null, board hasn't loaded yet.

3. boardItems = all Monday items globally. kitBoardItems = Pete's subset. window._adminItems = admin's copy.

4. Pick list labels — picklist_items.label is source of truth. Always use (it.label || buildItemLabel(it)) when rendering. Never build from brand+item_name directly.

5. Service items (installation, white glove, delivery, warranty) filtered by isServiceItem(it).

6. Status is Monday-driven — syncPickListStatusFromMonday() runs on every open and overwrites unless complete or exclude.

7. exclude status = Pending Parts Pulled group in Monday. Hidden everywhere. Reappears as missing_items when moved to Parts Pulled.

8. Monday create_update mutation requires "2025-07" as second arg to mondayQuery(). Other mutations use default.

9. Gate SHA-256 hashes:
   - podium1racing → 84e72cb2fce97fb96fc3b35fe1fed70e74660adc1497623a3a0298ef3f513777
   - AlWaYsBeRaCiNg → 98dcbed840e44810c72e93ab5c9b9c25dce7189ee8c39729a12a127e1f7f7ace

## Jake & Ayden (Inventory Team)

Stored in INVENTORY_IDS in the HTML. They receive Monday comment notifications when Pete submits a kit:

[Pete Jeji] Kitting complete (Jul 9, 2026)
Missing:
- Fanatec — DD Pro
- Custom: Pedal Slider
OR: Missing: Nothing — full kit confirmed

## Design System

--bg: #0d0d0d (near-black)
--surface: #161616
--accent: #e02020 (Podium 1 crimson red)
--green: #10b981
--yellow: #f59e0b
--muted: #888888
--radius: 12px

Uppercase headers, tight tracking, 3px red accent bar on gate/login/admin screens, red left border on project cards.

## How to Continue with ChatGPT

Prompt template:
"I am continuing development on the Podium 1 Racing Production Tracker (currently v79). Attached is the current index.html and the handoff document. I need to: [describe change]. Please make the change, syntax-check the JS, and provide a deployable zip with index.html, vercel.json, and api/p1proxy.js."

Always upload: index.html + this handoff doc
Always verify: JS syntax before deploying
Always test on: iPhone (primary device for floor workers)
