# Implementation Plan — WeCom Gateway

## Goal

Ship an official `WeCom` adapter that can receive verified inbound callbacks, normalize them into MiraChat, and later send approved outbound messages through official APIs.

## Phase 1

- create `apps/gateway-wecom` workspace
- add env/config for `CorpID`, `Token`, `EncodingAESKey`, webhook path, and account id
- implement callback signature verification and payload decrypt
- normalize text messages and forward them to `/mirachat/inbound`
- expose `/health` and patch connection status into MiraChat

## Phase 2

- implement official outbound send path for the chosen WeCom message model
- map delivery outcomes back into draft/send observability
- add richer identity mapping for employee, external contact, and org metadata

## Phase 3

- support additional message types
- add retries, dead-letter behavior, and callback diagnostics
- add tenant/admin onboarding tooling

## Initial file map

- `MiraChat/apps/gateway-wecom/src/index.ts`
- `MiraChat/apps/gateway-wecom/src/wecom.ts`
- `MiraChat/.env.example`
- `MiraChat/README.md`

## Open implementation decisions

- which WeCom messaging surface is the first supported outbound path
- how external-contact threads should map into `threadId`
- whether outbound send should live directly in the gateway or behind a narrower sender module
