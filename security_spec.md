# Security Specification — Bonus Ticket Firestore Rules

## 1. Data Invariants
1. Every document in `/workspaces/{workspaceId}` and its subcollections (`companies`, `tasks`, `planTasks`, `payments`, `metaReports`, `marketingLogs`, `marketingEspeciales`, `marketingReelsSorteos`, `fidelizaciones`, `companyActivities`, `cobranzaEvents`, `cobranzaResets`) MUST belong to a verified authenticated owner (`ownerId == request.auth.uid` and `request.auth.token.email_verified == true`).
2. Subcollection documents MUST match the parent `{workspaceId}` in `workspaceId` and verify parent existence & ownership via `get()` on single-document operations (`get`, `create`, `update`, `delete`).
3. List queries MUST enforce `resource.data.ownerId == request.auth.uid` directly without performing `get()`/`exists()` inside `allow list`.
4. All string fields MUST have explicit `.size()` upper bounds matching `firebase-blueprint.json`; all document IDs MUST match `^[a-zA-Z0-9_\-]+$` with length <= 128.
5. `ownerId`, `workspaceId`, and `createdAt` are immutable after creation; `createdAt == request.time` on create and `updatedAt == request.time` on update.
6. No shadow/unknown fields may be written on create (`hasOnly`) or update (`affectedKeys().hasOnly(...)`).
7. Terminal lock on `tasks` and `planTasks`: once `estado == 'Listo'` / `'Completado'`, non-admin updates are restricted to explicit reopen or admin override.
8. `marketingEspeciales.rubros` is strictly bounded (`size() <= 14`) and validated against the exact 14 official rubros allowlist; `marketingReelsSorteos.categoria` is strictly validated against the 5 official categories and optional `enlace` must be empty or start with `http://` / `https://`.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write** on `/workspaces/ws1/companies/c1`.
2. **Unverified email write** (`email_verified: false`) attempting to create a company.
3. **Cross-tenant PII read** (`uid: "attacker"` reading `/workspaces/ws_victim/companies/c1`).
4. **Cross-tenant list scrape** (`uid: "attacker"` listing `/workspaces/ws_victim/companies`).
5. **Identity spoofing** creating a company with `ownerId: "victim_uid"` while authenticated as `"attacker_uid"`.
6. **Shadow field injection** on create (`isAdmin: true` or `ghostField: 123`) on `marketingEspeciales`.
7. **Shadow field injection** on update (`affectedKeys` includes `ownerId` or `extraFlag`) on `marketingReelsSorteos`.
8. **ID poisoning** creating `/workspaces/ws1/companies/../../evil` or 200-char ID.
9. **Resource exhaustion / oversized string** setting `nombre` to 5000 characters or `rubros` array to 50 elements.
10. **Forged client timestamp** creating a document with `createdAt` != server timestamp.
11. **Orphaned subcollection write** creating `/workspaces/nonexistent_ws/marketingEspeciales/e1`.
12. **Value poisoning** updating `categoria` on `marketingReelsSorteos` to `"HackedCategory"` or setting `enlace` to `"javascript:alert(1)"`.
