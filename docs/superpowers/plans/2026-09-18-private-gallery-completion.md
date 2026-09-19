# Private Gallery Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete revocable bearer-link galleries without breaking the existing named public-gallery flow.

**Architecture:** A small authenticated Edge Function owns token creation, rotation, and revocation. A separate anonymous Edge Function resolves a token into a bounded gallery manifest with 60-second signed private-object URLs. The browser stores no raw token and loads a `#share=` fragment before any curator session is restored.

**Tech Stack:** Plain browser JavaScript, Supabase REST/Edge Functions, Web Crypto, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-private-gallery-design.md`

## Global Constraints

- No visitor sign-in.
- Raw tokens are bearer secrets and are never persisted or logged.
- Signed image URLs expire after 60 seconds.
- Existing public `?gallery=` links remain supported.
- Private-link reads never use a browser service key.

### Task 1: Owner link lifecycle

Add authenticated create/rotate/revoke operations and browser client methods. Test token payloads and authorization first.

### Task 2: Guest token loading

Load `#share=` before restoring local sessions, normalize the Edge Function response, and clear the fragment from the address bar.

### Task 3: Curator controls

Expose create/rotate/revoke/copy controls in the cloud curator panel while retaining the legacy public toggle.

### Task 4: Private upload metadata

Add an explicit bucket column with compatibility defaults and route new uploads to `private_loans`; document migration boundaries.

### Task 5: Verification

Run unit, typecheck, build, focused browser tests, SQL verification, and diff hygiene checks.
