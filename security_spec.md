# BullionBridge Security Specification (Phase 0 — Payload-First Security TDD)

## 1. Core Data Invariants
1. **Role Integrity**: No user may self-assign `role: "super_admin"` or mutate their own `role` field after creation. Super Admin privileges derive exclusively from verified bootstrapped admin email (`harshsoliwal@gmail.com` with `email_verified == true`) or the server/admin-managed `admins/{uid}` registry.
2. **PII Isolation**: User records in `users/{uid}` and KYC records in `jeweller_profiles/{profileId}` are strictly readable only by their owner or Super Admin. Blanket authenticated reads are forbidden.
3. **Public Supplier Gating**: Only `suppliers` documents with `status == "Approved"` and `bullion_listings` with `supplierApproved == true && isActive == true` are publicly readable/listable. Suppliers cannot self-approve (`status` on create MUST be `"Pending"`).
4. **Commission Immutability**: Neither jewellers nor suppliers may override `platformCommissionRatePct` on orders or alter `platform_settings/config`. Orders must match `platform_settings/config.commissionRatePct` (default `1.25%`) at creation and rate lock.
5. **Dynamic-Until-Confirmed & Terminal State Lock**: An order created by a jeweller starts as `"Quote Requested"` with `isRateLocked == false`. Once an order reaches a terminal state (`Completed`, `Cancelled`, `Rejected`), no non-admin mutation is permitted.
6. **Immutable Ledger Records**: `order_status_history`, `invoices`, `reviews`, and `audit_logs` are append-only and cannot be modified or deleted by non-admins.
7. **Support Internal Notes Isolation**: `support_messages` with `isInternalNote == true` can only be read or created by Super Admins. Customers and suppliers are mathematically blocked from reading internal notes.
8. **Duplicate Prevention**: Invoices use `invoiceId == orderId` and Reviews use `reviewId == orderId` (requiring the referenced order to exist and be `Completed` for reviews, or locked for invoices).

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Self-Escalation to Super Admin (`users/{uid}` create)**: `{ uid, email, displayName, role: "super_admin", isActive: true, ... }`
2. **Role Mutation Shadow Update (`users/{uid}` update)**: Authenticated jeweller updating `{ role: "super_admin", updatedAt: serverTimestamp() }`.
3. **Unverified Email Spoofing (`suppliers/{id}` create)**: Token has `email: "harshsoliwal@gmail.com"` with `email_verified: false`.
4. **Supplier Self-Approval (`suppliers/{id}` create)**: Supplier creates doc with `status: "Approved"` instead of `"Pending"`.
5. **Unapproved Supplier Listing Injection (`bullion_listings/{id}` create)**: Supplier with `status: "Pending"` attempts to publish a listing with `supplierApproved: true`.
6. **Commission Rate Tampering (`orders/{id}` update — Confirm & Lock)**: Supplier tries to confirm order with `platformCommissionRatePct: 0` instead of `1.25`.
7. **Terminal State Resurrection (`orders/{id}` update)**: Supplier attempts to change an order whose `status` is `"Completed"` back to `"Quote Requested"`.
8. **Ghost / Shadow Field Injection (`orders/{id}` create)**: Jeweller injects `{ isAdminVerified: true }` alongside valid order fields.
9. **Resource / ID Poisoning (`orders/{1500_char_id}` create)**: Path ID exceeds 128 chars or contains invalid regex characters (`../admin`).
10. **PII Cross-Tenant Read (`users/{otherUid}` get)**: Authenticated jeweller attempts to read another jeweller's `users` document.
11. **Private Support Note Leak (`support_messages/{id}` get/list)**: Ticket owner queries `support_messages` with `isInternalNote == true`.
12. **Fake Review on Incomplete Order (`reviews/{orderId}` create)**: Jeweller submits a review while the referenced order is still in `"Quote Requested"` status.
