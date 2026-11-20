import type {
  LiveMcxRate,
  MetalType,
  OrderDoc,
  PlatformSettingsDoc,
  PricingBreakdown,
  PurityGrade,
} from '../types/bullion';

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsDoc = {
  commissionRatePct: 1.25,
  gstRatePct: 3.0,
  benchmarkAvgTransactionInr: 184625,
  benchmarkVariableCostPct: 98.75,
  benchmarkVariableCostInr: 182317,
  monthlyFixedCostInr: 150000,
  manualOverrideEnabled: false,
};

export function roundInr(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatInr(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return '₹0.00';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatInrWhole(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) {
    return '₹0';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Derive standard MCX unit rates and purity conversions from 999 base benchmarks.
 */
export function buildUnitConversions(gold999Per10g: number, silver999Per1kg: number) {
  const cleanGold999 = roundInr(gold999Per10g);
  const cleanSilver999 = roundInr(silver999Per1kg);
  return {
    gold999Per10g: cleanGold999,
    gold995Per10g: roundInr(cleanGold999 * (995 / 999)),
    gold999Per1g: roundInr(cleanGold999 / 10),
    silver999Per1kg: cleanSilver999,
    silver999Per100g: roundInr(cleanSilver999 / 10),
  };
}

/**
 * Select the right MCX base rate per unit (10g for GOLD, 1kg for SILVER) for a metal & purity.
 */
export function getMcxRatePerUnit(
  rates: Pick<LiveMcxRate, 'gold999Per10g' | 'gold995Per10g' | 'silver999Per1kg'>,
  metal: MetalType,
  purity: PurityGrade
): number {
  if (metal === 'GOLD') {
    return purity === '995' ? rates.gold995Per10g : rates.gold999Per10g;
  }
  return purity === '995' ? roundInr(rates.silver999Per1kg * (995 / 999)) : rates.silver999Per1kg;
}

/**
 * Transparent BullionBridge Pricing Formula:
 * Live MCX Base Rate + Supplier Premium = Gross Bullion Value (GTV)
 * Platform Commission = 1.25% (configurable by Super Admin) of Gross Bullion Value
 * GST = 3% on (Gross Bullion Value + Platform Commission)
 * Final Payable Total = Gross Bullion Value + Platform Commission + GST
 */
export function calculateBullionPricing(params: {
  metal: MetalType;
  purity: PurityGrade;
  weightGrams: number;
  mcxBaseRatePerUnit: number;
  supplierPremiumPerUnitInr: number;
  platformCommissionRatePct: number;
  gstRatePct: number;
}): PricingBreakdown {
  const baseUnitGrams = params.metal === 'GOLD' ? 10 : 1000;
  const safeWeight = Math.max(0, params.weightGrams);
  const units = safeWeight / baseUnitGrams;

  const baseMetalValueInr = roundInr(units * params.mcxBaseRatePerUnit);
  const supplierPremiumTotalInr = roundInr(units * params.supplierPremiumPerUnitInr);
  const grossBullionValueInr = roundInr(baseMetalValueInr + supplierPremiumTotalInr);
  const platformCommissionInr = roundInr(
    grossBullionValueInr * (params.platformCommissionRatePct / 100)
  );
  const taxableValueInr = roundInr(grossBullionValueInr + platformCommissionInr);
  const gstAmountInr = roundInr(taxableValueInr * (params.gstRatePct / 100));
  const finalPayableTotalInr = roundInr(taxableValueInr + gstAmountInr);
  const supplierNetPayableInr = roundInr(grossBullionValueInr - platformCommissionInr);

  return {
    baseUnitGrams,
    units,
    mcxBaseRatePerUnit: roundInr(params.mcxBaseRatePerUnit),
    supplierPremiumPerUnitInr: roundInr(params.supplierPremiumPerUnitInr),
    baseMetalValueInr,
    supplierPremiumTotalInr,
    grossBullionValueInr,
    platformCommissionRatePct: params.platformCommissionRatePct,
    platformCommissionInr,
    gstRatePct: params.gstRatePct,
    gstAmountInr,
    finalPayableTotalInr,
    supplierNetPayableInr,
  };
}

/**
 * Computes effective order pricing:
 * - While status === 'Quote Requested' and !isRateLocked -> floats dynamically with live MCX rates.
 * - Once isRateLocked === true -> strictly returns the immutable locked snapshot stored on the order.
 */
export function getEffectiveOrderPricing(
  order: OrderDoc,
  liveRate: LiveMcxRate | null
): { isFloating: boolean; breakdown: PricingBreakdown } {
  if (
    order.isRateLocked &&
    order.lockedMcxBaseRatePerUnit !== undefined &&
    order.grossBullionValueInr !== undefined &&
    order.platformCommissionInr !== undefined &&
    order.gstAmountInr !== undefined &&
    order.finalPayableTotalInr !== undefined
  ) {
    const baseUnitGrams = order.metal === 'GOLD' ? 10 : 1000;
    return {
      isFloating: false,
      breakdown: {
        baseUnitGrams,
        units: order.weightGrams / baseUnitGrams,
        mcxBaseRatePerUnit: order.lockedMcxBaseRatePerUnit,
        supplierPremiumPerUnitInr: order.supplierPremiumPerUnitInr,
        baseMetalValueInr: order.baseMetalValueInr ?? 0,
        supplierPremiumTotalInr: order.supplierPremiumTotalInr ?? 0,
        grossBullionValueInr: order.grossBullionValueInr,
        platformCommissionRatePct: order.platformCommissionRatePct,
        platformCommissionInr: order.platformCommissionInr,
        gstRatePct: order.gstRatePct,
        gstAmountInr: order.gstAmountInr,
        finalPayableTotalInr: order.finalPayableTotalInr,
        supplierNetPayableInr: roundInr(order.grossBullionValueInr - order.platformCommissionInr),
      },
    };
  }

  const mcxRatePerUnit = liveRate
    ? getMcxRatePerUnit(liveRate, order.metal, order.purity)
    : order.indicativeMcxRatePerUnit;

  return {
    isFloating: true,
    breakdown: calculateBullionPricing({
      metal: order.metal,
      purity: order.purity,
      weightGrams: order.weightGrams,
      mcxBaseRatePerUnit: mcxRatePerUnit,
      supplierPremiumPerUnitInr: order.supplierPremiumPerUnitInr,
      platformCommissionRatePct: order.platformCommissionRatePct,
      gstRatePct: order.gstRatePct,
    }),
  };
}

export interface VentureFinancialMetrics {
  realLockedOrdersCount: number;
  realCompletedOrdersCount: number;
  realGrossTransactionValueInr: number;
  realPlatformCommissionRevenueInr: number;
  realGstCollectedInr: number;
  realAverageOrderValueInr: number;
  commissionRatePct: number;
  benchmarkAvgTransactionInr: number;
  benchmarkVariableCostInr: number;
  benchmarkContributionPerTxInr: number;
  monthlyFixedCostInr: number;
  breakEvenMonthlyGtvInr: number;
  breakEvenMonthlyTxCount: number;
  monthlyNetSurplusDeficitInr: number;
}

/**
 * Calculates real Firestore revenue + configurable Venture Plan unit economics.
 * Strictly separates Gross Transaction Value (GTV) from Platform Commission Revenue.
 */
export function computeVentureFinancialModel(
  orders: OrderDoc[],
  settings: PlatformSettingsDoc
): VentureFinancialMetrics {
  const lockedOrders = orders.filter(
    (o) =>
      o.isRateLocked &&
      o.status !== 'Cancelled' &&
      o.status !== 'Rejected' &&
      typeof o.grossBullionValueInr === 'number'
  );
  const completedOrders = lockedOrders.filter((o) => o.status === 'Completed');

  const realGrossTransactionValueInr = roundInr(
    lockedOrders.reduce((sum, o) => sum + (o.grossBullionValueInr ?? 0), 0)
  );
  const realPlatformCommissionRevenueInr = roundInr(
    lockedOrders.reduce((sum, o) => sum + (o.platformCommissionInr ?? 0), 0)
  );
  const realGstCollectedInr = roundInr(
    lockedOrders.reduce((sum, o) => sum + (o.gstAmountInr ?? 0), 0)
  );
  const realAverageOrderValueInr =
    lockedOrders.length > 0 ? roundInr(realGrossTransactionValueInr / lockedOrders.length) : 0;

  const commissionDecimal = settings.commissionRatePct / 100;
  const benchmarkContributionPerTxInr = roundInr(
    settings.benchmarkAvgTransactionInr - settings.benchmarkVariableCostInr
  );
  const breakEvenMonthlyGtvInr =
    commissionDecimal > 0 ? roundInr(settings.monthlyFixedCostInr / commissionDecimal) : 0;
  const breakEvenMonthlyTxCount =
    benchmarkContributionPerTxInr > 0
      ? Math.ceil(settings.monthlyFixedCostInr / benchmarkContributionPerTxInr)
      : 0;

  const monthlyNetSurplusDeficitInr = roundInr(
    realPlatformCommissionRevenueInr - settings.monthlyFixedCostInr
  );

  return {
    realLockedOrdersCount: lockedOrders.length,
    realCompletedOrdersCount: completedOrders.length,
    realGrossTransactionValueInr,
    realPlatformCommissionRevenueInr,
    realGstCollectedInr,
    realAverageOrderValueInr,
    commissionRatePct: settings.commissionRatePct,
    benchmarkAvgTransactionInr: settings.benchmarkAvgTransactionInr,
    benchmarkVariableCostInr: settings.benchmarkVariableCostInr,
    benchmarkContributionPerTxInr,
    monthlyFixedCostInr: settings.monthlyFixedCostInr,
    breakEvenMonthlyGtvInr,
    breakEvenMonthlyTxCount,
    monthlyNetSurplusDeficitInr,
  };
}

export function buildOrdersCsv(orders: OrderDoc[]): string {
  const headers = [
    'Order Number',
    'Date',
    'Jeweller Shop',
    'Supplier',
    'Type',
    'Metal',
    'Purity',
    'Weight (g)',
    'Status',
    'Rate Locked',
    'Locked MCX Base (INR/unit)',
    'Gross Bullion Value GTV (INR)',
    'Commission Rate (%)',
    'Platform Commission Revenue (INR)',
    'GST (INR)',
    'Final Payable Total (INR)',
  ];

  const escapeCsv = (val: string | number | boolean | undefined | null) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = orders.map((o) => {
    const dateStr = o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : '';
    return [
      o.orderNumber,
      dateStr,
      o.jewellerShopName,
      o.supplierName,
      o.orderType,
      o.metal,
      o.purity,
      o.weightGrams,
      o.status,
      o.isRateLocked ? 'YES' : 'NO',
      o.lockedMcxBaseRatePerUnit ?? o.indicativeMcxRatePerUnit,
      o.grossBullionValueInr ?? 0,
      o.platformCommissionRatePct,
      o.platformCommissionInr ?? 0,
      o.gstAmountInr ?? 0,
      o.finalPayableTotalInr ?? 0,
    ]
      .map(escapeCsv)
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
