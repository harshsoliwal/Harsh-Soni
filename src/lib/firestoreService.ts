import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  handleFirestoreError,
  OperationType,
  storage,
} from './firebase';
import {
  buildUnitConversions,
  calculateBullionPricing,
  DEFAULT_PLATFORM_SETTINGS,
  getMcxRatePerUnit,
  roundInr,
} from './pricing';
import type {
  BullionForm,
  BullionListingDoc,
  JewellerProfileDoc,
  LiveMcxRate,
  MetalType,
  OrderDoc,
  OrderType,
  PlatformSettingsDoc,
  PurityGrade,
  SupplierDoc,
  SupplierStatus,
  UserDoc,
  UserRole,
} from '../types/bullion';

function generateSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function generateOrderNumber(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `BB-JPR-${ymd}-${seq}`;
}

export async function uploadDocumentFile(
  folder: string,
  file: File
): Promise<{ url: string; fileName: string; storageWarning?: string }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const path = `${folder}/${Date.now()}_${safeName}`;
  try {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    return { url, fileName: safeName };
  } catch {
    return {
      url: '',
      fileName: safeName,
      storageWarning:
        'Firebase Storage bucket rules are not yet enabled in your Firebase Console; document metadata has been recorded securely in Firestore.',
    };
  }
}

