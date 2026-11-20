import { describe, expect, it } from 'vitest';
import {
  buildOrdersCsv,
  buildUnitConversions,
  calculateBullionPricing,
  computeVentureFinancialModel,
  DEFAULT_PLATFORM_SETTINGS,
  getEffectiveOrderPricing,
  getMcxRatePerUnit,
} from '../src/lib/pricing';
import type { LiveMcxRate, OrderDoc } from '../src/types/bullion';
import type { Timestamp } from 'firebase/firestore';

describe('BullionBridge Pricing, Dynamic-to-Locked Order & 1.25% Commission Suite', () => {
  it('computes accurate MCX unit conversions for Gold (10g/1g, 999/995) and Silver (1kg/100g)', () => {
    const conv = buildUnitConversions(80000, 95000);
    expect(conv.gold999Per10g).toBe(80000);
    expect(conv.gold999Per1g).toBe(8000);
    expect(conv.gold995Per10g).toBeCloseTo(79679.68, 2);
    expect(conv.silver999Per1kg).toBe(95000);
    expect(conv.silver999Per100g).toBe(9500);
  });

  it('applies exact 1.25% platform commission on Gross Bullion Value and 3% GST', () => {
    // 20g Gold 999 at ₹80,000/10g + ₹500/10g supplier premium = ₹1,61,000 GTV
    const breakdown = calculateBullionPricing({
      metal: 'GOLD',
      purity: '999',
      weightGrams: 20,
      mcxBaseRatePerUnit: 80000,
      supplierPremiumPerUnitInr: 500,
      platformCommissionRatePct: 1.25,
      gstRatePct: 3.0,
    });

    expect(breakdown.baseMetalValueInr).toBe(160000);
    expect(breakdown.supplierPremiumTotalInr).toBe(1000);
    expect(breakdown.grossBullionValueInr).toBe(161000);
    // 1.25% of 161,000 = 2,012.50
    expect(breakdown.platformCommissionInr).toBe(2012.5);
    // 3% GST on (161,000 + 2,012.50 = 163,012.50) = 4,890.38
    expect(breakdown.gstAmountInr).toBe(4890.38);
    expect(breakdown.finalPayableTotalInr).toBe(167902.88);
    expect(breakdown.supplierNetPayableInr).toBe(158987.5);
  });

  it('keeps Quote Requested orders floating with live MCX rates and freezes locked orders immutably', () => {
    const rateT1: LiveMcxRate = {
      ...buildUnitConversions(78000, 92000),
      source: 'Live Public Feed',
      isDelayed: false,
      isManualOverride: false,
      lastUpdatedAt: new Date().toISOString(),
    };
    const rateT2: LiveMcxRate = {
      ...buildUnitConversions(81000, 96000),
      source: 'Live Public Feed',
      isDelayed: false,
      isManualOverride: false,
      lastUpdatedAt: new Date().toISOString(),
    };

    const mockTs = { toDate: () => new Date(), toMillis: () => Date.now() } as unknown as Timestamp;

    const floatingOrder: OrderDoc = {
      id: 'ord_test_1',
      orderNumber: 'BB-JPR-20261120-1001',
      idempotencyKey: 'ord_test_1',
      jewellerId: 'jew_1',
      jewellerShopName: 'Johari Jewels',
      supplierId: 'sup_1',
      supplierOwnerId: 'sup_owner_1',
      supplierName: 'Jaipur Bullion House',
      listingId: 'lst_1',
      assignedStaffUids: [],
      orderType: 'BUY',
      metal: 'GOLD',
      purity: '999',
      weightGrams: 100,
      deliveryCenter: 'Johari Bazaar Desk',
      status: 'Quote Requested',
      isRateLocked: false,
      indicativeMcxRatePerUnit: 78000,
      supplierPremiumPerUnitInr: 400,
      platformCommissionRatePct: 1.25,
      gstRatePct: 3.0,
      hasInvoice: false,
      hasReview: false,
      createdAt: mockTs,
      updatedAt: mockTs,
    };

    // Floating at T1 vs T2 must automatically reflect live MCX increase
    const evalT1 = getEffectiveOrderPricing(floatingOrder, rateT1);
    const evalT2 = getEffectiveOrderPricing(floatingOrder, rateT2);
    expect(evalT1.isFloating).toBe(true);
    expect(evalT2.isFloating).toBe(true);
    expect(evalT2.breakdown.grossBullionValueInr).toBeGreaterThan(
      evalT1.breakdown.grossBullionValueInr
    );

    // Supplier confirms & locks at T1
    const lockSnapshot = calculateBullionPricing({
      metal: 'GOLD',
      purity: '999',
      weightGrams: 100,
      mcxBaseRatePerUnit: getMcxRatePerUnit(rateT1, 'GOLD', '999'),
      supplierPremiumPerUnitInr: 400,
      platformCommissionRatePct: 1.25,
      gstRatePct: 3.0,
    });

    const lockedOrder: OrderDoc = {
      ...floatingOrder,
      status: 'Quote Confirmed & Rate Locked',
      isRateLocked: true,
      lockedMcxBaseRatePerUnit: lockSnapshot.mcxBaseRatePerUnit,
      baseMetalValueInr: lockSnapshot.baseMetalValueInr,
      supplierPremiumTotalInr: lockSnapshot.supplierPremiumTotalInr,
      grossBullionValueInr: lockSnapshot.grossBullionValueInr,
      platformCommissionInr: lockSnapshot.platformCommissionInr,
      gstAmountInr: lockSnapshot.gstAmountInr,
      finalPayableTotalInr: lockSnapshot.finalPayableTotalInr,
    };

    // Even when live MCX jumps to T2, locked order snapshot MUST NOT change
    const lockedEvalAtT2 = getEffectiveOrderPricing(lockedOrder, rateT2);
    expect(lockedEvalAtT2.isFloating).toBe(false);
    expect(lockedEvalAtT2.breakdown.mcxBaseRatePerUnit).toBe(78000);
    expect(lockedEvalAtT2.breakdown.grossBullionValueInr).toBe(784000);
    expect(lockedEvalAtT2.breakdown.platformCommissionInr).toBe(9800);
    expect(lockedEvalAtT2.breakdown.finalPayableTotalInr).toBe(lockSnapshot.finalPayableTotalInr);
  });

  it('calculates Venture Plan unit economics and separates GTV from Platform Commission Revenue', () => {
    const mockTs = { toDate: () => new Date(), toMillis: () => Date.now() } as unknown as Timestamp;
    const sampleLockedOrder: OrderDoc = {
      id: 'ord_rev_1',
      orderNumber: 'BB-JPR-20261120-2001',
      idempotencyKey: 'ord_rev_1',
      jewellerId: 'jew_1',
      jewellerShopName: 'MI Road Jewels',
      supplierId: 'sup_1',
      supplierOwnerId: 'sup_owner_1',
      supplierName: 'Jaipur Refinery',
      listingId: 'lst_1',
      assignedStaffUids: [],
      orderType: 'BUY',
      metal: 'GOLD',
      purity: '999',
      weightGrams: 20,
      deliveryCenter: 'MI Road Desk',
      status: 'Completed',
      isRateLocked: true,
      indicativeMcxRatePerUnit: 92000,
      supplierPremiumPerUnitInr: 312.5,
      platformCommissionRatePct: 1.25,
      gstRatePct: 3.0,
      lockedMcxBaseRatePerUnit: 92000,
      baseMetalValueInr: 184000,
      supplierPremiumTotalInr: 625,
      grossBullionValueInr: 184625,
      platformCommissionInr: 2307.81,
      gstAmountInr: 5607.98,
      finalPayableTotalInr: 192540.79,
      hasInvoice: true,
      hasReview: true,
      createdAt: mockTs,
      updatedAt: mockTs,
    };

    const metrics = computeVentureFinancialModel([sampleLockedOrder], DEFAULT_PLATFORM_SETTINGS);
    expect(metrics.realGrossTransactionValueInr).toBe(184625);
    expect(metrics.realPlatformCommissionRevenueInr).toBe(2307.81);
    expect(metrics.realPlatformCommissionRevenueInr).not.toBe(metrics.realGrossTransactionValueInr);
    expect(metrics.benchmarkAvgTransactionInr).toBe(184625);
    expect(metrics.benchmarkVariableCostInr).toBe(182317);
    expect(metrics.benchmarkContributionPerTxInr).toBe(2308);
    expect(metrics.monthlyFixedCostInr).toBe(150000);
    // 150,000 / 0.0125 = 12,000,000 break-even GTV; ceil(150,000 / 2,308) = 65 transactions/month
    expect(metrics.breakEvenMonthlyGtvInr).toBe(12000000);
    expect(metrics.breakEvenMonthlyTxCount).toBe(65);

    const csv = buildOrdersCsv([sampleLockedOrder]);
    expect(csv).toContain('Gross Bullion Value GTV (INR)');
    expect(csv).toContain('Platform Commission Revenue (INR)');
    expect(csv).toContain('BB-JPR-20261120-2001');
  });
});
