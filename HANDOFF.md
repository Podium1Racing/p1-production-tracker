# Podium 1 Racing Production Tracker — Handoff

Last updated: July 29, 2026  
Repo: `/Users/ejvmoose01/Documents/Production App/p1-production-tracker`  
Primary branch: `main`  
Latest local/pushed commit at handoff time: `165014a` (`notification edits`)

## What This App Is

This is a mobile-first production-floor app for Podium 1 Racing. It is used by:

- Pete for kitting and pick list allocation
- Builders for project sessions, timers, and build updates
- Leads for floor visibility and team follow-up
- Admin for production command center, pick list oversight, and manual recovery actions

The app is intentionally built to feel like a phone app first. Tablet support matters too. Desktop matters mainly for Admin, but the production-floor experience should always be optimized for iPhone-sized screens and touch interaction.

## Stack

- Frontend: single-file `index.html` with vanilla JS/CSS
- API routes: `api/`
- Service worker: `sw.js`
- Hosting: Vercel
- Database: Supabase
- Board / production status source: Monday.com
- Work order / pick list source: P1 / NetSuite-backed API through the app

## Important Credentials

Shared gate login:

- Username: `podium1racing`
- Password: `alwaysberacing`

Current shared-device behavior:

- Shared devices should keep the main gate login saved
- After that, shared devices should continue to show the name-select flow
- Personal device mode is being improved so a user can go straight to PIN instead of finding their name every time

Do not change the shared-device flow unless explicitly asked.

## Key Files

- [index.html](/Users/ejvmoose01/Documents/Production%20App/p1-production-tracker/index.html)
- [api/push.js](/Users/ejvmoose01/Documents/Production%20App/p1-production-tracker/api/push.js)
- [sw.js](/Users/ejvmoose01/Documents/Production%20App/p1-production-tracker/sw.js)
- [vercel.json](/Users/ejvmoose01/Documents/Production%20App/p1-production-tracker/vercel.json)

Almost all app logic lives in `index.html`.

## Current Architecture Notes

### Single source of truth

Pick list behavior is being pushed toward one rule:

- All pick list data must be keyed by `wo_number`
- All views must reflect the same allocation state
- Admin, Pete, Builder, Lead, and completion flows should all read/write the same pick list records

If a future change introduces customer-name-based matching again, that will likely re-break allocation consistency for repeat customers with multiple systems.

### Pick list data model

Core Supabase tables involved:

- `picklists`
- `picklist_items`
- `kit_completions`
- `build_updates`
- `timer_sessions`
- push / notification related tables added during the notification work

Important practical rule:

- Work Order is the identity
- Customer name is display only

### Session and timer model

Builder session logic has been moving toward:

- one active project session per builder
- top-of-screen Project HUD is the main session control area
- timer state, session state, and Monday build state should stay synchronized

This area has been actively edited and should be treated carefully because it affects both local UI state and Monday status updates.

## What Is Working Well Right Now

- Repo is clean and on `main`
- Shared login gate is in place
- Pete’s kitting queue and kitted pick lists exist
- Pick list allocation is largely driven by work order instead of customer name
- Admin can view pick lists by status
- Admin has manual pick list complete / reopen recovery paths
- Builder HUD and timer controls were recently consolidated so session actions are less duplicated
- Push notification groundwork exists in the app and backend

## Most Recent Work Before This Handoff

The last local work focused on Builder session controls:

- Resuming a paused project should not leave the UI showing `Paused` while the timer is running
- A paused project should remain paused until the builder explicitly starts the timer
- Session controls were being moved to the top Project HUD
- Duplicate start/end session controls lower on the page were being removed
- Goal: one source of truth for timer/session/project status

The user wanted this deployed so they could test whether pausing a timer correctly pushes the Monday project status to `Paused` until the project is resumed or the session is ended.

At the moment of handoff, the repo itself was clean, so there were no uncommitted local changes waiting to be pushed.

## Current User Priorities

These are the things the user currently cares about most:

1. Phone experience must feel polished and stable.
2. The bottom control center must sit correctly at the bottom on all iPhone resolutions.
3. The Podium 1 loading screen must cover the full screen cleanly, including safe areas.
4. Pick lists must load fast and consistently everywhere.
5. Admin pick list views must be accurate, readable, and grouped in a useful way.
6. Builders need a foolproof timer/session workflow with minimal accidental misuse.
7. Pete’s pick list and kitting flows must stay extremely reliable.

