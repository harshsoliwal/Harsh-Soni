import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileCheck2,
  Lock,
  LockOpen,
  Receipt,
  Star,
  Upload,
  X,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import {
  advanceOrderWorkflow,
  confirmAndLockOrderRate,
  generateOrderInvoice,
  rejectOrCancelOrder,
  submitVerifiedReview,
  uploadPurityCertificate,
} from '../lib/firestoreService';
import { downloadGstInvoiceHtml, downloadPuritySummary } from '../lib/invoicePdf';
import { formatInr, getEffectiveOrderPricing } from '../lib/pricing';
import {
  ORDER_WORKFLOW_STEPS,
  type InvoiceDoc,
  type OrderDoc,
  type OrderStatusHistoryDoc,
  type PurityDocumentDoc,
} from '../types/bullion';

interface OrderDetailDrawerProps {
  order: OrderDoc | null;
  onClose: () => void;
}

export function OrderDetailDrawer({ order, onClose }: OrderDetailDrawerProps) {
  const { firebaseUser, effectiveRole, isAdmin, mcxRate, platformSettings, showToast } = useApp();

  const [history, setHistory] = useState<OrderStatusHistoryDoc[]>([]);
  const [purityDocs, setPurityDocs] = useState<PurityDocumentDoc[]>([]);
  const [invoice, setInvoice] = useState<InvoiceDoc | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Purity upload form
  const [certNumber, setCertNumber] = useState('');
  const [assayingLab, setAssayingLab] = useState('Jaipur BIS Approved Assaying & Hallmarking Centre');
  const [testedPurity, setTestedPurity] = useState('999.9 Fine');
  const [grossWeight, setGrossWeight] = useState('');
  const [netWeight, setNetWeight] = useState('');
  const [purityFile, setPurityFile] = useState<File | null>(null);

  // Settlement recording form
  const [settlementMethod, setSettlementMethod] = useState('RTGS / NEFT Bank Transfer');
  const [settlementRef, setSettlementRef] = useState('');

  // Reject/Cancel reason
  const [reasonText, setReasonText] = useState('');
  const [showRejectBox, setShowRejectBox] = useState(false);

  // Verified review form
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  useEffect(() => {
    if (!order) return;
    setGrossWeight(String(order.weightGrams));
    setNetWeight(String(order.weightGrams));
    setTestedPurity(order.purity === '999' ? '999.9 Fine' : '995.0 Fine');
    setError(null);
    setShowRejectBox(false);

    const unsubHist = onSnapshot(
      query(collection(db, 'order_status_history'), where('orderId', '==', order.id)),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<OrderStatusHistoryDoc, 'id'>) }))
          .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
        setHistory(items);
      },
      (err) => console.error('order_status_history listener:', err)
    );

    const unsubPurity = onSnapshot(
      query(collection(db, 'purity_documents'), where('orderId', '==', order.id)),
      (snap) => {
        setPurityDocs(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurityDocumentDoc, 'id'>) }))
        );
      },
      (err) => console.error('purity_documents listener:', err)
    );

    const unsubInv = onSnapshot(
      query(collection(db, 'invoices'), where('orderId', '==', order.id)),
      (snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          setInvoice({ id: d.id, ...(d.data() as Omit<InvoiceDoc, 'id'>) });
        } else {
          setInvoice(null);
        }
      },
      (err) => console.error('invoices listener:', err)
    );

    return () => {
      unsubHist();
      unsubPurity();
      unsubInv();
    };
  }, [order?.id]);

  if (!order) return null;

  const { isFloating, breakdown } = getEffectiveOrderPricing(order, mcxRate);
  const unitLabel = order.metal === 'GOLD' ? '10g' : '1kg';

  const isJewellerActor = firebaseUser?.uid === order.jewellerId;
  const isSupplierActor =
    firebaseUser?.uid === order.supplierOwnerId ||
    (firebaseUser?.uid ? order.assignedStaffUids?.includes(firebaseUser.uid) : false);
  const roleForAction = effectiveRole || 'jeweller';

  const isTerminal = ['Completed', 'Cancelled', 'Rejected'].includes(order.status);
  const currentStepIdx = ORDER_WORKFLOW_STEPS.indexOf(order.status);

  const handleConfirmAndLock = async () => {
    if (!mcxRate) {
      setError('Cannot lock rate while live MCX rate is unavailable and no manual override is set.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmAndLockOrderRate({
        order,
        actorRole: roleForAction,
        platformSettings,
        activeRate: mcxRate,
      });
      showToast('success', `Rate confirmed & locked for ${order.orderNumber}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock rate.');
    } finally {
      setBusy(false);
    }
  };

  const handleUploadPurity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!certNumber.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadPurityCertificate({
        order,
        actorRole: roleForAction,
        certificateNumber: certNumber,
        assayingLab,
        testedPurity,
        grossWeightGrams: Number(grossWeight) || order.weightGrams,
        netWeightGrams: Number(netWeight) || order.weightGrams,
        file: purityFile,
      });
      setCertNumber('');
      setPurityFile(null);
      showToast(
        'success',
        res.storageWarning
          ? 'Purity certificate recorded in Firestore. (Storage bucket note logged.)'
          : 'Purity & assaying certificate uploaded.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload purity certificate.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvanceStatus = async (
    nextStatus:
      | 'Order Approved by Jeweller'
      | 'Payment / Exchange Settled'
      | 'Ready for Pickup / Dispatch'
      | 'Completed',
    note: string
  ) => {
    setBusy(true);
    setError(null);
    try {
      await advanceOrderWorkflow({
        order,
        actorRole: roleForAction,
        nextStatus,
        note,
        settlementMethod:
          nextStatus === 'Payment / Exchange Settled' ? settlementMethod : undefined,
        settlementReference:
          nextStatus === 'Payment / Exchange Settled' ? settlementRef : undefined,
      });
      showToast('success', `Order transitioned to ${nextStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update order status.');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateInvoice = async () => {
    setBusy(true);
    setError(null);
    try {
      const invNum = await generateOrderInvoice(order);
      showToast('success', `GST Tax Invoice ${invNum} generated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate invoice.');
    } finally {
      setBusy(false);
    }
  };

  const handleRejectOrCancel = async () => {
    if (!reasonText.trim()) {
      setError('Please enter a brief reason for rejection or cancellation.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await rejectOrCancelOrder({
        order,
        actorRole: roleForAction,
        targetStatus: isSupplierActor && order.status === 'Quote Requested' ? 'Rejected' : 'Cancelled',
        reason: reasonText,
      });
      setShowRejectBox(false);
      setReasonText('');
      showToast('info', 'Order status updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel/reject order.');
    } finally {
      setBusy(false);
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reviewComment.trim().length < 4) {
      setError('Please enter at least 4 characters for your verified review.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitVerifiedReview({ order, rating, comment: reviewComment });
      setReviewComment('');
      showToast('success', 'Verified review published for supplier.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#141413]/50 backdrop-blur-xs flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-order-title"
    >
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto border-l border-[#E5E3DD] flex flex-col">
        {/* Sticky Drawer Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-[#E5E3DD] px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-[#6F6D67]">{order.orderNumber}</p>
            <h2 id="drawer-order-title" className="text-2xl font-semibold text-[#141413]">
              {order.orderType} · {order.weightGrams}g {order.metal} {order.purity}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order inspector"
            className="p-2 text-[#6F6D67] hover:text-[#141413]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8 flex-1">
          {/* Counterparties & Current Status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pb-6 border-b border-[#E5E3DD] text-xs">
            <div>
              <p className="text-[#6F6D67] mb-1">Jeweller</p>
              <p className="font-semibold text-[#141413] text-sm">{order.jewellerShopName}</p>
            </div>
            <div>
              <p className="text-[#6F6D67] mb-1">Verified Supplier</p>
              <p className="font-semibold text-[#141413] text-sm">{order.supplierName}</p>
            </div>
            <div>
              <p className="text-[#6F6D67] mb-1">Current Status</p>
              <p
                className={`font-semibold text-sm ${
                  order.status === 'Completed'
                    ? 'text-[#15803D]'
                    : order.status === 'Rejected' || order.status === 'Cancelled'
                    ? 'text-[#B91C1C]'
                    : 'text-[#8A641E]'
                }`}
              >
                {order.status}
              </p>
            </div>
          </div>

          {/* Workflow Progress Stepper */}
          <div>
            <h3 className="text-xs font-semibold text-[#5A5852] mb-3">
              Transaction Workflow Progression
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ORDER_WORKFLOW_STEPS.map((step, idx) => {
                const isDone = currentStepIdx >= idx && currentStepIdx !== -1;
                const isCurrent = order.status === step;
                return (
                  <div
                    key={step}
                    className={`px-3 py-2 border text-xs flex items-center gap-2 ${
                      isCurrent
                        ? 'border-[#8A641E] bg-[#FAF6EE] text-[#141413] font-semibold'
                        : isDone
                        ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'
                        : 'border-[#E5E3DD] bg-[#FAFAF8] text-[#6F6D67]'
                    }`}
                  >
                    <span className="font-mono text-[11px]">{String(idx + 1).padStart(2, '0')}</span>
                    <span className="truncate">{step}</span>
                  </div>
                );
              })}
            </div>
            {order.rejectionReason && (
              <div className="mt-3 p-3 bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                <strong>Termination Note:</strong> {order.rejectionReason}
              </div>
            )}
          </div>

          {/* Pricing Breakdown: Floating vs Locked Immutable Snapshot */}
          <div className="border border-[#E5E3DD] bg-[#FAFAF8] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-[#E5E3DD]">
              <div className="flex items-center gap-2 text-xs font-semibold">
                {isFloating ? (
                  <>
                    <LockOpen className="w-4 h-4 text-[#B45309]" />
                    <span className="text-[#B45309]">
                      Floating Price — Auto-updating with Live MCX
                    </span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-[#15803D]" />
                    <span className="text-[#15803D]">
                      Immutable Locked Price Snapshot
                    </span>
                  </>
                )}
              </div>
              {order.rateLockedAt?.toDate && (
                <span className="text-[11px] font-mono text-[#6F6D67] tabular-nums">
                  Locked {order.rateLockedAt.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              )}
            </div>

            <div className="space-y-2 text-xs font-mono tabular-nums">
              <div className="flex justify-between text-[#4B4A45]">
                <span>
                  MCX Base Rate ({formatInr(breakdown.mcxBaseRatePerUnit)} / {unitLabel})
                </span>
                <span>{formatInr(breakdown.baseMetalValueInr)}</span>
              </div>
              <div className="flex justify-between text-[#4B4A45]">
                <span>
                  Supplier Premium ({formatInr(breakdown.supplierPremiumPerUnitInr)} / {unitLabel})
                </span>
                <span>{formatInr(breakdown.supplierPremiumTotalInr)}</span>
              </div>
              <div className="flex justify-between font-medium text-[#141413] pt-1.5 border-t border-[#E5E3DD]">
                <span>Gross Bullion Value (GTV)</span>
                <span>{formatInr(breakdown.grossBullionValueInr)}</span>
              </div>
              <div className="flex justify-between text-[#4B4A45]">
                <span>Platform Commission ({breakdown.platformCommissionRatePct}% fixed)</span>
                <span>{formatInr(breakdown.platformCommissionInr)}</span>
              </div>
              <div className="flex justify-between text-[#4B4A45]">
                <span>GST ({breakdown.gstRatePct}%)</span>
                <span>{formatInr(breakdown.gstAmountInr)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-[#141413] pt-2 border-t border-[#141413]">
                <span>{isFloating ? 'Live Estimated Total' : 'Final Locked Payable Total'}</span>
                <span>{formatInr(breakdown.finalPayableTotalInr)}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
              {error}
            </div>
          )}

          {/* Contextual Role Action Panel */}
          {!isTerminal && (
            <div className="border border-[#E5E3DD] p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[#141413]">Next Action Required</h3>

              {/* Step 1 -> 2: Supplier confirms & locks live MCX rate */}
              {order.status === 'Quote Requested' && (isSupplierActor || isAdmin) && (
                <div className="space-y-3">
                  <p className="text-xs text-[#5A5852]">
                    Clicking <strong>Confirm &amp; Lock Rate</strong> captures the server-verified
                    live MCX rate right now, locks base + supplier premium +{' '}
                    {order.platformCommissionRatePct}% platform commission into an immutable
                    snapshot, and records a pending settlement entry.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy || !mcxRate}
                      onClick={handleConfirmAndLock}
                      className="px-4 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      <Lock className="w-3.5 h-3.5 text-[#C99D44]" />
                      {busy ? 'Locking Live MCX Rate...' : 'Confirm & Lock Live MCX Rate'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setShowRejectBox((v) => !v)}
                      className="px-4 py-2.5 border border-[#FECACA] text-[#B91C1C] text-xs font-medium hover:bg-[#FEF2F2]"
                    >
                      Reject Quote
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2 -> 3: Supplier uploads purity / assaying certificate */}
              {order.status === 'Quote Confirmed & Rate Locked' && (isSupplierActor || isAdmin) && (
                <form onSubmit={handleUploadPurity} className="space-y-3">
                  <p className="text-xs text-[#5A5852]">
                    Attach BIS / XRF purity &amp; assaying documentation for jeweller verification.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#4B4A45] mb-1">
                        Certificate Number
                      </label>
                      <input
                        type="text"
                        required
                        value={certNumber}
                        onChange={(e) => setCertNumber(e.target.value)}
                        placeholder="e.g. BIS-JPR-99812"
                        className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#4B4A45] mb-1">
                        Tested Purity Reading
                      </label>
                      <input
                        type="text"
                        required
                        value={testedPurity}
                        onChange={(e) => setTestedPurity(e.target.value)}
                        placeholder="999.9 Fine"
                        className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[#4B4A45] mb-1">
                        Assaying Lab / Hallmarking Centre
                      </label>
                      <input
                        type="text"
                        required
                        value={assayingLab}
                        onChange={(e) => setAssayingLab(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#4B4A45] mb-1">
                        Gross Weight (g)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={grossWeight}
                        onChange={(e) => setGrossWeight(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono border border-[#D4D1C8]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#4B4A45] mb-1">
                        Net Fine Weight (g)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={netWeight}
                        onChange={(e) => setNetWeight(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono border border-[#D4D1C8]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-medium text-[#4B4A45] mb-1">
                        Certificate PDF / Image (Optional Upload to Firebase Storage)
                      </label>
                      <input
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(e) => setPurityFile(e.target.files?.[0] || null)}
                        className="w-full text-xs text-[#4B4A45]"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#C99D44]" />
                    {busy ? 'Uploading...' : 'Upload Purity Certificate & Advance'}
                  </button>
                </form>
              )}

              {/* Step 3 -> 4: Jeweller approves locked rate & purity docs */}
              {order.status === 'Purity & Docs Uploaded' && (isJewellerActor || isAdmin) && (
                <div className="space-y-3">
                  <p className="text-xs text-[#5A5852]">
                    Review the locked MCX price snapshot and attached purity/assaying certificate
                    below before approving this order for settlement.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handleAdvanceStatus(
                        'Order Approved by Jeweller',
                        'Jeweller reviewed and approved locked MCX rate and assaying purity documentation.'
                      )
                    }
                    className="px-4 py-2.5 bg-[#15803D] text-white text-xs font-medium hover:bg-[#166534] disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve Locked Rate &amp; Purity Docs
                  </button>
                </div>
              )}

              {/* Step 4 -> 5: Manual Payment / Exchange Settlement recording */}
              {order.status === 'Order Approved by Jeweller' &&
                (isJewellerActor || isSupplierActor || isAdmin) && (
                  <div className="space-y-3">
                    <p className="text-xs text-[#5A5852]">
                      Record offline B2B bank transfer (RTGS/NEFT) or physical bullion exchange
                      settlement reference. Online automated payment gateways are intentionally
                      excluded for MVP compliance.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select
                        value={settlementMethod}
                        onChange={(e) => setSettlementMethod(e.target.value)}
                        className="px-3 py-2 text-xs border border-[#D4D1C8] bg-white"
                      >
                        <option value="RTGS / NEFT Bank Transfer">RTGS / NEFT Bank Transfer</option>
                        <option value="Bullion Metal-to-Metal Exchange">
                          Bullion Metal-to-Metal Exchange
                        </option>
                        <option value="Verified Cheque / DD">Verified Cheque / DD</option>
                      </select>
                      <input
                        type="text"
                        value={settlementRef}
                        onChange={(e) => setSettlementRef(e.target.value)}
                        placeholder="UTR / Exchange Voucher Reference #"
                        className="px-3 py-2 text-xs font-mono border border-[#D4D1C8]"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={busy || !settlementRef.trim()}
                      onClick={() =>
                        handleAdvanceStatus(
                          'Payment / Exchange Settled',
                          `Settlement recorded via ${settlementMethod} (Ref: ${settlementRef.trim()}).`
                        )
                      }
                      className="px-4 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] disabled:opacity-50"
                    >
                      Record Payment / Exchange Settled
                    </button>
                  </div>
                )}

              {/* Step 5 -> 6 -> 7: Supplier marks Ready for Pickup & Completed */}
              {order.status === 'Payment / Exchange Settled' && (isSupplierActor || isAdmin) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    handleAdvanceStatus(
                      'Ready for Pickup / Dispatch',
                      `Bullion sealed and ready for handover at ${order.deliveryCenter}.`
                    )
                  }
                  className="px-4 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] disabled:opacity-50"
                >
                  Mark Ready for Pickup / Dispatch
                </button>
              )}

              {order.status === 'Ready for Pickup / Dispatch' && (isSupplierActor || isAdmin) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    handleAdvanceStatus(
                      'Completed',
                      'Bullion handed over and verified by jeweller desk. Order completed.'
                    )
                  }
                  className="px-4 py-2.5 bg-[#15803D] text-white text-xs font-medium hover:bg-[#166534] disabled:opacity-50"
                >
                  Mark Order Completed
                </button>
              )}

              {/* Jeweller Cancel option prior to settlement */}
              {isJewellerActor &&
                ['Quote Requested', 'Quote Confirmed & Rate Locked', 'Purity & Docs Uploaded'].includes(
                  order.status
                ) && (
                  <div className="pt-2 border-t border-[#E5E3DD]">
                    <button
                      type="button"
                      onClick={() => setShowRejectBox((v) => !v)}
                      className="text-xs text-[#B91C1C] hover:underline"
                    >
                      Cancel this order
                    </button>
                  </div>
                )}

              {showRejectBox && (
                <div className="space-y-2 pt-2 border-t border-[#E5E3DD]">
                  <input
                    type="text"
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    placeholder="Enter reason for cancellation or rejection..."
                    className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRejectOrCancel}
                    className="px-4 py-2 bg-[#B91C1C] text-white text-xs font-medium hover:bg-[#991B1B]"
                  >
                    Confirm Cancellation / Rejection
                  </button>
                </div>
              )}

              {/* Waiting state message when it's the other party's turn */}
              {order.status === 'Quote Requested' && isJewellerActor && (
                <p className="text-xs text-[#5A5852]">
                  Waiting for <strong>{order.supplierName}</strong> to confirm and lock the live
                  MCX rate.
                </p>
              )}
              {order.status === 'Quote Confirmed & Rate Locked' && isJewellerActor && (
                <p className="text-xs text-[#5A5852]">
                  Rate is locked. Waiting for supplier to upload BIS/XRF purity certificate.
                </p>
              )}
              {order.status === 'Purity & Docs Uploaded' && isSupplierActor && (
                <p className="text-xs text-[#5A5852]">
                  Purity certificate uploaded. Waiting for jeweller to review and approve.
                </p>
              )}
            </div>
          )}

          {/* Purity Certificates & GST Tax Invoice */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-[#E5E3DD] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#141413]">
                <FileCheck2 className="w-4 h-4 text-[#8A641E]" />
                Purity &amp; Assaying Certificates ({purityDocs.length})
              </div>
              {purityDocs.length === 0 ? (
                <p className="text-xs text-[#6F6D67]">No purity certificate uploaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {purityDocs.map((d) => (
                    <div key={d.id} className="bg-[#FAFAF8] border border-[#E5E3DD] p-3 text-xs">
                      <div className="font-mono font-semibold text-[#141413]">
                        #{d.certificateNumber} · {d.testedPurity}
                      </div>
                      <div className="text-[#5A5852] mt-0.5">{d.assayingLab}</div>
                      <div className="font-mono text-[11px] text-[#6F6D67] mt-1">
                        Gross {d.grossWeightGrams}g · Net {d.netWeightGrams}g
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadPuritySummary(d)}
                        className="mt-2 inline-flex items-center gap-1.5 text-[#8A641E] font-medium hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Certificate
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border border-[#E5E3DD] p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#141413]">
                <Receipt className="w-4 h-4 text-[#8A641E]" />
                GST Tax Invoice
              </div>
              {invoice ? (
                <div className="bg-[#FAFAF8] border border-[#E5E3DD] p-3 text-xs space-y-1">
                  <div className="font-mono font-semibold text-[#141413]">
                    {invoice.invoiceNumber}
                  </div>
                  <div className="font-mono text-[#4B4A45]">
                    Payable: {formatInr(invoice.finalPayableTotalInr)}
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadGstInvoiceHtml(invoice)}
                    className="mt-2 inline-flex items-center gap-1.5 text-[#8A641E] font-medium hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download GST Tax Invoice
                  </button>
                </div>
              ) : order.isRateLocked && (isSupplierActor || isAdmin) ? (
                <div className="space-y-2">
                  <p className="text-xs text-[#6F6D67]">
                    Rate is locked. Issue a unique GST invoice (duplicate generation prevented).
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGenerateInvoice}
                    className="px-3.5 py-2 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28]"
                  >
                    Generate Tax Invoice
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[#6F6D67]">
                  Invoice becomes available once supplier confirms &amp; locks the rate.
                </p>
              )}
            </div>
          </div>

          {/* Verified Review (Strictly after Completed order) */}
          {order.status === 'Completed' && isJewellerActor && !order.hasReview && (
            <form onSubmit={handleReviewSubmit} className="border border-[#E5E3DD] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[#141413]">
                Submit Verified Supplier Review
              </h3>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`p-1 ${star <= rating ? 'text-[#C99D44]' : 'text-[#D4D1C8]'}`}
                    aria-label={`Rate ${star} stars`}
                  >
                    <Star className="w-5 h-5 fill-current" />
                  </button>
                ))}
                <span className="text-xs font-mono text-[#5A5852]">{rating}/5</span>
              </div>
              <textarea
                rows={2}
                required
                minLength={4}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Share purity accuracy, turnaround time, and Jaipur desk delivery experience..."
                className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
              />
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 bg-[#8A641E] text-white text-xs font-medium hover:bg-[#745318]"
              >
                Publish Verified Review
              </button>
            </form>
          )}

          {/* Immutable Status History */}
          <div>
            <h3 className="text-xs font-semibold text-[#5A5852] mb-3">
              Immutable Status Audit History ({history.length})
            </h3>
            <div className="space-y-2.5">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="border-b border-[#E5E3DD] pb-2.5 text-xs flex flex-col gap-0.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#141413]">
                      {h.fromStatus} → {h.toStatus}
                    </span>
                    <span className="font-mono text-[11px] text-[#6F6D67] tabular-nums">
                      {h.createdAt?.toDate
                        ? h.createdAt.toDate().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                        : 'Pending'}
                    </span>
                  </div>
                  <p className="text-[#4B4A45]">{h.note}</p>
                  <span className="text-[11px] text-[#6F6D67]">Actor role: {h.changedByRole}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
