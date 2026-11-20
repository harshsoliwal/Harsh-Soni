import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rulesContent = fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf-8');
const blueprint = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../firebase-blueprint.json'), 'utf-8')
) as { firestore: Record<string, unknown> };

describe('Firestore Security Rules Hardening & Dirty Dozen Verification', () => {
  it('declares rules_version 2 and default-deny catch-all as the first match block', () => {
    expect(rulesContent).toContain("rules_version = '2';");
    const firstMatchIdx = rulesContent.indexOf('match /{document=**}');
    const usersMatchIdx = rulesContent.indexOf('match /users/{userId}');
    expect(firstMatchIdx).toBeGreaterThan(-1);
    expect(firstMatchIdx).toBeLessThan(usersMatchIdx);
    expect(rulesContent).toMatch(/match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  });

  it('covers every single collection declared in firebase-blueprint.json (18/18 collections)', () => {
    const requiredCollections = Object.keys(blueprint.firestore).map((p) => p.split('/')[1]);
    expect(requiredCollections.length).toBe(18);
    for (const col of requiredCollections) {
      expect(rulesContent).toContain(`match /${col}/`);
    }
  });

  it('Dirty Dozen #1 & #2: blocks self-escalation to super_admin and role mutation on users', () => {
    expect(rulesContent).toContain("incoming().role == 'super_admin' && isBootstrappedAdmin()");
    expect(rulesContent).toContain('incoming().role == existing().role');
    expect(rulesContent).toContain(
      "incoming().diff(existing()).affectedKeys().hasOnly(['displayName', 'phone', 'supplierId', 'updatedAt'])"
    );
  });

  it('Dirty Dozen #3: blocks email spoofing by mandating email_verified == true', () => {
    expect(rulesContent).toContain(
      'return isSignedIn() && request.auth.token.email_verified == true;'
    );
    expect(rulesContent).toContain(
      "return isVerified() && request.auth.token.email == 'harshsoliwal@gmail.com';"
    );
  });

  it('Dirty Dozen #4 & #5: prevents supplier self-approval and unapproved public listings', () => {
    expect(rulesContent).toContain("incoming().status == 'Pending'");
    expect(rulesContent).toContain(
      "incoming().supplierApproved == (get(/databases/$(database)/documents/suppliers/$(incoming().supplierId)).data.status == 'Approved')"
    );
  });

  it('Dirty Dozen #6: enforces immutable 1.25% platform commission against supplier tampering', () => {
    expect(rulesContent).toContain('function expectedCommissionPct()');
    expect(rulesContent).toContain('incoming().platformCommissionRatePct == expectedCommissionPct()');
    expect(rulesContent).toContain(
      'incoming().platformCommissionRatePct == existing().platformCommissionRatePct'
    );
  });

  it('Dirty Dozen #7: enforces terminal state lock on Completed/Cancelled/Rejected orders', () => {
    expect(rulesContent).toContain("return status in ['Completed', 'Cancelled', 'Rejected'];");
    expect(rulesContent).toContain('!isTerminalOrderStatus(existing().status)');
  });

  it('Dirty Dozen #8 & #9: blocks shadow/ghost fields via hasOnly and ID poisoning via isValidId()', () => {
    expect(rulesContent).toContain(
      "return id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$');"
    );
    expect(rulesContent).toContain('data.keys().hasAll(');
    expect(rulesContent).toContain('data.keys().hasOnly(');
  });

  it('Dirty Dozen #10 & #11: enforces PII isolation on users and blocks customer reads on private support internal notes', () => {
    expect(rulesContent).toContain('(isSignedIn() && request.auth.uid == userId) || isAdmin()');
    expect(rulesContent).toContain(
      'resource.data.ticketOwnerId == request.auth.uid && resource.data.isInternalNote == false'
    );
  });

  it('Dirty Dozen #12: blocks reviews on incomplete orders and prevents duplicate invoices/reviews via docId == orderId', () => {
    expect(rulesContent).toContain('invoiceId == incoming().orderId');
    expect(rulesContent).toContain('reviewId == incoming().orderId');
    expect(rulesContent).toContain(
      "get(/databases/$(database)/documents/orders/$(incoming().orderId)).data.status == 'Completed'"
    );
  });

  it('never uses get() or exists() inside allow list blocks (Zero O(n) query cost explosion)', () => {
    const listLines = rulesContent
      .split('\n')
      .filter((line) => line.trim().startsWith('allow list:'));
    expect(listLines.length).toBeGreaterThan(10);
    for (const line of listLines) {
      expect(line).not.toContain('get(');
      expect(line).not.toContain('exists(');
    }
  });
});