## Known Open Issues

### 1. Mobile layout / safe-area inconsistencies still exist

The user is still seeing:

- top content partially under the iPhone clock/status area on some screens
- bottom control center floating too high on some screens
- loading / splash screen not visually covering the full device height
- some screens showing uneven vertical spacing or large blank gaps

This is not fully solved yet. The app needs another careful pass specifically for safe-area behavior across multiple iPhone resolutions.

### 2. Pick list screens can still feel slow or visually broken

The user has repeatedly reported:

- pick lists taking too long to load
- inline pick list expansion occasionally failing or feeling delayed
- some screens showing a loading spinner in a way that makes the page feel broken

The user wants pick lists to feel immediate.

### 3. Missing-items display is too messy

In Admin, the "what's missing" display is currently too dense and hard to scan.  
User preference:

- cleaner formatting
- bullets
- more readable separation of items
- less wall-of-red-text presentation

### 4. Some orders still fail to populate pick list data correctly

The user has seen cases where orders show:

- no pick list data
- `0/0 allocated`
- wrong status
- incorrect inclusion in Missing Items

Examples that came up recently in conversation included shipped, hold, or edge-case orders not behaving correctly in Admin.

The standing expectation is:

- only eligible active orders belong in Missing Items
- shipped orders should retain history elsewhere
- hold/cancel-style orders should not pollute active problem lists

### 5. Builder timer flow still needs real-world phone testing

The user specifically wants to test:

- when a builder pauses a timer, does Monday move the build to `Paused`
- when they resume, does status move back cleanly
- when they end session, does status reconcile correctly

This is one of the main immediate test targets for the next chat.

## Important Behavioral Rules the User Has Repeatedly Stated

### Pick lists

- Pick lists are the same thing as the work order
- Pick list data must match the work order exactly
- Pick list changes must propagate everywhere
- If an item is changed in one place, it should reflect everywhere else
- Admin, Pete, Builders, and Leads should all be seeing the same truth

### Builder workflow

- Builders should only be actively working one project at a time unless the project is intentionally shared
- They should not have confusing duplicate controls
- End session should force proper progress update behavior
- Timer control needs to be dummy-proof

### Admin workflow

- Admin needs override tools for recovery cases
- Admin needs live, current data, not stale cached summaries
- Admin needs readable, grouped pick list views

### Pete workflow

- Pete should be the only one who can retake the initial kit photo
- Pick list actions should be quick and responsive
- Kitted pick list review should stay editable until the process is truly complete

## Suggested Starting Point for the Next Chat

If continuing in a new chat, the best next move is:

1. Read this handoff first.
2. Open [index.html](/Users/ejvmoose01/Documents/Production%20App/p1-production-tracker/index.html).
3. Focus first on mobile safe-area and dock behavior.
4. Then validate Builder pause/resume/end-session behavior against Monday status syncing.
5. Then clean up Admin Missing Items readability and any remaining empty pick list edge cases.

## Recommended Prompt for the Next Chat

Use something like this:

> I’m continuing development on the Podium 1 Racing Production Tracker. Please read the attached `HANDOFF.md` first, then inspect the current `index.html`, `api/push.js`, and `sw.js`. This app is mobile-first and phone polish is the top priority. Please preserve the existing shared-device login flow and the work-order-based pick list source of truth. The first thing I need help with is: [insert task here].

## Notes for the Next Assistant

- Do not reintroduce customer-name-based pick list matching.
- Do not change shared-device login behavior unless explicitly asked.
- Treat `index.html` as the primary application surface.
- Prioritize real iPhone behavior over desktop assumptions.
- Keep the interface simple, finger-friendly, and visually finished.
- The user strongly prefers direct action over long planning.
- The user often wants to deploy quickly to phone-test changes.

## Verification Habits That Have Helped

Before handing back work:

- syntax-check JS
- watch for mobile layout regressions
- test for stale status / stale pick list state
- make sure timer/session/status language matches actual behavior
- if changing pick list logic, verify it still keys off work order

## Current State at Handoff

At the moment of this handoff:

- repo branch: `main`
- local working tree: clean
- latest commit visible locally: `165014a`
- app is active and under ongoing polish, not frozen

This handoff is meant to let a new chat continue immediately without re-discovering the app.
