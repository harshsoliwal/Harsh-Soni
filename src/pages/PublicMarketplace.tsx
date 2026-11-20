import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  HelpCircle,
  Lock,
  MapPin,
  Search,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  calculateBullionPricing,
  formatInr,
  getMcxRatePerUnit,
} from '../lib/pricing';
import {
  JAIPUR_LOCALITIES,
  type BullionListingDoc,
  type MetalType,
  type PurityGrade,
} from '../types/bullion';

interface PublicMarketplaceProps {
  onOpenAuth: (mode: 'signin' | 'signup', role?: 'jeweller' | 'supplier') => void;
  onRequestQuote: (listing: BullionListingDoc) => void;
  onGoToWorkspace: () => void;
}

const FAQS = [
  {
    q: 'How does BullionBridge determine live MCX-linked pricing?',
    a: 'Our server-side rate endpoint fetches live public Gold and Silver commodity benchmarks and USD/INR exchange parity with a 45-second cache TTL, displaying the exact IST timestamp. If upstream feeds are ever delayed, we never fabricate prices — we display the last cached rate or Super Admin reference with a clear Delayed / Manual indicator.',
  },
  {
    q: 'When is the bullion rate locked on my quote?',
    a: 'While a quote is in "Quote Requested" status, the estimated total floats dynamically with the latest MCX rate. At the exact moment the verified supplier clicks Confirm & Lock, the server captures the live MCX base rate, locks the supplier premium and 1.25% platform commission, and writes an immutable price snapshot to Firestore.',
  },
  {
    q: 'Who can list bullion on BullionBridge Jaipur?',
    a: 'Only verified bullion dealers, wholesalers, and refiners operating in Jaipur who submit valid GSTIN, BIS/assaying credentials, and office/delivery centre verification — and receive explicit Super Admin approval — appear publicly in the marketplace.',
  },
  {
    q: 'Does BullionBridge process online payments or automated courier logistics?',
    a: 'For our Jaipur MVP, settlements are recorded manually via RTGS/NEFT or verified metal-to-metal exchange at approved Jaipur delivery centres (Johari Bazaar, MI Road, Sitapura SEZ). Every transaction includes mandatory assaying documentation and a GST Tax Invoice.',
  },
];

