import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'jeweller' | 'supplier' | 'supplier_staff' | 'super_admin';

export type MetalType = 'GOLD' | 'SILVER';
export type PurityGrade = '999' | '995';
export type BullionForm = 'Bar' | 'Coin' | 'Biscuit' | 'Kacha';
export type OrderType = 'BUY' | 'SELL' | 'EXCHANGE';

export type SupplierStatus = 'Pending' | 'Under Review' | 'Approved' | 'Rejected' | 'Suspended';
export type VerificationStatus = 'Pending' | 'Under Review' | 'Approved' | 'Rejected';

export type OrderStatus =
  | 'Quote Requested'
  | 'Quote Confirmed & Rate Locked'
  | 'Rejected'
  | 'Purity & Docs Uploaded'
  | 'Order Approved by Jeweller'
  | 'Payment / Exchange Settled'
  | 'Ready for Pickup / Dispatch'
  | 'Completed'
  | 'Cancelled';

export const JAIPUR_LOCALITIES = [
  'Johari Bazaar',
  'Gopalji Ka Rasta',
  'MI Road',
  'Bapu Bazaar',
  'Sitapura Jewellery SEZ',
  'Vaishali Nagar',
  'Malviya Nagar',
  'Tonk Road',
] as const;

export const ORDER_WORKFLOW_STEPS: OrderStatus[] = [
  'Quote Requested',
  'Quote Confirmed & Rate Locked',
  'Purity & Docs Uploaded',
  'Order Approved by Jeweller',
  'Payment / Exchange Settled',
  'Ready for Pickup / Dispatch',
  'Completed',
];

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  supplierId?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface JewellerProfileDoc {
  id: string;
  userId: string;
  shopName: string;
  ownerName: string;
  gstin: string;
  pan?: string;
  jaipurLocality: string;
  address?: string;
  contactPhone?: string;
  kycDocumentUrl?: string;
  kycDocumentName?: string;
  verificationStatus: VerificationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SupplierDoc {
  id: string;
  ownerUserId: string;
  businessName: string;
  gstin: string;
  bisLicenseNumber: string;
  assayingPartner?: string;
  jaipurLocality: string;
  officeAddress: string;
  deliveryCenter: string;
  kycDocumentUrl?: string;
  kycDocumentName?: string;
  status: SupplierStatus;
  adminRemarks?: string;
  ratingAvg: number;
  reviewCount: number;
  completedOrdersCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SupplierStaffDoc {
  id: string;
  supplierId: string;
  supplierOwnerId: string;
  userId?: string;
  staffEmail: string;
  staffName: string;
  designation?: string;
  canLockRates: boolean;
  canUploadPurityDocs: boolean;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LiveMcxRate {
  gold999Per10g: number;
  gold995Per10g: number;
  gold999Per1g: number;
  silver999Per1kg: number;
  silver999Per100g: number;
  usdInr?: number;
  xauUsd?: number;
  xagUsd?: number;
  source: string;
  isDelayed: boolean;
  isManualOverride: boolean;
  manualOverrideNote?: string;
  lastUpdatedAt: string; // ISO string for UI display
  cacheAgeSeconds?: number;
  status?: 'live' | 'delayed' | 'manual_override' | 'unavailable';
}

export interface BullionListingDoc {
  id: string;
  supplierId: string;
  supplierOwnerId: string;
  supplierName: string;
  supplierApproved: boolean;
  metal: MetalType;
  purity: PurityGrade;
  form: BullionForm;
  title: string;
  unitGrams: number;
  minWeightGrams: number;
  maxWeightGrams: number;
  availableStockGrams: number;
  premiumPerUnitInr: number; // per 10g for GOLD, per 1kg for SILVER
  jaipurLocality: string;
  deliveryCenter: string;
  supportsBuy: boolean;
  supportsSell: boolean;
  supportsExchange: boolean;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OrderDoc {
  id: string;
  orderNumber: string;
  idempotencyKey: string;
  jewellerId: string;
  jewellerShopName: string;
  supplierId: string;
  supplierOwnerId: string;
  supplierName: string;
  listingId: string;
  assignedStaffUids: string[];
  orderType: OrderType;
  metal: MetalType;
  purity: PurityGrade;
  weightGrams: number;
  deliveryCenter: string;
  notes?: string;
  status: OrderStatus;
  isRateLocked: boolean;
  indicativeMcxRatePerUnit: number;
  supplierPremiumPerUnitInr: number;
  platformCommissionRatePct: number;
  gstRatePct: number;
  lockedMcxBaseRatePerUnit?: number;
  baseMetalValueInr?: number;
  supplierPremiumTotalInr?: number;
  grossBullionValueInr?: number;
  platformCommissionInr?: number;
  gstAmountInr?: number;
  finalPayableTotalInr?: number;
  rateLockedAt?: Timestamp;
  rateLockedByUid?: string;
  settlementMethod?: string;
  settlementReference?: string;
  rejectionReason?: string;
  hasInvoice: boolean;
  hasReview: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OrderStatusHistoryDoc {
  id: string;
  orderId: string;
  jewellerId: string;
  supplierOwnerId: string;
  assignedStaffUids: string[];
  fromStatus: string;
  toStatus: string;
  changedByUid: string;
  changedByRole: string;
  note: string;
  priceSnapshotInr?: number;
  createdAt: Timestamp;
}

export interface PurityDocumentDoc {
  id: string;
  orderId: string;
  jewellerId: string;
  supplierId: string;
  supplierOwnerId: string;
  assignedStaffUids: string[];
  certificateNumber: string;
  assayingLab: string;
  testedPurity: string;
  grossWeightGrams: number;
  netWeightGrams: number;
  fileUrl?: string;
  fileName: string;
  uploadedByUid: string;
  createdAt: Timestamp;
}

export interface InvoiceDoc {
  id: string;
  orderId: string;
  invoiceNumber: string;
  jewellerId: string;
  jewellerShopName: string;
  supplierId: string;
  supplierOwnerId: string;
  supplierName: string;
  assignedStaffUids: string[];
  metal: MetalType;
  purity: PurityGrade;
  weightGrams: number;
  grossBullionValueInr: number;
  platformCommissionRatePct: number;
  platformCommissionInr: number;
  gstRatePct: number;
  gstAmountInr: number;
  finalPayableTotalInr: number;
  issuedByUid: string;
  issuedAt: Timestamp;
}

export interface ReviewDoc {
  id: string;
  orderId: string;
  jewellerId: string;
  jewellerShopName: string;
  supplierId: string;
  rating: number;
  comment: string;
  createdAt: Timestamp;
}

export interface NotificationDoc {
  id: string;
  userId: string;
  senderUid: string;
  title: string;
  message: string;
  category: 'ORDER' | 'RATE_LOCK' | 'VERIFICATION' | 'SUPPORT' | 'SETTLEMENT';
  relatedOrderId?: string;
  isRead: boolean;
  createdAt: Timestamp;
}

export interface SupportTicketDoc {
  id: string;
  ticketNumber: string;
  createdByUid: string;
  createdByName: string;
  createdByRole: string;
  subject: string;
  category: 'Order Issue' | 'Purity Dispute' | 'KYC / Verification' | 'Settlement / Invoice' | 'General';
  priority: 'Low' | 'Medium' | 'High';
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  relatedOrderId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SupportMessageDoc {
  id: string;
  ticketId: string;
  ticketOwnerId: string;
  senderUid: string;
  senderName: string;
  senderRole: string;
  body: string;
  isInternalNote: boolean;
  createdAt: Timestamp;
}

export interface SettlementDoc {
  id: string;
  orderId: string;
  orderNumber: string;
  supplierId: string;
  supplierOwnerId: string;
  supplierName: string;
  grossTransactionValueInr: number;
  platformCommissionRatePct: number;
  platformCommissionInr: number;
  supplierNetPayableInr: number;
  status: 'Pending' | 'Settled';
  referenceNumber?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PlatformSettingsDoc {
  commissionRatePct: number;
  gstRatePct: number;
  benchmarkAvgTransactionInr: number;
  benchmarkVariableCostPct: number;
  benchmarkVariableCostInr: number;
  monthlyFixedCostInr: number;
  manualOverrideEnabled: boolean;
  manualGold999Per10g?: number;
  manualSilver999Per1kg?: number;
  manualOverrideReason?: string;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

export interface AuditLogDoc {
  id: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetCollection: string;
  targetId: string;
  details: string;
  createdAt: Timestamp;
}

export interface PricingBreakdown {
  baseUnitGrams: number;
  units: number;
  mcxBaseRatePerUnit: number;
  supplierPremiumPerUnitInr: number;
  baseMetalValueInr: number;
  supplierPremiumTotalInr: number;
  grossBullionValueInr: number;
  platformCommissionRatePct: number;
  platformCommissionInr: number;
  gstRatePct: number;
  gstAmountInr: number;
  finalPayableTotalInr: number;
  supplierNetPayableInr: number;
}
