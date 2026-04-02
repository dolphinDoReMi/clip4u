# Implementation Plan — Mini Program Surface

## Goal

Ship the first official `Mini Program` API surface so a future WeChat-native client can authenticate users, bootstrap review context, and invoke assist flows against MiraChat.

## Phase 1

- add Mini Program login exchange via `code2Session`
- create signed MiraChat session tokens for linked users
- expose `bootstrap` endpoint with pending drafts, thread summaries, and optional connection state
- expose assist endpoint for user-initiated draft help

## Phase 2

- add explicit mobile approval action wrappers if needed
- add account-linking UX and session diagnostics
- shape payloads for mobile-first cards and lightweight navigation

## Phase 3

- add notification and re-entry strategy
- add richer thread history and role-aware views
- connect the official Mini Program client implementation

## Initial file map

- `MiraChat/services/api/src/mini-program.ts`
- `MiraChat/services/api/src/api-listener.ts`
- `MiraChat/.env.example`
- `MiraChat/README.md`

## Open implementation decisions

- final account-linking model between `openid`/`unionid` and `MiraChat userId`
- whether approval actions should reuse existing `/mirachat/drafts/*` endpoints directly or get Mini Program-specific wrappers
- what minimum mobile payload shape is best for the first client