export function PublicMarketplace({
  onOpenAuth,
  onRequestQuote,
  onGoToWorkspace,
}: PublicMarketplaceProps) {
  const {
    firebaseUser,
    mcxRate,
    platformSettings,
    approvedSuppliers,
    publicListings,
    publicReviews,
  } = useApp();

  // Marketplace Filters
  const [metalFilter, setMetalFilter] = useState<'ALL' | MetalType>('ALL');
  const [purityFilter, setPurityFilter] = useState<'ALL' | PurityGrade>('ALL');
  const [localityFilter, setLocalityFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [compareWeightGrams, setCompareWeightGrams] = useState<number>(100);

  // Transparent Pricing Calculator state
  const [calcMetal, setCalcMetal] = useState<MetalType>('GOLD');
  const [calcPurity, setCalcPurity] = useState<PurityGrade>('999');
  const [calcWeight, setCalcWeight] = useState<number>(100);
  const [calcPremium, setCalcPremium] = useState<number>(350);

  // FAQ accordion
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const filteredListings = useMemo(() => {
    return publicListings.filter((item) => {
      if (metalFilter !== 'ALL' && item.metal !== metalFilter) return false;
      if (purityFilter !== 'ALL' && item.purity !== purityFilter) return false;
      if (localityFilter !== 'ALL' && item.jaipurLocality !== localityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hit =
          item.title.toLowerCase().includes(q) ||
          item.supplierName.toLowerCase().includes(q) ||
          item.jaipurLocality.toLowerCase().includes(q) ||
          item.form.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [publicListings, metalFilter, purityFilter, localityFilter, searchQuery]);

  const supplierRatingsMap = useMemo(() => {
    const map = new Map<string, { avg: number; count: number }>();
    for (const r of publicReviews) {
      const cur = map.get(r.supplierId) || { avg: 0, count: 0 };
      const total = cur.avg * cur.count + r.rating;
      const count = cur.count + 1;
      map.set(r.supplierId, { avg: total / count, count });
    }
    return map;
  }, [publicReviews]);

  const calcBaseRate = mcxRate
    ? getMcxRatePerUnit(mcxRate, calcMetal, calcPurity)
    : 0;

  const calcBreakdown = mcxRate
    ? calculateBullionPricing({
        metal: calcMetal,
        purity: calcPurity,
        weightGrams: calcWeight,
        mcxBaseRatePerUnit: calcBaseRate,
        supplierPremiumPerUnitInr: calcPremium,
        platformCommissionRatePct: platformSettings.commissionRatePct,
        gstRatePct: platformSettings.gstRatePct,
      })
    : null;

  return (
    <div className="bg-[#FAFAF8] text-[#141413]">
      {/* 1. EDITORIAL HERO SPLIT (items-stretch, balanced height) */}
      <section className="border-b border-[#E5E3DD] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-between py-2">
            <div>
              <p className="text-xs font-medium text-[#8A641E] mb-4">
                Jaipur Jewellery Cluster · Johari Bazaar · MI Road · Sitapura SEZ
              </p>
              <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.08] tracking-tight text-[#141413] [text-wrap:balance] mb-6">
                Verified Bullion. Live MCX-Linked Pricing. Trusted Transactions.
              </h1>
              <p className="text-base text-[#4B4A45] leading-relaxed max-w-xl mb-8">
                BullionBridge connects Jaipur’s retail and wholesale jewellers directly with
                BIS-credentialed gold and silver suppliers. Compare transparent premiums over live
                MCX benchmarks, lock rates on supplier confirmation, and archive every purity
                certificate and GST invoice.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                {firebaseUser ? (
                  <button
                    type="button"
                    onClick={onGoToWorkspace}
                    className="px-6 py-3 bg-[#141413] text-white text-sm font-medium hover:bg-[#2A2A28] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    Open My Trading Desk
                    <ArrowRight className="w-4 h-4 text-[#C99D44]" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenAuth('signup', 'jeweller')}
                    className="px-6 py-3 bg-[#141413] text-white text-sm font-medium hover:bg-[#2A2A28] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    Start Sourcing Bullion
                    <ArrowRight className="w-4 h-4 text-[#C99D44]" />
                  </button>
                )}
                <a
                  href="#marketplace"
                  className="px-5 py-3 border border-[#D4D1C8] text-[#141413] text-sm font-medium hover:bg-[#F3F1EC] transition-colors whitespace-nowrap"
                >
                  Compare Live Rates
                </a>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 pt-10 mt-10 border-t border-[#E5E3DD]">
              <div>
                <p className="text-xs text-[#6F6D67] mb-1">Platform Commission</p>
                <p className="text-lg font-mono font-semibold text-[#141413] tabular-nums">
                  {platformSettings.commissionRatePct}% Flat
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6F6D67] mb-1">Verified Suppliers</p>
                <p className="text-lg font-mono font-semibold text-[#141413] tabular-nums">
                  {approvedSuppliers.length} Active
                </p>
              </div>
              <div>
                <p className="text-xs text-[#6F6D67] mb-1">Purity Standard</p>
                <p className="text-lg font-mono font-semibold text-[#141413] tabular-nums">
                  999 / 995 BIS
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 relative min-h-[340px] lg:min-h-full overflow-hidden bg-[#111318] border border-[#E5E3DD]">
            <img
              src="/src/assets/images/hero_bullion_bars_1795167901716.jpg"
              alt="Hallmarked 999.9 fine gold bullion bars and pure silver ingots in a Jaipur bullion treasury vault"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-6 text-white">
              <p className="text-xs text-[#E3C27A] font-medium mb-1">
                Dynamic-Until-Confirmed Execution
              </p>
              <p className="text-sm text-white/90 leading-relaxed max-w-md">
                Quotes stay linked to live MCX benchmarks until your supplier locks the exact rate
                and attaches BIS/XRF assaying certification.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. LIVE MARKETPLACE & FILTER DIRECTORY */}
      <section id="marketplace" className="max-w-[1360px] mx-auto px-4 sm:px-6 py-16">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <p className="text-xs font-medium text-[#8A641E] mb-1.5">
              Live Jaipur Bullion Board
            </p>
            <h2 className="text-3xl sm:text-4xl font-semibold text-[#141413]">
              Compare Verified Bullion Listings
            </h2>
          </div>
          <p className="text-xs text-[#5A5852] max-w-md">
            Every total below is computed transparently: MCX Base + Supplier Premium +{' '}
            {platformSettings.commissionRatePct}% Platform Commission + {platformSettings.gstRatePct}%
            GST.
          </p>
        </div>

        {/* Filter Bar */}
        <div className="bg-white border border-[#E5E3DD] p-4 mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3">
            <label className="block text-[11px] font-medium text-[#5A5852] mb-1">
              Search Supplier or Product
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#6F6D67] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Gold bar, silver ingot, Johari..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
              />
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#5A5852] mb-1">Metal</label>
            <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#F3F1EC]">
              {(['ALL', 'GOLD', 'SILVER'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMetalFilter(m);
                    if (m === 'SILVER' && compareWeightGrams < 500) setCompareWeightGrams(1000);
                    if (m === 'GOLD' && compareWeightGrams >= 500) setCompareWeightGrams(100);
                  }}
                  className={`py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    metalFilter === m ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5A5852]'
                  }`}
                >
                  {m === 'ALL' ? 'All' : m === 'GOLD' ? 'Gold' : 'Silver'}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#5A5852] mb-1">Purity</label>
            <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#F3F1EC]">
              {(['ALL', '999', '995'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPurityFilter(p)}
                  className={`py-1.5 text-xs font-medium font-mono transition-colors whitespace-nowrap ${
                    purityFilter === p ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5A5852]'
                  }`}
                >
                  {p === 'ALL' ? 'All' : p}
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3">
            <label className="block text-[11px] font-medium text-[#5A5852] mb-1">
              Jaipur Commercial Cluster
            </label>
            <select
              value={localityFilter}
              onChange={(e) => setLocalityFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
            >
              <option value="ALL">All Jaipur Localities</option>
              {JAIPUR_LOCALITIES.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#5A5852] mb-1">
              Compare Qty (grams)
            </label>
            <input
              type="number"
              min={1}
              step={10}
              value={compareWeightGrams}
              onChange={(e) => setCompareWeightGrams(Math.max(1, Number(e.target.value)))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
            />
          </div>
        </div>

        {/* Listings Grid */}
        {filteredListings.length === 0 ? (
          <div className="bg-white border border-[#E5E3DD] p-12 text-center">
            <Building2 className="w-8 h-8 text-[#8A641E] mx-auto mb-3" />
            <h3 className="text-xl font-semibold text-[#141413] mb-2">
              {publicListings.length === 0
                ? 'No Approved Bullion Listings Published Yet'
                : 'No Listings Match Your Selected Filters'}
            </h3>
            <p className="text-sm text-[#5A5852] max-w-lg mx-auto mb-6">
              {publicListings.length === 0
                ? 'BullionBridge strictly displays live inventory from real, Super Admin-approved Jaipur bullion suppliers — never fake or fabricated listings. Sign in as a Supplier to submit verification credentials, or as Super Admin to approve onboarding.'
                : 'Try adjusting your metal, purity, or Jaipur locality filters to see all verified supplier quotes.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {publicListings.length === 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    firebaseUser ? onGoToWorkspace() : onOpenAuth('signup', 'supplier')
                  }
                  className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28]"
                >
                  {firebaseUser ? 'Open Workspace Dashboard' : 'Onboard as Verified Supplier'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMetalFilter('ALL');
                    setPurityFilter('ALL');
                    setLocalityFilter('ALL');
                    setSearchQuery('');
                  }}
                  className="px-5 py-2.5 border border-[#D4D1C8] text-xs font-medium text-[#141413] hover:bg-[#F3F1EC]"
                >
                  Reset Filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredListings.map((listing) => {
              const effectiveWeight = Math.min(
                listing.maxWeightGrams,
                Math.max(listing.minWeightGrams, compareWeightGrams)
              );
              const basePerUnit = mcxRate
                ? getMcxRatePerUnit(mcxRate, listing.metal, listing.purity)
                : 0;
              const breakdown = mcxRate
                ? calculateBullionPricing({
                    metal: listing.metal,
                    purity: listing.purity,
                    weightGrams: effectiveWeight,
                    mcxBaseRatePerUnit: basePerUnit,
                    supplierPremiumPerUnitInr: listing.premiumPerUnitInr,
                    platformCommissionRatePct: platformSettings.commissionRatePct,
                    gstRatePct: platformSettings.gstRatePct,
                  })
                : null;
              const unitLabel = listing.metal === 'GOLD' ? '10g' : '1kg';
              const imgPath =
                listing.metal === 'GOLD'
                  ? '/src/assets/images/gold_bar_999_1795167901960.jpg'
                  : '/src/assets/images/silver_ingot_999_1795167899982.jpg';

              return (
                <article
                  key={listing.id}
                  className="bg-white border border-[#E5E3DD] flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5"
                >
                  <div>
                    <div className="aspect-[4/3] bg-[#141413] overflow-hidden relative">
                      <img
                        src={imgPath}
                        alt={`${listing.title} — ${listing.metal} ${listing.purity}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-5">
                      <div className="flex items-center gap-2 text-xs text-[#6F6D67] mb-1.5">
                        <span>{listing.metal}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{listing.purity} Fine</span>
                        <span aria-hidden="true">·</span>
                        <span>{listing.form}</span>
                      </div>
                      <h3 className="text-lg font-semibold text-[#141413] mb-1">{listing.title}</h3>
                      <p className="text-xs text-[#5A5852] flex items-center gap-1.5 mb-4">
                        <MapPin className="w-3.5 h-3.5 text-[#8A641E] shrink-0" />
                        <span className="truncate">
                          {listing.supplierName} · {listing.jaipurLocality}
                        </span>
                      </p>

                      {breakdown ? (
                        <div className="border-t border-[#E5E3DD] pt-3 space-y-1.5 text-xs font-mono tabular-nums">
                          <div className="flex justify-between text-[#5A5852]">
                            <span>MCX Base / {unitLabel}</span>
                            <span>{formatInr(breakdown.mcxBaseRatePerUnit)}</span>
                          </div>
                          <div className="flex justify-between text-[#5A5852]">
                            <span>Supplier Premium / {unitLabel}</span>
                            <span>+{formatInr(listing.premiumPerUnitInr)}</span>
                          </div>
                          <div className="flex justify-between text-[#5A5852]">
                            <span>Commission ({platformSettings.commissionRatePct}%)</span>
                            <span>{formatInr(breakdown.platformCommissionInr)}</span>
                          </div>
                          <div className="flex justify-between text-sm font-semibold text-[#141413] pt-2 border-t border-[#E5E3DD]">
                            <span>Est. Total ({effectiveWeight}g)</span>
                            <span>{formatInr(breakdown.finalPayableTotalInr)}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[#B45309] pt-3 border-t border-[#E5E3DD]">
                          Awaiting live MCX reference rate
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="px-5 pb-5 pt-2 flex items-center justify-between gap-3">
                    <span className="text-[11px] font-mono text-[#6F6D67] tabular-nums">
                      Stock: {listing.availableStockGrams}g
                    </span>
                    <button
                      type="button"
                      onClick={() => onRequestQuote(listing)}
                      className="px-4 py-2 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] transition-colors whitespace-nowrap"
                    >
                      Request Quote
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. FEATURED VERIFIED JAIPUR SUPPLIERS */}
      <section id="suppliers" className="border-y border-[#E5E3DD] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-16">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
            <div>
              <p className="text-xs font-medium text-[#8A641E] mb-1.5">
                Approved Counterparties Only
              </p>
              <h2 className="text-3xl sm:text-4xl font-semibold text-[#141413]">
                Verified Jaipur Bullion Suppliers
              </h2>
            </div>
            <button
              type="button"
              onClick={() =>
                firebaseUser ? onGoToWorkspace() : onOpenAuth('signup', 'supplier')
              }
              className="text-xs font-semibold text-[#8A641E] hover:underline whitespace-nowrap"
            >
              Apply for Supplier Verification →
            </button>
          </div>

          {approvedSuppliers.length === 0 ? (
            <div className="border border-[#E5E3DD] bg-[#FAFAF8] p-8 text-sm text-[#5A5852]">
              No suppliers have been approved yet. Suppliers registered via the Bullion Supplier
              Partner Dashboard appear here automatically upon Super Admin verification.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {approvedSuppliers.map((sup) => {
                const stats = supplierRatingsMap.get(sup.id);
                return (
                  <div key={sup.id} className="border border-[#E5E3DD] bg-[#FAFAF8] p-6 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs text-[#6F6D67]">{sup.jaipurLocality}</p>
                        <h3 className="text-lg font-semibold text-[#141413] mt-0.5">
                          {sup.businessName}
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#15803D] shrink-0">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified
                      </span>
                    </div>
                    <div className="text-xs text-[#4B4A45] space-y-1">
                      <p>
                        <span className="text-[#6F6D67]">GSTIN:</span>{' '}
                        <span className="font-mono">{sup.gstin}</span>
                      </p>
                      <p>
                        <span className="text-[#6F6D67]">BIS / Assaying:</span>{' '}
                        <span className="font-mono">{sup.bisLicenseNumber}</span>
                      </p>
                      <p>
                        <span className="text-[#6F6D67]">Delivery Desk:</span> {sup.deliveryCenter}
                      </p>
                    </div>
                    <div className="pt-3 border-t border-[#E5E3DD] flex items-center justify-between text-xs text-[#5A5852]">
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Star className="w-3.5 h-3.5 text-[#C99D44] fill-current" />
                        {stats ? `${stats.avg.toFixed(1)} (${stats.count} reviews)` : 'New Partner'}
                      </span>
                      <span>Jaipur Verified</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 4. TRANSPARENT PRICING BREAKDOWN & HOW IT WORKS */}
      <section id="how-it-works" className="max-w-[1360px] mx-auto px-4 sm:px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Interactive Pricing Breakdown Calculator */}
          <div className="lg:col-span-6 bg-white border border-[#E5E3DD] p-6 sm:p-8">
            <p className="text-xs font-medium text-[#8A641E] mb-1">Zero Hidden Spreads</p>
            <h2 className="text-3xl font-semibold text-[#141413] mb-3">
              Transparent Pricing Breakdown
            </h2>
            <p className="text-xs text-[#5A5852] mb-6 leading-relaxed">
              Test our exact MCX-linked pricing engine before requesting a quote. Suppliers set
              their margin openly; BullionBridge applies a fixed {platformSettings.commissionRatePct}%
              commission.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div>
                <label className="block text-[11px] font-medium text-[#5A5852] mb-1">Metal</label>
                <select
                  value={calcMetal}
                  onChange={(e) => {
                    const m = e.target.value as MetalType;
                    setCalcMetal(m);
                    setCalcWeight(m === 'GOLD' ? 100 : 1000);
                    setCalcPremium(m === 'GOLD' ? 350 : 900);
                  }}
                  className="w-full px-2.5 py-2 text-xs border border-[#D4D1C8] bg-white"
                >
                  <option value="GOLD">Gold</option>
                  <option value="SILVER">Silver</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#5A5852] mb-1">Purity</label>
                <select
                  value={calcPurity}
                  onChange={(e) => setCalcPurity(e.target.value as PurityGrade)}
                  className="w-full px-2.5 py-2 text-xs font-mono border border-[#D4D1C8] bg-white"
                >
                  <option value="999">999 Fine</option>
                  <option value="995">995 Fine</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#5A5852] mb-1">
                  Weight (g)
                </label>
                <input
                  type="number"
                  min={1}
                  value={calcWeight}
                  onChange={(e) => setCalcWeight(Math.max(1, Number(e.target.value)))}
                  className="w-full px-2.5 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#5A5852] mb-1">
                  Premium (₹/{calcMetal === 'GOLD' ? '10g' : '1kg'})
                </label>
                <input
                  type="number"
                  value={calcPremium}
                  onChange={(e) => setCalcPremium(Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8]"
                />
              </div>
            </div>

            {calcBreakdown ? (
              <div className="bg-[#FAFAF8] border border-[#E5E3DD] p-4 space-y-2 text-xs font-mono tabular-nums">
                <div className="flex justify-between text-[#4B4A45]">
                  <span>
                    1. Live MCX Base ({formatInr(calcBreakdown.mcxBaseRatePerUnit)}/
                    {calcMetal === 'GOLD' ? '10g' : '1kg'})
                  </span>
                  <span>{formatInr(calcBreakdown.baseMetalValueInr)}</span>
                </div>
                <div className="flex justify-between text-[#4B4A45]">
                  <span>2. Supplier Premium</span>
                  <span>{formatInr(calcBreakdown.supplierPremiumTotalInr)}</span>
                </div>
                <div className="flex justify-between font-semibold text-[#141413] pt-1.5 border-t border-[#E5E3DD]">
                  <span>Gross Bullion Value (GTV)</span>
                  <span>{formatInr(calcBreakdown.grossBullionValueInr)}</span>
                </div>
                <div className="flex justify-between text-[#4B4A45]">
                  <span>3. Platform Commission ({platformSettings.commissionRatePct}%)</span>
                  <span>{formatInr(calcBreakdown.platformCommissionInr)}</span>
                </div>
                <div className="flex justify-between text-[#4B4A45]">
                  <span>4. Bullion GST ({platformSettings.gstRatePct}%)</span>
                  <span>{formatInr(calcBreakdown.gstAmountInr)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold text-[#141413] pt-2.5 border-t border-[#141413]">
                  <span>Live Estimated Total</span>
                  <span>{formatInr(calcBreakdown.finalPayableTotalInr)}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#B45309]">
                Live MCX rate unavailable — calculator will populate automatically once feed
                resumes.
              </p>
            )}
          </div>

          {/* How It Works + Assaying Lab Proof */}
          <div className="lg:col-span-6 space-y-6">
            <div className="aspect-[16/10] bg-[#141413] overflow-hidden border border-[#E5E3DD]">
              <img
                src="/src/assets/images/assay_hallmark_lab_1795167900401.jpg"
                alt="Precision electronic analytical bullion scale and XRF gold purity analyzer in Jaipur assaying lab"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-[#E5E3DD] p-4">
                <Lock className="w-4 h-4 text-[#8A641E] mb-2" />
                <h3 className="text-sm font-semibold text-[#141413] mb-1">
                  01. Dynamic-Until-Confirmed
                </h3>
                <p className="text-xs text-[#5A5852] leading-relaxed">
                  Quote floats with live MCX until supplier locks an immutable server-verified price
                  snapshot.
                </p>
              </div>
              <div className="bg-white border border-[#E5E3DD] p-4">
                <FileCheck2 className="w-4 h-4 text-[#8A641E] mb-2" />
                <h3 className="text-sm font-semibold text-[#141413] mb-1">
                  02. Assaying Proof First
                </h3>
                <p className="text-xs text-[#5A5852] leading-relaxed">
                  Suppliers upload XRF / BIS purity certificates before the jeweller approves
                  settlement.
                </p>
              </div>
              <div className="bg-white border border-[#E5E3DD] p-4">
                <ShieldCheck className="w-4 h-4 text-[#8A641E] mb-2" />
                <h3 className="text-sm font-semibold text-[#141413] mb-1">
                  03. GST Invoice &amp; Audit
                </h3>
                <p className="text-xs text-[#5A5852] leading-relaxed">
                  Every locked order receives a unique GST tax invoice and permanent audit timeline.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. SUPPLIER ONBOARDING CTA & FAQs */}
      <section id="support" className="border-t border-[#E5E3DD] bg-white">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5 bg-[#111318] text-white p-8 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium text-[#C99D44] mb-2">
                Partner With BullionBridge Jaipur
              </p>
              <h2 className="text-3xl font-semibold mb-4">
                Are you a verified Jaipur bullion dealer or refiner?
              </h2>
              <p className="text-sm text-[#C7C5BE] leading-relaxed mb-6">
                Reach verified retail and wholesale jewellers across Johari Bazaar, MI Road, and
                Sitapura SEZ. Set your own MCX-linked premiums, authorize staff desks, and receive
                structured quote requests with complete audit records.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() =>
                  firebaseUser ? onGoToWorkspace() : onOpenAuth('signup', 'supplier')
                }
                className="w-full py-3 px-5 bg-[#C99D44] text-[#111318] text-sm font-semibold hover:bg-[#D8B05C] transition-colors"
              >
                Register as Bullion Supplier
              </button>
              <p className="text-[11px] text-[#9E9B93] mt-3">
                Requires GSTIN, BIS/Assaying documentation, and Jaipur office verification.
              </p>
            </div>
          </div>

          <div className="lg:col-span-7">
            <div className="flex items-center gap-2 text-xs font-medium text-[#8A641E] mb-1">
              <HelpCircle className="w-4 h-4" />
              Jaipur Trade Desk FAQs
            </div>
            <h2 className="text-3xl font-semibold text-[#141413] mb-6">
              Frequently Asked Questions
            </h2>
            <div className="divide-y divide-[#E5E3DD] border-y border-[#E5E3DD]">
              {FAQS.map((faq, idx) => (
                <div key={faq.q} className="py-4">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                    className="w-full flex items-center justify-between gap-4 text-left text-sm font-semibold text-[#141413]"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#6F6D67] shrink-0 transition-transform ${
                        openFaq === idx ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {openFaq === idx && (
                    <p className="mt-2.5 text-sm text-[#4B4A45] leading-relaxed">{faq.a}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
