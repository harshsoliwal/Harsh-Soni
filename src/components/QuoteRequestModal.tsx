import React, { useMemo, useState } from 'react';
import { LockOpen, ShieldCheck, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { submitQuoteRequest } from '../lib/firestoreService';
import { calculateBullionPricing, formatInr, getMcxRatePerUnit } from '../lib/pricing';
import type { BullionListingDoc, OrderType } from '../types/bullion';

interface QuoteRequestModalProps {
  listing: BullionListingDoc | null;
  jewellerShopName: string;
  onClose: () => void;
  onSuccess: (orderId: string) => void;
}

export function QuoteRequestModal({
  listing,
  jewellerShopName,
  onClose,
  onSuccess,
}: QuoteRequestModalProps) {
  const { firebaseUser, mcxRate, platformSettings, showToast } = useApp();

  const availableTypes = useMemo(() => {
    if (!listing) return ['BUY'] as OrderType[];
    const list: OrderType[] = [];
    if (listing.supportsBuy) list.push('BUY');
    if (listing.supportsSell) list.push('SELL');
    if (listing.supportsExchange) list.push('EXCHANGE');
    return list.length ? list : (['BUY'] as OrderType[]);
  }, [listing]);

  const [orderType, setOrderType] = useState<OrderType>(availableTypes[0] || 'BUY');
  const [weightGrams, setWeightGrams] = useState<number>(listing?.minWeightGrams || 10);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Unique key per modal mount prevents duplicate submissions on rapid double-clicks
  const [idempotencyKey] = useState(
    () => `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
  );

  if (!listing) return null;

  const baseRatePerUnit = mcxRate
    ? getMcxRatePerUnit(mcxRate, listing.metal, listing.purity)
    : 0;

  const breakdown = mcxRate
    ? calculateBullionPricing({
        metal: listing.metal,
        purity: listing.purity,
        weightGrams,
        mcxBaseRatePerUnit: baseRatePerUnit,
        supplierPremiumPerUnitInr: listing.premiumPerUnitInr,
        platformCommissionRatePct: platformSettings.commissionRatePct,
        gstRatePct: platformSettings.gstRatePct,
      })
    : null;

  const unitLabel = listing.metal === 'GOLD' ? '10g' : '1kg';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      setError('Please sign in with a verified Jeweller account to submit a quote request.');
      return;
    }
    if (!firebaseUser.emailVerified) {
      setError('Please verify your email address before submitting quotes.');
      return;
    }
    if (!mcxRate) {
      setError(
        'Live MCX reference rate is currently unavailable. Please wait for feed recovery or Admin override.'
      );
      return;
    }
    if (weightGrams < listing.minWeightGrams || weightGrams > listing.maxWeightGrams) {
      setError(
        `Weight must be between ${listing.minWeightGrams}g and ${listing.maxWeightGrams}g for this listing.`
      );
      return;
    }
    if (weightGrams > listing.availableStockGrams) {
      setError(`Requested weight exceeds supplier's available stock (${listing.availableStockGrams}g).`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const orderId = await submitQuoteRequest({
        idempotencyKey,
        jewellerUid: firebaseUser.uid,
        jewellerShopName:
          jewellerShopName || firebaseUser.displayName || firebaseUser.email || 'Jaipur Jeweller',
        listing,
        orderType,
        weightGrams,
        liveRate: mcxRate,
        platformSettings,
        notes,
      });
      showToast('success', 'Quote request submitted. Price floats live until supplier locks rate.');
      onSuccess(orderId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quote request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#141413]/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quote-modal-title"
    >
      <div className="bg-white border border-[#E5E3DD] max-w-xl w-full max-h-[92vh] overflow-y-auto p-6 sm:p-8 relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close quote modal"
          className="absolute top-5 right-5 text-[#6F6D67] hover:text-[#141413] p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <p className="text-xs text-[#6F6D67] mb-1">
            {listing.supplierName} · {listing.jaipurLocality}
          </p>
          <h2 id="quote-modal-title" className="text-2xl sm:text-3xl font-semibold text-[#141413]">
            Request Bullion Quote
          </h2>
          <p className="text-xs text-[#5A5852] mt-1">
            {listing.title} · {listing.metal} {listing.purity} ({listing.form})
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-[#4B4A45] mb-2">
              Transaction Type
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-[#F3F1EC]">
              {(['BUY', 'SELL', 'EXCHANGE'] as OrderType[]).map((type) => {
                const supported = availableTypes.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    disabled={!supported}
                    onClick={() => setOrderType(type)}
                    className={`py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                      orderType === type
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#5A5852] hover:text-[#141413]'
                    } ${!supported ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {type === 'BUY' ? 'Buy Bullion' : type === 'SELL' ? 'Sell Bullion' : 'Exchange'}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4A45] mb-1.5">
                Quantity Weight (grams)
              </label>
              <input
                type="number"
                step="0.5"
                min={listing.minWeightGrams}
                max={Math.min(listing.maxWeightGrams, listing.availableStockGrams)}
                required
                value={weightGrams}
                onChange={(e) => setWeightGrams(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
              />
              <p className="text-[11px] text-[#6F6D67] mt-1 font-mono tabular-nums">
                Range: {listing.minWeightGrams}g – {listing.maxWeightGrams}g · Stock:{' '}
                {listing.availableStockGrams}g
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4A45] mb-1.5">
                Jaipur Delivery / Pickup Desk
              </label>
              <div className="px-3.5 py-2.5 text-sm border border-[#E5E3DD] bg-[#FAFAF8] text-[#4B4A45]">
                {listing.deliveryCenter}
              </div>
            </div>
          </div>

          {breakdown ? (
            <div className="bg-[#FAFAF8] border border-[#E5E3DD] p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-[#E5E3DD]">
                <span className="inline-flex items-center gap-1.5 font-medium text-[#8A641E]">
                  <LockOpen className="w-3.5 h-3.5" />
                  Dynamic Floating Estimate (Locks on Supplier Confirmation)
                </span>
                <span className="font-mono text-[#6F6D67] tabular-nums">
                  {mcxRate?.isDelayed ? 'Delayed/Manual Ref' : 'Live MCX'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs font-mono tabular-nums">
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
                <div className="flex justify-between text-[#141413] font-medium pt-1 border-t border-[#E5E3DD]">
                  <span>Gross Bullion Value (GTV)</span>
                  <span>{formatInr(breakdown.grossBullionValueInr)}</span>
                </div>
                <div className="flex justify-between text-[#4B4A45]">
                  <span>BullionBridge Commission ({breakdown.platformCommissionRatePct}%)</span>
                  <span>{formatInr(breakdown.platformCommissionInr)}</span>
                </div>
                <div className="flex justify-between text-[#4B4A45]">
                  <span>Applicable GST ({breakdown.gstRatePct}%)</span>
                  <span>{formatInr(breakdown.gstAmountInr)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold text-[#141413] pt-2 border-t border-[#141413]">
                  <span>Live Estimated Total</span>
                  <span>{formatInr(breakdown.finalPayableTotalInr)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E]">
              Live MCX rate is unavailable. Quote submission is paused until verified rates are
              restored.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#4B4A45] mb-1.5">
              Trade Desk Instructions (Optional)
            </label>
            <textarea
              rows={2}
              maxLength={450}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Preferred assaying lab, bar denomination, or exchange metal purity details..."
              className="w-full px-3.5 py-2 text-sm border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
            />
          </div>

          {error && (
            <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-[#4B4A45] border border-[#D4D1C8] hover:bg-[#F3F1EC] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !breakdown}
              className="px-5 py-2.5 text-sm font-medium bg-[#141413] text-white hover:bg-[#2A2A28] transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              <ShieldCheck className="w-4 h-4 text-[#C99D44]" />
              {submitting ? 'Submitting Quote...' : 'Submit Quote Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