export async function recordAuditLog(params: {
  actorRole: string;
  action: string;
  targetCollection: string;
  targetId: string;
  details: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const logId = generateSafeId('audit');
  try {
    await setDoc(doc(db, 'audit_logs', logId), {
      actorUid: user.uid,
      actorEmail: user.email || 'unknown@bullionbridge.in',
      actorRole: params.actorRole.slice(0, 40),
      action: params.action.slice(0, 100),
      targetCollection: params.targetCollection.slice(0, 60),
      targetId: params.targetId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) || 'unknown',
      details: params.details.slice(0, 600),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log write
  }
}

export async function createNotification(params: {
  userId: string;
  title: string;
  message: string;
  category: 'ORDER' | 'RATE_LOCK' | 'VERIFICATION' | 'SUPPORT' | 'SETTLEMENT';
  relatedOrderId?: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const notifId = generateSafeId('notif');
  const payload: Record<string, unknown> = {
    userId: params.userId,
    senderUid: user.uid,
    title: params.title.slice(0, 140),
    message: params.message.slice(0, 400),
    category: params.category,
    isRead: false,
    createdAt: serverTimestamp(),
  };
  if (params.relatedOrderId) {
    payload.relatedOrderId = params.relatedOrderId;
  }
  try {
    await setDoc(doc(db, 'notifications', notifId), payload);
  } catch {
    // Non-blocking notification
  }
}

export async function ensureUserProfile(
  uid: string,
  email: string,
  displayName: string,
  requestedRole: UserRole = 'jeweller'
): Promise<UserDoc | null> {
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data() as UserDoc;
    }
    if (!auth.currentUser?.emailVerified) {
      return null;
    }

    // Check if user was invited as supplier_staff
    let resolvedRole: UserRole = requestedRole === 'super_admin' ? 'jeweller' : requestedRole;
    let linkedSupplierId: string | undefined;

    if (email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()) {
      resolvedRole = 'super_admin';
    } else {
      try {
        const staffSnap = await getDocs(
          query(collection(db, 'supplier_staff'), where('staffEmail', '==', email))
        );
        if (!staffSnap.empty) {
          const staffDoc = staffSnap.docs[0];
          const staffData = staffDoc.data();
          if (staffData.isActive) {
            resolvedRole = 'supplier_staff';
            linkedSupplierId = staffData.supplierId;
            if (!staffData.userId) {
              await updateDoc(doc(db, 'supplier_staff', staffDoc.id), {
                userId: uid,
                updatedAt: serverTimestamp(),
              });
            }
          }
        }
      } catch {
        // Ignore staff lookup errors
      }
    }

    const payload: Record<string, unknown> = {
      uid,
      email: email.slice(0, 200),
      displayName: (displayName || email.split('@')[0] || 'User').slice(0, 120),
      role: resolvedRole,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (linkedSupplierId) {
      payload.supplierId = linkedSupplierId;
    }

    await setDoc(userRef, payload);

    // Bootstrap platform_settings/config if Super Admin logs in first time
    if (resolvedRole === 'super_admin') {
      const cfgRef = doc(db, 'platform_settings', 'config');
      const cfgSnap = await getDoc(cfgRef);
      if (!cfgSnap.exists()) {
        await setDoc(cfgRef, {
          ...DEFAULT_PLATFORM_SETTINGS,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
      }
    }

    const created = await getDoc(userRef);
    return created.exists() ? (created.data() as UserDoc) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}

export async function syncLiveRateToFirestore(rate: LiveMcxRate): Promise<void> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const currentRef = doc(db, 'market_rates', 'current');
  try {
    const existing = await getDoc(currentRef);
    if (existing.exists() && existing.data().isManualOverride === true) {
      // Never overwrite an active Super Admin manual reference override
      return;
    }
    const payload: Record<string, unknown> = {
      gold999Per10g: rate.gold999Per10g,
      gold995Per10g: rate.gold995Per10g,
      gold999Per1g: rate.gold999Per1g,
      silver999Per1kg: rate.silver999Per1kg,
      silver999Per100g: rate.silver999Per100g,
      source: rate.source.slice(0, 120),
      isDelayed: Boolean(rate.isDelayed),
      isManualOverride: false,
      lastUpdatedAt: serverTimestamp(),
      updatedBy: user.uid,
    };
    if (typeof rate.usdInr === 'number') payload.usdInr = rate.usdInr;
    if (typeof rate.xauUsd === 'number') payload.xauUsd = rate.xauUsd;
    if (typeof rate.xagUsd === 'number') payload.xagUsd = rate.xagUsd;
    await setDoc(currentRef, payload);
  } catch {
    // Silent fallback when rules deny non-admin overwrite
  }
}

export async function saveJewellerProfile(
  uid: string,
  data: {
    shopName: string;
    ownerName: string;
    gstin: string;
    pan?: string;
    jaipurLocality: string;
    address?: string;
    contactPhone?: string;
    kycDocumentUrl?: string;
    kycDocumentName?: string;
  }
): Promise<void> {
  const profileRef = doc(db, 'jeweller_profiles', uid);
  try {
    const snap = await getDoc(profileRef);
    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        userId: uid,
        shopName: data.shopName.trim().slice(0, 140),
        ownerName: data.ownerName.trim().slice(0, 120),
        gstin: data.gstin.trim().toUpperCase().slice(0, 20),
        jaipurLocality: data.jaipurLocality.slice(0, 80),
        verificationStatus: 'Pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (data.pan) payload.pan = data.pan.trim().toUpperCase().slice(0, 16);
      if (data.address) payload.address = data.address.trim().slice(0, 300);
      if (data.contactPhone) payload.contactPhone = data.contactPhone.trim().slice(0, 24);
      if (data.kycDocumentUrl) payload.kycDocumentUrl = data.kycDocumentUrl.slice(0, 600);
      if (data.kycDocumentName) payload.kycDocumentName = data.kycDocumentName.slice(0, 160);
      await setDoc(profileRef, payload);
    } else {
      const updatePayload: Record<string, unknown> = {
        shopName: data.shopName.trim().slice(0, 140),
        ownerName: data.ownerName.trim().slice(0, 120),
        gstin: data.gstin.trim().toUpperCase().slice(0, 20),
        jaipurLocality: data.jaipurLocality.slice(0, 80),
        updatedAt: serverTimestamp(),
      };
      if (data.pan !== undefined) updatePayload.pan = data.pan.trim().toUpperCase().slice(0, 16);
      if (data.address !== undefined) updatePayload.address = data.address.trim().slice(0, 300);
      if (data.contactPhone !== undefined)
        updatePayload.contactPhone = data.contactPhone.trim().slice(0, 24);
      if (data.kycDocumentUrl !== undefined)
        updatePayload.kycDocumentUrl = data.kycDocumentUrl.slice(0, 600);
      if (data.kycDocumentName !== undefined)
        updatePayload.kycDocumentName = data.kycDocumentName.slice(0, 160);
      await updateDoc(profileRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `jeweller_profiles/${uid}`);
  }
}

export async function saveSupplierApplication(
  uid: string,
  existingSupplierId: string | null,
  data: {
    businessName: string;
    gstin: string;
    bisLicenseNumber: string;
    assayingPartner?: string;
    jaipurLocality: string;
    officeAddress: string;
    deliveryCenter: string;
    kycDocumentUrl?: string;
    kycDocumentName?: string;
  }
): Promise<string> {
  const supplierId = existingSupplierId || `sup_${uid.slice(0, 20)}`;
  const refDoc = doc(db, 'suppliers', supplierId);
  try {
    const snap = await getDoc(refDoc);
    if (!snap.exists()) {
      const payload: Record<string, unknown> = {
        ownerUserId: uid,
        businessName: data.businessName.trim().slice(0, 140),
        gstin: data.gstin.trim().toUpperCase().slice(0, 20),
        bisLicenseNumber: data.bisLicenseNumber.trim().slice(0, 80),
        jaipurLocality: data.jaipurLocality.slice(0, 80),
        officeAddress: data.officeAddress.trim().slice(0, 300),
        deliveryCenter: data.deliveryCenter.trim().slice(0, 200),
        status: 'Pending',
        ratingAvg: 0,
        reviewCount: 0,
        completedOrdersCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (data.assayingPartner) payload.assayingPartner = data.assayingPartner.trim().slice(0, 140);
      if (data.kycDocumentUrl) payload.kycDocumentUrl = data.kycDocumentUrl.slice(0, 600);
      if (data.kycDocumentName) payload.kycDocumentName = data.kycDocumentName.slice(0, 160);
      await setDoc(refDoc, payload);

      await updateDoc(doc(db, 'users', uid), {
        supplierId,
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        actorRole: 'supplier',
        action: 'SUPPLIER_ONBOARDING_SUBMITTED',
        targetCollection: 'suppliers',
        targetId: supplierId,
        details: `Supplier ${data.businessName} submitted Jaipur verification credentials.`,
      });
    } else {
      const updatePayload: Record<string, unknown> = {
        businessName: data.businessName.trim().slice(0, 140),
        gstin: data.gstin.trim().toUpperCase().slice(0, 20),
        bisLicenseNumber: data.bisLicenseNumber.trim().slice(0, 80),
        jaipurLocality: data.jaipurLocality.slice(0, 80),
        officeAddress: data.officeAddress.trim().slice(0, 300),
        deliveryCenter: data.deliveryCenter.trim().slice(0, 200),
        updatedAt: serverTimestamp(),
      };
      if (data.assayingPartner !== undefined)
        updatePayload.assayingPartner = data.assayingPartner.trim().slice(0, 140);
      if (data.kycDocumentUrl !== undefined)
        updatePayload.kycDocumentUrl = data.kycDocumentUrl.slice(0, 600);
      if (data.kycDocumentName !== undefined)
        updatePayload.kycDocumentName = data.kycDocumentName.slice(0, 160);
      await updateDoc(refDoc, updatePayload);
    }
    return supplierId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `suppliers/${supplierId}`);
  }
}

export async function createOrUpdateListing(
  supplier: SupplierDoc,
  existingListingId: string | null,
  data: {
    metal: MetalType;
    purity: PurityGrade;
    form: BullionForm;
    title: string;
    unitGrams: number;
    minWeightGrams: number;
    maxWeightGrams: number;
    availableStockGrams: number;
    premiumPerUnitInr: number;
    deliveryCenter: string;
    supportsBuy: boolean;
    supportsSell: boolean;
    supportsExchange: boolean;
    isActive: boolean;
  }
): Promise<string> {
  const listingId = existingListingId || generateSafeId('lst');
  const listingRef = doc(db, 'bullion_listings', listingId);
  try {
    if (!existingListingId) {
      await setDoc(listingRef, {
        supplierId: supplier.id,
        supplierOwnerId: supplier.ownerUserId,
        supplierName: supplier.businessName.slice(0, 140),
        supplierApproved: supplier.status === 'Approved',
        metal: data.metal,
        purity: data.purity,
        form: data.form,
        title: data.title.trim().slice(0, 140),
        unitGrams: Number(data.unitGrams),
        minWeightGrams: Number(data.minWeightGrams),
        maxWeightGrams: Number(data.maxWeightGrams),
        availableStockGrams: Number(data.availableStockGrams),
        premiumPerUnitInr: Number(data.premiumPerUnitInr),
        jaipurLocality: supplier.jaipurLocality.slice(0, 80),
        deliveryCenter: data.deliveryCenter.trim().slice(0, 200),
        supportsBuy: Boolean(data.supportsBuy),
        supportsSell: Boolean(data.supportsSell),
        supportsExchange: Boolean(data.supportsExchange),
        isActive: Boolean(data.isActive),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(listingRef, {
        form: data.form,
        title: data.title.trim().slice(0, 140),
        unitGrams: Number(data.unitGrams),
        minWeightGrams: Number(data.minWeightGrams),
        maxWeightGrams: Number(data.maxWeightGrams),
        availableStockGrams: Number(data.availableStockGrams),
        premiumPerUnitInr: Number(data.premiumPerUnitInr),
        deliveryCenter: data.deliveryCenter.trim().slice(0, 200),
        supportsBuy: Boolean(data.supportsBuy),
        supportsSell: Boolean(data.supportsSell),
        supportsExchange: Boolean(data.supportsExchange),
        isActive: Boolean(data.isActive),
        supplierApproved: supplier.status === 'Approved',
        updatedAt: serverTimestamp(),
      });
    }
    return listingId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `bullion_listings/${listingId}`);
  }
}

export async function deleteListing(listingId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'bullion_listings', listingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `bullion_listings/${listingId}`);
  }
}

export async function addSupplierStaff(
  supplier: SupplierDoc,
  data: {
    staffEmail: string;
    staffName: string;
    designation?: string;
    canLockRates: boolean;
    canUploadPurityDocs: boolean;
  }
): Promise<string> {
  const staffId = generateSafeId('staff');
  try {
    const payload: Record<string, unknown> = {
      supplierId: supplier.id,
      supplierOwnerId: supplier.ownerUserId,
      staffEmail: data.staffEmail.trim().toLowerCase().slice(0, 200),
      staffName: data.staffName.trim().slice(0, 120),
      canLockRates: Boolean(data.canLockRates),
      canUploadPurityDocs: Boolean(data.canUploadPurityDocs),
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (data.designation) payload.designation = data.designation.trim().slice(0, 80);
    await setDoc(doc(db, 'supplier_staff', staffId), payload);
    return staffId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `supplier_staff/${staffId}`);
  }
}

export async function removeSupplierStaff(staffId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'supplier_staff', staffId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `supplier_staff/${staffId}`);
  }
}

/**
 * Transaction-safe quote submission with idempotencyKey as document ID to prevent duplicate orders.
 * Price remains floating/dynamic until Supplier clicks Confirm & Lock Rate.
 */
export async function submitQuoteRequest(params: {
  idempotencyKey: string;
  jewellerUid: string;
  jewellerShopName: string;
  listing: BullionListingDoc;
  orderType: OrderType;
  weightGrams: number;
  liveRate: LiveMcxRate;
  platformSettings: PlatformSettingsDoc;
  notes?: string;
}): Promise<string> {
  const safeOrderId = params.idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  const orderRef = doc(db, 'orders', safeOrderId);
  const historyId = generateSafeId('hist');
  const historyRef = doc(db, 'order_status_history', historyId);

  const indicativeMcxRatePerUnit = getMcxRatePerUnit(
    params.liveRate,
    params.listing.metal,
    params.listing.purity
  );
  const orderNumber = generateOrderNumber();

  try {
    await runTransaction(db, async (tx) => {
      const existingOrder = await tx.get(orderRef);
      if (existingOrder.exists()) {
        throw new Error('Duplicate quote request prevented: this quote was already submitted.');
      }

      const orderPayload: Record<string, unknown> = {
        orderNumber,
        idempotencyKey: safeOrderId,
        jewellerId: params.jewellerUid,
        jewellerShopName: params.jewellerShopName.slice(0, 140),
        supplierId: params.listing.supplierId,
        supplierOwnerId: params.listing.supplierOwnerId,
        supplierName: params.listing.supplierName.slice(0, 140),
        listingId: params.listing.id,
        assignedStaffUids: [],
        orderType: params.orderType,
        metal: params.listing.metal,
        purity: params.listing.purity,
        weightGrams: Number(params.weightGrams),
        deliveryCenter: params.listing.deliveryCenter.slice(0, 200),
        status: 'Quote Requested',
        isRateLocked: false,
        indicativeMcxRatePerUnit,
        supplierPremiumPerUnitInr: params.listing.premiumPerUnitInr,
        platformCommissionRatePct: params.platformSettings.commissionRatePct,
        gstRatePct: params.platformSettings.gstRatePct,
        hasInvoice: false,
        hasReview: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (params.notes?.trim()) {
        orderPayload.notes = params.notes.trim().slice(0, 500);
      }

      tx.set(orderRef, orderPayload);
      tx.set(historyRef, {
        orderId: safeOrderId,
        jewellerId: params.jewellerUid,
        supplierOwnerId: params.listing.supplierOwnerId,
        assignedStaffUids: [],
        fromStatus: 'New',
        toStatus: 'Quote Requested',
        changedByUid: params.jewellerUid,
        changedByRole: 'jeweller',
        note: `${params.orderType} quote requested for ${params.weightGrams}g ${params.listing.metal} ${params.listing.purity}. Pricing floating with live MCX.`,
        createdAt: serverTimestamp(),
      });
    });

    await createNotification({
      userId: params.listing.supplierOwnerId,
      title: `New ${params.orderType} Quote Request (${orderNumber})`,
      message: `${params.jewellerShopName} requested ${params.weightGrams}g ${params.listing.metal} ${params.listing.purity}. Review and lock live MCX rate.`,
      category: 'ORDER',
      relatedOrderId: safeOrderId,
    });

    return safeOrderId;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Duplicate quote request')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, `orders/${safeOrderId}`);
  }
}

/**
 * Supplier Confirm & Lock Rate:
 * 1. Calls protected server endpoint /api/orders/verify-lock-rate with caller's Firebase ID token
 *    to capture authoritative live MCX rate and verify 1.25% commission calculation.
 * 2. Executes Firestore transaction to write immutable locked price snapshot + history + settlement ledger.
 */
export async function confirmAndLockOrderRate(params: {
  order: OrderDoc;
  actorRole: UserRole;
  platformSettings: PlatformSettingsDoc;
  activeRate: LiveMcxRate;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');

  const idToken = await user.getIdToken();
  const manualOverrideRatePerUnit =
    params.platformSettings.manualOverrideEnabled &&
    params.activeRate.isManualOverride
      ? getMcxRatePerUnit(params.activeRate, params.order.metal, params.order.purity)
      : undefined;

  const verifyResp = await fetch('/api/orders/verify-lock-rate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      metal: params.order.metal,
      purity: params.order.purity,
      weightGrams: params.order.weightGrams,
      supplierPremiumPerUnitInr: params.order.supplierPremiumPerUnitInr,
      platformCommissionRatePct: params.platformSettings.commissionRatePct,
      gstRatePct: params.platformSettings.gstRatePct,
      manualOverrideRatePerUnit,
    }),
  });

  if (!verifyResp.ok) {
    const errBody = (await verifyResp.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || 'Server rate lock verification failed.');
  }

  const verified = (await verifyResp.json()) as {
    rateSource: string;
    breakdown: ReturnType<typeof calculateBullionPricing>;
  };

  const b = verified.breakdown;
  const orderRef = doc(db, 'orders', params.order.id);
  const historyRef = doc(db, 'order_status_history', generateSafeId('hist'));
  const settlementRef = doc(db, 'settlements', params.order.id);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error('Order not found.');
      const cur = snap.data() as OrderDoc;
      if (cur.status !== 'Quote Requested' || cur.isRateLocked) {
        throw new Error('This quote has already been locked or transitioned.');
      }

      tx.update(orderRef, {
        status: 'Quote Confirmed & Rate Locked',
        isRateLocked: true,
        lockedMcxBaseRatePerUnit: b.mcxBaseRatePerUnit,
        baseMetalValueInr: b.baseMetalValueInr,
        supplierPremiumTotalInr: b.supplierPremiumTotalInr,
        grossBullionValueInr: b.grossBullionValueInr,
        platformCommissionInr: b.platformCommissionInr,
        gstAmountInr: b.gstAmountInr,
        finalPayableTotalInr: b.finalPayableTotalInr,
        rateLockedAt: serverTimestamp(),
        rateLockedByUid: user.uid,
        updatedAt: serverTimestamp(),
      });

      tx.set(historyRef, {
        orderId: params.order.id,
        jewellerId: cur.jewellerId,
        supplierOwnerId: cur.supplierOwnerId,
        assignedStaffUids: cur.assignedStaffUids || [],
        fromStatus: 'Quote Requested',
        toStatus: 'Quote Confirmed & Rate Locked',
        changedByUid: user.uid,
        changedByRole: params.actorRole,
        note: `Rate locked via ${verified.rateSource}. Base MCX ₹${b.mcxBaseRatePerUnit}/unit + Premium ₹${b.supplierPremiumPerUnitInr}/unit + ${b.platformCommissionRatePct}% commission.`,
        priceSnapshotInr: b.finalPayableTotalInr,
        createdAt: serverTimestamp(),
      });

      tx.set(settlementRef, {
        orderId: params.order.id,
        orderNumber: cur.orderNumber,
        supplierId: cur.supplierId,
        supplierOwnerId: cur.supplierOwnerId,
        supplierName: cur.supplierName,
        grossTransactionValueInr: b.grossBullionValueInr,
        platformCommissionRatePct: b.platformCommissionRatePct,
        platformCommissionInr: b.platformCommissionInr,
        supplierNetPayableInr: b.supplierNetPayableInr,
        status: 'Pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await createNotification({
      userId: params.order.jewellerId,
      title: `Rate Locked for ${params.order.orderNumber}`,
      message: `${params.order.supplierName} confirmed and locked MCX rate at ₹${b.mcxBaseRatePerUnit.toLocaleString('en-IN')}/unit. Final Total: ₹${b.finalPayableTotalInr.toLocaleString('en-IN')}.`,
      category: 'RATE_LOCK',
      relatedOrderId: params.order.id,
    });

    await recordAuditLog({
      actorRole: params.actorRole,
      action: 'ORDER_RATE_LOCKED',
      targetCollection: 'orders',
      targetId: params.order.id,
      details: `Locked ${params.order.orderNumber} GTV ₹${b.grossBullionValueInr}, Commission (${b.platformCommissionRatePct}%) ₹${b.platformCommissionInr}.`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('already been locked')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function rejectOrCancelOrder(params: {
  order: OrderDoc;
  actorRole: UserRole;
  targetStatus: 'Rejected' | 'Cancelled';
  reason: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  const orderRef = doc(db, 'orders', params.order.id);
  const historyRef = doc(db, 'order_status_history', generateSafeId('hist'));

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error('Order not found.');
      const cur = snap.data() as OrderDoc;

      tx.update(orderRef, {
        status: params.targetStatus,
        rejectionReason: params.reason.trim().slice(0, 300),
        updatedAt: serverTimestamp(),
      });

      tx.set(historyRef, {
        orderId: params.order.id,
        jewellerId: cur.jewellerId,
        supplierOwnerId: cur.supplierOwnerId,
        assignedStaffUids: cur.assignedStaffUids || [],
        fromStatus: cur.status,
        toStatus: params.targetStatus,
        changedByUid: user.uid,
        changedByRole: params.actorRole,
        note: params.reason.trim().slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });

    const notifyTarget =
      user.uid === params.order.jewellerId ? params.order.supplierOwnerId : params.order.jewellerId;
    await createNotification({
      userId: notifyTarget,
      title: `Order ${params.order.orderNumber} ${params.targetStatus}`,
      message: params.reason.slice(0, 360),
      category: 'ORDER',
      relatedOrderId: params.order.id,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

export async function uploadPurityCertificate(params: {
  order: OrderDoc;
  actorRole: UserRole;
  certificateNumber: string;
  assayingLab: string;
  testedPurity: string;
  grossWeightGrams: number;
  netWeightGrams: number;
  file?: File | null;
}): Promise<{ storageWarning?: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');

  let fileUrl = '';
  let fileName = `${params.certificateNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}_Assay_Certificate.pdf`;
  let storageWarning: string | undefined;

  if (params.file) {
    const uploaded = await uploadDocumentFile(`purity_certificates/${params.order.id}`, params.file);
    fileUrl = uploaded.url;
    fileName = uploaded.fileName;
    storageWarning = uploaded.storageWarning;
  }

  const docId = generateSafeId('pur');
  const orderRef = doc(db, 'orders', params.order.id);
  const purityRef = doc(db, 'purity_documents', docId);
  const historyRef = doc(db, 'order_status_history', generateSafeId('hist'));

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error('Order not found.');
      const cur = snap.data() as OrderDoc;

      const purityPayload: Record<string, unknown> = {
        orderId: params.order.id,
        jewellerId: cur.jewellerId,
        supplierId: cur.supplierId,
        supplierOwnerId: cur.supplierOwnerId,
        assignedStaffUids: cur.assignedStaffUids || [],
        certificateNumber: params.certificateNumber.trim().slice(0, 80),
        assayingLab: params.assayingLab.trim().slice(0, 140),
        testedPurity: params.testedPurity.trim().slice(0, 40),
        grossWeightGrams: Number(params.grossWeightGrams),
        netWeightGrams: Number(params.netWeightGrams),
        fileName: fileName.slice(0, 160),
        uploadedByUid: user.uid,
        createdAt: serverTimestamp(),
      };
      if (fileUrl) purityPayload.fileUrl = fileUrl.slice(0, 600);

      tx.set(purityRef, purityPayload);

      if (cur.status === 'Quote Confirmed & Rate Locked') {
        tx.update(orderRef, {
          status: 'Purity & Docs Uploaded',
          updatedAt: serverTimestamp(),
        });
        tx.set(historyRef, {
          orderId: params.order.id,
          jewellerId: cur.jewellerId,
          supplierOwnerId: cur.supplierOwnerId,
          assignedStaffUids: cur.assignedStaffUids || [],
          fromStatus: cur.status,
          toStatus: 'Purity & Docs Uploaded',
          changedByUid: user.uid,
          changedByRole: params.actorRole,
          note: `Assaying certificate #${params.certificateNumber} (${params.testedPurity}, ${params.assayingLab}) uploaded.`,
          createdAt: serverTimestamp(),
        });
      }
    });

    await createNotification({
      userId: params.order.jewellerId,
      title: `Purity Certificate Ready (${params.order.orderNumber})`,
      message: `Certificate #${params.certificateNumber} verified at ${params.testedPurity}. Review and approve to proceed to settlement.`,
      category: 'ORDER',
      relatedOrderId: params.order.id,
    });

    return { storageWarning };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `purity_documents/${docId}`);
  }
}

export async function advanceOrderWorkflow(params: {
  order: OrderDoc;
  actorRole: UserRole;
  nextStatus:
    | 'Order Approved by Jeweller'
    | 'Payment / Exchange Settled'
    | 'Ready for Pickup / Dispatch'
    | 'Completed';
  note: string;
  settlementMethod?: string;
  settlementReference?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  const orderRef = doc(db, 'orders', params.order.id);
  const historyRef = doc(db, 'order_status_history', generateSafeId('hist'));

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists()) throw new Error('Order not found.');
      const cur = snap.data() as OrderDoc;

      const updateFields: Record<string, unknown> = {
        status: params.nextStatus,
        updatedAt: serverTimestamp(),
      };
      if (params.nextStatus === 'Payment / Exchange Settled') {
        updateFields.settlementMethod = (params.settlementMethod || 'RTGS / NEFT').slice(0, 60);
        updateFields.settlementReference = (params.settlementReference || 'MANUAL-SETTLED').slice(
          0,
          120
        );
      }

      tx.update(orderRef, updateFields);
      tx.set(historyRef, {
        orderId: params.order.id,
        jewellerId: cur.jewellerId,
        supplierOwnerId: cur.supplierOwnerId,
        assignedStaffUids: cur.assignedStaffUids || [],
        fromStatus: cur.status,
        toStatus: params.nextStatus,
        changedByUid: user.uid,
        changedByRole: params.actorRole,
        note: params.note.trim().slice(0, 400),
        createdAt: serverTimestamp(),
      });
    });

    const notifyTarget =
      user.uid === params.order.jewellerId ? params.order.supplierOwnerId : params.order.jewellerId;
    await createNotification({
      userId: notifyTarget,
      title: `${params.order.orderNumber}: ${params.nextStatus}`,
      message: params.note.slice(0, 360),
      category: 'ORDER',
      relatedOrderId: params.order.id,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${params.order.id}`);
  }
}

/**
 * Generates a unique GST Tax Invoice keyed strictly by orderId inside a Firestore transaction
 * so duplicate invoice generation is mathematically impossible.
 */
export async function generateOrderInvoice(order: OrderDoc): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  if (!order.isRateLocked || !order.grossBullionValueInr || !order.finalPayableTotalInr) {
    throw new Error('Cannot generate invoice before rate is confirmed and locked.');
  }

  const invoiceRef = doc(db, 'invoices', order.id);
  const orderRef = doc(db, 'orders', order.id);
  const invoiceNumber = `INV-${order.orderNumber}`;

  try {
    await runTransaction(db, async (tx) => {
      const existingInv = await tx.get(invoiceRef);
      if (existingInv.exists()) {
        throw new Error('Invoice has already been generated for this order.');
      }

      tx.set(invoiceRef, {
        orderId: order.id,
        invoiceNumber,
        jewellerId: order.jewellerId,
        jewellerShopName: order.jewellerShopName,
        supplierId: order.supplierId,
        supplierOwnerId: order.supplierOwnerId,
        supplierName: order.supplierName,
        assignedStaffUids: order.assignedStaffUids || [],
        metal: order.metal,
        purity: order.purity,
        weightGrams: order.weightGrams,
        grossBullionValueInr: order.grossBullionValueInr,
        platformCommissionRatePct: order.platformCommissionRatePct,
        platformCommissionInr: order.platformCommissionInr ?? 0,
        gstRatePct: order.gstRatePct,
        gstAmountInr: order.gstAmountInr ?? 0,
        finalPayableTotalInr: order.finalPayableTotalInr,
        issuedByUid: user.uid,
        issuedAt: serverTimestamp(),
      });

      tx.update(orderRef, {
        hasInvoice: true,
        updatedAt: serverTimestamp(),
      });
    });

    await createNotification({
      userId: order.jewellerId,
      title: `Tax Invoice Issued (${invoiceNumber})`,
      message: `GST Tax Invoice for order ${order.orderNumber} is now available for download.`,
      category: 'ORDER',
      relatedOrderId: order.id,
    });

    return invoiceNumber;
  } catch (error) {
    if (error instanceof Error && error.message.includes('already been generated')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.CREATE, `invoices/${order.id}`);
  }
}

/**
 * Verified review submission strictly allowed on Completed orders, keyed by orderId.
 */
export async function submitVerifiedReview(params: {
  order: OrderDoc;
  rating: number;
  comment: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');

  const reviewRef = doc(db, 'reviews', params.order.id);
  const orderRef = doc(db, 'orders', params.order.id);

  try {
    await runTransaction(db, async (tx) => {
      const existingReview = await tx.get(reviewRef);
      if (existingReview.exists()) {
        throw new Error('A verified review has already been submitted for this order.');
      }
      tx.set(reviewRef, {
        orderId: params.order.id,
        jewellerId: user.uid,
        jewellerShopName: params.order.jewellerShopName,
        supplierId: params.order.supplierId,
        rating: Math.min(5, Math.max(1, Math.round(params.rating))),
        comment: params.comment.trim().slice(0, 600),
        createdAt: serverTimestamp(),
      });
      tx.update(orderRef, {
        hasReview: true,
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reviews/${params.order.id}`);
  }
}

export async function createSupportTicket(params: {
  createdByName: string;
  createdByRole: UserRole;
  subject: string;
  category: 'Order Issue' | 'Purity Dispute' | 'KYC / Verification' | 'Settlement / Invoice' | 'General';
  priority: 'Low' | 'Medium' | 'High';
  initialMessage: string;
  relatedOrderId?: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  const ticketId = generateSafeId('tkt');
  const msgId = generateSafeId('msg');
  const ticketNumber = `SUP-${Math.floor(10000 + Math.random() * 90000)}`;

  try {
    const ticketPayload: Record<string, unknown> = {
      ticketNumber,
      createdByUid: user.uid,
      createdByName: params.createdByName.slice(0, 120),
      createdByRole: params.createdByRole,
      subject: params.subject.trim().slice(0, 160),
      category: params.category,
      priority: params.priority,
      status: 'Open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.relatedOrderId?.trim()) {
      ticketPayload.relatedOrderId = params.relatedOrderId.trim().slice(0, 128);
    }

    await setDoc(doc(db, 'support_tickets', ticketId), ticketPayload);
    await setDoc(doc(db, 'support_messages', msgId), {
      ticketId,
      ticketOwnerId: user.uid,
      senderUid: user.uid,
      senderName: params.createdByName.slice(0, 120),
      senderRole: params.createdByRole,
      body: params.initialMessage.trim().slice(0, 1500),
      isInternalNote: false,
      createdAt: serverTimestamp(),
    });
    return ticketId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `support_tickets/${ticketId}`);
  }
}

export async function sendSupportMessage(params: {
  ticketId: string;
  ticketOwnerId: string;
  senderName: string;
  senderRole: UserRole;
  body: string;
  isInternalNote?: boolean;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  const msgId = generateSafeId('msg');
  try {
    await setDoc(doc(db, 'support_messages', msgId), {
      ticketId: params.ticketId,
      ticketOwnerId: params.ticketOwnerId,
      senderUid: user.uid,
      senderName: params.senderName.slice(0, 120),
      senderRole: params.senderRole,
      body: params.body.trim().slice(0, 1500),
      isInternalNote: Boolean(params.isInternalNote),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `support_messages/${msgId}`);
  }
}

// =========================================================================
// SUPER ADMIN OPERATIONS
// =========================================================================

export async function adminUpdateSupplierStatus(
  supplier: SupplierDoc,
  status: SupplierStatus,
  adminRemarks: string
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'suppliers', supplier.id), {
      status,
      adminRemarks: adminRemarks.trim().slice(0, 400),
      updatedAt: serverTimestamp(),
    });

    // Synchronize supplierApproved flag across all listings belonging to this supplier
    const listingsSnap = await getDocs(
      query(collection(db, 'bullion_listings'), where('supplierOwnerId', '==', supplier.ownerUserId))
    );
    listingsSnap.forEach((lDoc) => {
      batch.update(lDoc.ref, {
        supplierApproved: status === 'Approved',
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();

    await createNotification({
      userId: supplier.ownerUserId,
      title: `Supplier Account Status: ${status}`,
      message: adminRemarks || `Your supplier verification status is now ${status}.`,
      category: 'VERIFICATION',
    });

    await recordAuditLog({
      actorRole: 'super_admin',
      action: 'ADMIN_SUPPLIER_STATUS_UPDATED',
      targetCollection: 'suppliers',
      targetId: supplier.id,
      details: `Updated ${supplier.businessName} status to ${status}. Remarks: ${adminRemarks}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `suppliers/${supplier.id}`);
  }
}

export async function adminUpdateJewellerVerification(
  profile: JewellerProfileDoc,
  verificationStatus: 'Pending' | 'Under Review' | 'Approved' | 'Rejected'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'jeweller_profiles', profile.id), {
      verificationStatus,
      updatedAt: serverTimestamp(),
    });
    await createNotification({
      userId: profile.userId,
      title: `Jeweller KYC Status: ${verificationStatus}`,
      message: `Your Jaipur jeweller business profile (${profile.shopName}) is now marked ${verificationStatus}.`,
      category: 'VERIFICATION',
    });
    await recordAuditLog({
      actorRole: 'super_admin',
      action: 'ADMIN_JEWELLER_KYC_UPDATED',
      targetCollection: 'jeweller_profiles',
      targetId: profile.id,
      details: `Updated ${profile.shopName} KYC verification to ${verificationStatus}.`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `jeweller_profiles/${profile.id}`);
  }
}

export async function adminSavePlatformSettings(
  settings: PlatformSettingsDoc
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required.');
  try {
    const payload: Record<string, unknown> = {
      commissionRatePct: roundInr(settings.commissionRatePct),
      gstRatePct: roundInr(settings.gstRatePct),
      benchmarkAvgTransactionInr: roundInr(settings.benchmarkAvgTransactionInr),
      benchmarkVariableCostPct: roundInr(settings.benchmarkVariableCostPct),
      benchmarkVariableCostInr: roundInr(settings.benchmarkVariableCostInr),
      monthlyFixedCostInr: roundInr(settings.monthlyFixedCostInr),
      manualOverrideEnabled: Boolean(settings.manualOverrideEnabled),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    };
    if (typeof settings.manualGold999Per10g === 'number' && settings.manualGold999Per10g > 0) {
      payload.manualGold999Per10g = roundInr(settings.manualGold999Per10g);
    }
    if (typeof settings.manualSilver999Per1kg === 'number' && settings.manualSilver999Per1kg > 0) {
      payload.manualSilver999Per1kg = roundInr(settings.manualSilver999Per1kg);
    }
    if (settings.manualOverrideReason) {
      payload.manualOverrideReason = settings.manualOverrideReason.slice(0, 240);
    }

    await setDoc(doc(db, 'platform_settings', 'config'), payload);

    if (
      settings.manualOverrideEnabled &&
      settings.manualGold999Per10g &&
      settings.manualSilver999Per1kg
    ) {
      const conv = buildUnitConversions(
        settings.manualGold999Per10g,
        settings.manualSilver999Per1kg
      );
      await setDoc(doc(db, 'market_rates', 'current'), {
        ...conv,
        source: 'Super Admin Manual Reference Rate',
        isDelayed: true,
        isManualOverride: true,
        manualOverrideNote: (
          settings.manualOverrideReason || 'Manual reference override active'
        ).slice(0, 240),
        lastUpdatedAt: serverTimestamp(),
        updatedBy: user.uid,
      });
    } else if (!settings.manualOverrideEnabled) {
      // Clear manual override flag in market_rates/current if present
      const curSnap = await getDoc(doc(db, 'market_rates', 'current'));
      if (curSnap.exists() && curSnap.data().isManualOverride === true) {
        const d = curSnap.data();
        await setDoc(doc(db, 'market_rates', 'current'), {
          gold999Per10g: d.gold999Per10g,
          gold995Per10g: d.gold995Per10g,
          gold999Per1g: d.gold999Per1g,
          silver999Per1kg: d.silver999Per1kg,
          silver999Per100g: d.silver999Per100g,
          source: 'Last Cached Reference Rate',
          isDelayed: true,
          isManualOverride: false,
          lastUpdatedAt: serverTimestamp(),
          updatedBy: user.uid,
        });
      }
    }

    await recordAuditLog({
      actorRole: 'super_admin',
      action: 'ADMIN_PLATFORM_SETTINGS_UPDATED',
      targetCollection: 'platform_settings',
      targetId: 'config',
      details: `Commission: ${settings.commissionRatePct}%, GST: ${settings.gstRatePct}%, Manual Override: ${settings.manualOverrideEnabled}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'platform_settings/config');
  }
}

export async function adminMarkSettlementSettled(
  settlementId: string,
  supplierOwnerId: string,
  orderNumber: string,
  referenceNumber: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'settlements', settlementId), {
      status: 'Settled',
      referenceNumber: referenceNumber.trim().slice(0, 120),
      updatedAt: serverTimestamp(),
    });
    await createNotification({
      userId: supplierOwnerId,
      title: `Settlement Completed (${orderNumber})`,
      message: `Settlement marked Settled with Ref: ${referenceNumber}.`,
      category: 'SETTLEMENT',
      relatedOrderId: settlementId,
    });
    await recordAuditLog({
      actorRole: 'super_admin',
      action: 'ADMIN_SETTLEMENT_SETTLED',
      targetCollection: 'settlements',
      targetId: settlementId,
      details: `Marked settlement ${orderNumber} as Settled (Ref: ${referenceNumber}).`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `settlements/${settlementId}`);
  }
}

export async function adminUpdateTicketStatus(
  ticketId: string,
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'support_tickets', ticketId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `support_tickets/${ticketId}`);
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), {
      isRead: true,
    });
  } catch {
    // ignore
  }
}
