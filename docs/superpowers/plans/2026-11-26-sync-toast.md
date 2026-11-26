# Sync Status Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move shelf cloud-sync status into a dismissible fixed toast that does not affect the shelf layout.

**Architecture:** Keep sync state in `App`, derive a stable snapshot identity for dismissal, and render a `SyncStatusToast` beside the home screen. Reuse existing localized status/progress messages and add only close-button copy and token-based CSS.

**Tech Stack:** React, TypeScript, existing Cairn UI tokens, Bun tests, Vite build, Electrobun desktop shell.

## Global Constraints

- Keep the toast fixed and outside normal document flow.
- Do not add an auto-dismiss timer; progress, errors, and conflicts remain available until closed.
- A new sync status or progress snapshot must show the toast again after dismissal.
- Keep conflict confirmation in the existing per-book sync action.
- Preserve English and Chinese product copy and existing token usage.

### Task 1: Add toast state and rendering

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`

**Interfaces:**
- Consumes: `SyncStatus` exposed by `useShellSettings`, existing `SyncProgressView` copy.
- Produces: `SyncStatusToast` rendering status and progress with a close button.

- [ ] **Step 1: Add localized close-button labels.**
- [ ] **Step 2: Replace the in-flow `ShelfSyncStatus` with a fixed-toast component invocation.**
- [ ] **Step 3: Track a dismissed snapshot identity based on state, message, phase, current book, and resource counts.**
- [ ] **Step 4: Render the close button with an accessible label and keep the existing conflict/sync actions unchanged.**

### Task 2: Style the toast without affecting layout

**Files:**
- Modify: `packages/ui/src/app.css`

**Interfaces:**
- Consumes: existing `--card`, `--line`, `--ink`, `--dim`, `--accent`, and `--soft` tokens.
- Produces: fixed responsive `.sync-toast` styles with visible focus state.

- [ ] **Step 1: Add fixed positioning, layering, width, spacing, and shadow.**
- [ ] **Step 2: Add compact progress layout and close-button styles.**
- [ ] **Step 3: Add narrow-window rules so the toast stays within the viewport.**

### Task 3: Add regression coverage and verify

**Files:**
- Modify or create: `apps/desktop/tests/sync-toast.test.tsx`

- [ ] **Step 1: Test that a non-disabled status renders as a toast and does not render the old in-flow shelf status.**
- [ ] **Step 2: Test that closing hides the current snapshot and a changed status renders again.**
- [ ] **Step 3: Run focused tests, all typechecks, and `cd apps/desktop && bun run build`.**
- [ ] **Step 4: Run the real Electrobun app and inspect the shelf with the toast visible.**
- [ ] **Step 5: Commit the implementation with `feat: show sync status as dismissible toast`.**
