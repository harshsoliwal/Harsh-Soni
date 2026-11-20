import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  Download,
  FileClock,
  IndianRupee,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  PackageCheck,
  Percent,
  Users,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import {
  adminMarkSettlementSettled,
  adminSavePlatformSettings,
  adminUpdateJewellerVerification,
  adminUpdateSupplierStatus,
  adminUpdateTicketStatus,
  sendSupportMessage,
} from '../lib/firestoreService';
import { downloadTextFile } from '../lib/invoicePdf';
import {
  buildOrdersCsv,
  computeVentureFinancialModel,
  formatInr,
  formatInrWhole,
  roundInr,
} from '../lib/pricing';
import type {
  AuditLogDoc,
  JewellerProfileDoc,
  OrderDoc,
  PlatformSettingsDoc,
  SettlementDoc,
  SupplierDoc,
  SupplierStatus,
  SupportMessageDoc,
  SupportTicketDoc,
  UserDoc,
} from '../types/bullion';

type AdminModule =
  | 'overview'
  | 'suppliers'
  | 'jewellers'
  | 'orders'
  | 'mcx'
  | 'commission'
  | 'reports'
  | 'settlements'
  | 'support'
  | 'audit';

interface AdminDashboardProps {
  onSelectOrder: (order: OrderDoc) => void;
}

export function AdminDashboard({ onSelectOrder }: AdminDashboardProps) {
  const { firebaseUser, mcxRate, refreshMcxRate, platformSettings, showToast } = useApp();

  const [module, setModule] = useState<AdminModule>('overview');
  const [suppliers, setSuppliers] = useState<SupplierDoc[]>([]);
  const [jewellers, setJewellers] = useState<JewellerProfileDoc[]>([]);
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [settlements, setSettlements] = useState<SettlementDoc[]>([]);
  const [tickets, setTickets] = useState<SupportTicketDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);

  // Settings form state
  const [settingsForm, setSettingsForm] = useState<PlatformSettingsDoc>(platformSettings);
  const [savingSettings, setSavingSettings] = useState(false);

  // Supplier review remarks
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});

  // Settlement reference inputs
  const [settlementRefMap, setSettlementRefMap] = useState<Record<string, string>>({});

  // Financial report period filter
  const [reportWindow, setReportWindow] = useState<'daily' | 'weekly' | 'monthly' | 'all'>('monthly');

  // Support ticket inspector (with admin-only internal notes!)
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketDoc | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportMessageDoc[]>([]);
  const [adminReply, setAdminReply] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);

  useEffect(() => {
    setSettingsForm(platformSettings);
  }, [platformSettings]);

  useEffect(() => {
    const unsubSup = onSnapshot(
      collection(db, 'suppliers'),
      (s) =>
        setSuppliers(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SupplierDoc, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        ),
      (e) => console.error('admin suppliers:', e)
    );
    const unsubJew = onSnapshot(
      collection(db, 'jeweller_profiles'),
      (s) =>
        setJewellers(
          s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<JewellerProfileDoc, 'id'>) }))
        ),
      (e) => console.error('admin jewellers:', e)
    );
    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (s) => setUsers(s.docs.map((d) => d.data() as UserDoc)),
      (e) => console.error('admin users:', e)
    );
    const unsubOrders = onSnapshot(
      collection(db, 'orders'),
      (s) =>
        setOrders(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<OrderDoc, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        ),
      (e) => console.error('admin orders:', e)
    );
    const unsubSet = onSnapshot(
      collection(db, 'settlements'),
      (s) =>
        setSettlements(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SettlementDoc, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        ),
      (e) => console.error('admin settlements:', e)
    );
    const unsubTkt = onSnapshot(
      collection(db, 'support_tickets'),
      (s) =>
        setTickets(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SupportTicketDoc, 'id'>) }))
            .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
        ),
      (e) => console.error('admin support_tickets:', e)
    );
    const unsubAudit = onSnapshot(
      collection(db, 'audit_logs'),
      (s) =>
        setAuditLogs(
          s.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogDoc, 'id'>) }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        ),
      (e) => console.error('admin audit_logs:', e)
    );

    return () => {
      unsubSup();
      unsubJew();
      unsubUsers();
      unsubOrders();
      unsubSet();
      unsubTkt();
      unsubAudit();
    };
  }, []);

  useEffect(() => {
    if (!selectedTicket) {
      setTicketMessages([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'support_messages'), where('ticketId', '==', selectedTicket.id)),
      (snap) => {
        setTicketMessages(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SupportMessageDoc, 'id'>) }))
            .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
        );
      },
      (err) => console.error('admin support_messages:', err)
    );
    return () => unsub();
  }, [selectedTicket?.id]);

  const filteredReportOrders = useMemo(() => {
    if (reportWindow === 'all') return orders;
    const now = Date.now();
    const msMap = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
    };
    const cutoff = now - msMap[reportWindow];
    return orders.filter((o) => (o.createdAt?.toMillis?.() || 0) >= cutoff);
  }, [orders, reportWindow]);

  const financialModel = useMemo(
    () => computeVentureFinancialModel(filteredReportOrders, platformSettings),
    [filteredReportOrders, platformSettings]
  );

  const allTimeModel = useMemo(
    () => computeVentureFinancialModel(orders, platformSettings),
    [orders, platformSettings]
  );

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const varPct = roundInr(100 - settingsForm.commissionRatePct);
      const varInr = roundInr(settingsForm.benchmarkAvgTransactionInr * (varPct / 100));
      await adminSavePlatformSettings({
        ...settingsForm,
        benchmarkVariableCostPct: varPct,
        benchmarkVariableCostInr: varInr,
      });
      showToast('success', 'Platform commission, venture model & MCX override settings saved.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleExportCsv = () => {
    const csv = buildOrdersCsv(filteredReportOrders);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `BullionBridge_${reportWindow}_Report_${stamp}.csv`,
      csv,
      'text/csv;charset=utf-8'
    );
    showToast('success', `Exported ${filteredReportOrders.length} orders to CSV.`);
  };

  const handleAdminReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !adminReply.trim() || !firebaseUser) return;
    try {
      await sendSupportMessage({
        ticketId: selectedTicket.id,
        ticketOwnerId: selectedTicket.createdByUid,
        senderName: firebaseUser.displayName || 'Super Admin',
        senderRole: 'super_admin',
        body: adminReply,
        isInternalNote,
      });
      setAdminReply('');
      showToast(
        'success',
        isInternalNote ? 'Private admin internal note added.' : 'Public reply sent to user.'
      );
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to post message.');
    }
  };

  const navModules: Array<{ key: AdminModule; label: string; icon: React.ReactNode }> = [
    { key: 'overview', label: 'Overview KPIs', icon: <LayoutDashboard className="w-4 h-4" /> },
    {
      key: 'suppliers',
      label: `Supplier Verification (${suppliers.filter((s) => s.status === 'Pending').length})`,
      icon: <Building2 className="w-4 h-4" />,
    },
    { key: 'jewellers', label: `Jeweller Management (${jewellers.length})`, icon: <Users className="w-4 h-4" /> },
    { key: 'orders', label: `Order Management (${orders.length})`, icon: <PackageCheck className="w-4 h-4" /> },
    { key: 'mcx', label: 'MCX Rate Monitor & Override', icon: <Activity className="w-4 h-4" /> },
    { key: 'commission', label: 'Commission & Venture Model', icon: <Percent className="w-4 h-4" /> },
    { key: 'reports', label: 'Financial Reports & CSV', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'settlements', label: `Settlements (${settlements.length})`, icon: <IndianRupee className="w-4 h-4" /> },
    { key: 'support', label: `Support Tickets (${tickets.length})`, icon: <LifeBuoy className="w-4 h-4" /> },
    { key: 'audit', label: `Audit Logs (${auditLogs.length})`, icon: <FileClock className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Sidebar */}
      <aside className="lg:col-span-3 space-y-6">
        <div className="bg-[#111318] text-white p-5">
          <p className="text-xs text-[#C99D44] font-medium mb-1">Super Admin Command Centre</p>
          <h1 className="text-2xl font-semibold">BullionBridge Governance</h1>
          <p className="text-[11px] text-[#9E9B93] mt-1 font-mono truncate">
            {firebaseUser?.email}
          </p>
        </div>

        <nav className="bg-white border border-[#E5E3DD] divide-y divide-[#E5E3DD]">
          {navModules.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setModule(m.key)}
              className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 transition-colors ${
                module === m.key
                  ? 'bg-[#141413] text-white'
                  : 'text-[#4B4A45] hover:bg-[#FAFAF8] hover:text-[#141413]'
              }`}
            >
              {m.icon}
              <span className="truncate">{m.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="lg:col-span-9 space-y-6">
        {/* 1. OVERVIEW KPIs */}
        {module === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-[#E5E3DD] p-5">
                <p className="text-xs text-[#6F6D67] mb-1">Gross Transaction Value (GTV)</p>
                <p className="text-2xl font-mono font-semibold text-[#141413] tabular-nums">
                  {formatInrWhole(allTimeModel.realGrossTransactionValueInr)}
                </p>
                <p className="text-[11px] text-[#6F6D67] mt-1">
                  {allTimeModel.realLockedOrdersCount} locked orders (strictly separate from fee)
                </p>
              </div>
              <div className="bg-white border border-[#E5E3DD] p-5">
                <p className="text-xs text-[#6F6D67] mb-1">Platform Commission Revenue</p>
                <p className="text-2xl font-mono font-semibold text-[#15803D] tabular-nums">
                  {formatInr(allTimeModel.realPlatformCommissionRevenueInr)}
                </p>
                <p className="text-[11px] text-[#6F6D67] mt-1">
                  At active {platformSettings.commissionRatePct}% commission rate
                </p>
              </div>
              <div className="bg-white border border-[#E5E3DD] p-5">
                <p className="text-xs text-[#6F6D67] mb-1">Verified Jaipur Suppliers</p>
                <p className="text-2xl font-mono font-semibold text-[#141413] tabular-nums">
                  {suppliers.filter((s) => s.status === 'Approved').length} / {suppliers.length}
                </p>
                <p className="text-[11px] text-[#B45309] mt-1">
                  {suppliers.filter((s) => s.status === 'Pending').length} pending approval
                </p>
              </div>
              <div className="bg-white border border-[#E5E3DD] p-5">
                <p className="text-xs text-[#6F6D67] mb-1">Monthly Break-Even Target</p>
                <p className="text-2xl font-mono font-semibold text-[#141413] tabular-nums">
                  {allTimeModel.breakEvenMonthlyTxCount} tx/mo
                </p>
                <p className="text-[11px] text-[#6F6D67] mt-1">
                  GTV {formatInrWhole(allTimeModel.breakEvenMonthlyGtvInr)} to cover{' '}
                  {formatInrWhole(allTimeModel.monthlyFixedCostInr)}
                </p>
              </div>
            </div>

            <div className="bg-white border border-[#E5E3DD] p-6">
              <h2 className="text-2xl font-semibold text-[#141413] mb-4">
                Venture Plan Unit Economics Reference
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs font-mono tabular-nums">
                <div className="border-t border-[#E5E3DD] pt-3">
                  <div className="text-[#6F6D67]">Benchmark Avg Tx Value</div>
                  <div className="text-lg font-semibold text-[#141413] mt-1">
                    {formatInrWhole(platformSettings.benchmarkAvgTransactionInr)}
                  </div>
                </div>
                <div className="border-t border-[#E5E3DD] pt-3">
                  <div className="text-[#6F6D67]">
                    Variable Cost ({platformSettings.benchmarkVariableCostPct}%)
                  </div>
                  <div className="text-lg font-semibold text-[#141413] mt-1">
                    {formatInrWhole(platformSettings.benchmarkVariableCostInr)}
                  </div>
                </div>
                <div className="border-t border-[#E5E3DD] pt-3">
                  <div className="text-[#6F6D67]">Contribution Margin / Benchmark Tx</div>
                  <div className="text-lg font-semibold text-[#15803D] mt-1">
                    {formatInr(allTimeModel.benchmarkContributionPerTxInr)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. SUPPLIER VERIFICATION */}
        {module === 'suppliers' && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Supplier Onboarding &amp; Verification Queue
              </h2>
              <p className="text-xs text-[#5A5852]">
                Approving or suspending a supplier automatically synchronizes public visibility
                across their bullion listings.
              </p>
            </div>
            {suppliers.length === 0 ? (
              <div className="p-8 text-sm text-[#5A5852]">No supplier applications registered yet.</div>
            ) : (
              <div className="divide-y divide-[#E5E3DD]">
                {suppliers.map((sup) => (
                  <div key={sup.id} className="p-6 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-[#141413]">{sup.businessName}</h3>
                        <p className="text-xs text-[#5A5852]">
                          {sup.jaipurLocality} · GSTIN <span className="font-mono">{sup.gstin}</span>{' '}
                          · BIS <span className="font-mono">{sup.bisLicenseNumber}</span>
                        </p>
                        <p className="text-xs text-[#6F6D67] mt-1">
                          Office: {sup.officeAddress} · Delivery Desk: {sup.deliveryCenter}
                        </p>
                        {sup.kycDocumentName && (
                          <p className="text-xs text-[#8A641E] mt-1">
                            KYC Doc: {sup.kycDocumentName}
                          </p>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-[#141413]">
                        Current: {sup.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <input
                        type="text"
                        value={remarksMap[sup.id] ?? sup.adminRemarks ?? ''}
                        onChange={(e) =>
                          setRemarksMap((prev) => ({ ...prev, [sup.id]: e.target.value }))
                        }
                        placeholder="Verification remarks for audit trail..."
                        className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-[#D4D1C8]"
                      />
                      {(['Under Review', 'Approved', 'Rejected', 'Suspended'] as SupplierStatus[]).map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              await adminUpdateSupplierStatus(
                                sup,
                                st,
                                remarksMap[sup.id] || `Status changed to ${st} by Super Admin.`
                              );
                              showToast('success', `${sup.businessName} marked ${st}.`);
                            }}
                            className={`px-3 py-1.5 text-xs font-medium border ${
                              st === 'Approved'
                                ? 'bg-[#15803D] text-white border-[#15803D]'
                                : st === 'Rejected' || st === 'Suspended'
                                ? 'border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]'
                                : 'border-[#D4D1C8] text-[#141413] hover:bg-[#F3F1EC]'
                            }`}
                          >
                            {st}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 3. JEWELLER MANAGEMENT */}
        {module === 'jewellers' && (
          <div className="space-y-6">
            <div className="bg-white border border-[#E5E3DD]">
              <div className="px-6 py-4 border-b border-[#E5E3DD]">
                <h2 className="text-2xl font-semibold text-[#141413]">
                  Jaipur Jeweller KYC Profiles ({jewellers.length})
                </h2>
              </div>
              {jewellers.length === 0 ? (
                <div className="p-8 text-xs text-[#6F6D67]">No jeweller profiles submitted yet.</div>
              ) : (
                <div className="divide-y divide-[#E5E3DD]">
                  {jewellers.map((j) => (
                    <div
                      key={j.id}
                      className="p-5 flex flex-wrap items-center justify-between gap-4 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-sm text-[#141413]">{j.shopName}</div>
                        <div className="text-[#5A5852]">
                          {j.ownerName} · {j.jaipurLocality} · GSTIN{' '}
                          <span className="font-mono">{j.gstin}</span>
                        </div>
                        <div className="text-[#6F6D67] mt-0.5">
                          KYC Status: <strong>{j.verificationStatus}</strong>
                          {j.kycDocumentName ? ` · Doc: ${j.kycDocumentName}` : ''}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {(['Approved', 'Under Review', 'Rejected'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              await adminUpdateJewellerVerification(j, st);
                              showToast('success', `${j.shopName} KYC updated to ${st}.`);
                            }}
                            className={`px-3 py-1.5 font-medium border ${
                              st === 'Approved'
                                ? 'bg-[#15803D] text-white border-[#15803D]'
                                : 'border-[#D4D1C8] hover:bg-[#F3F1EC]'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-[#E5E3DD] overflow-x-auto">
              <div className="px-6 py-4 border-b border-[#E5E3DD]">
                <h3 className="text-lg font-semibold text-[#141413]">
                  Registered User Accounts ({users.length})
                </h3>
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD]">
                    <th className="py-2.5 px-4 font-semibold">Name</th>
                    <th className="py-2.5 px-4 font-semibold">Email</th>
                    <th className="py-2.5 px-4 font-semibold">Role</th>
                    <th className="py-2.5 px-4 font-semibold">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E3DD]">
                  {users.map((u) => (
                    <tr key={u.uid}>
                      <td className="py-2.5 px-4 font-medium">{u.displayName}</td>
                      <td className="py-2.5 px-4 font-mono">{u.email}</td>
                      <td className="py-2.5 px-4">{u.role}</td>
                      <td className="py-2.5 px-4">{u.isActive ? 'Yes' : 'Disabled'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. ORDER MANAGEMENT */}
        {module === 'orders' && (
          <div className="bg-white border border-[#E5E3DD] overflow-x-auto">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                All Platform Bullion Orders ({orders.length})
              </h2>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD]">
                  <th className="py-3 px-4 font-semibold">Order</th>
                  <th className="py-3 px-4 font-semibold">Jeweller → Supplier</th>
                  <th className="py-3 px-4 font-semibold">Spec</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold text-right">GTV</th>
                  <th className="py-3 px-4 font-semibold text-right">Commission</th>
                  <th className="py-3 px-4 font-semibold text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E3DD]">
                {orders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-[#FAFAF8]">
                    <td className="py-3 px-4 font-mono font-semibold">{ord.orderNumber}</td>
                    <td className="py-3 px-4">
                      {ord.jewellerShopName} → {ord.supplierName}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">
                      {ord.weightGrams}g {ord.metal} {ord.purity}
                    </td>
                    <td className="py-3 px-4">{ord.status}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {ord.grossBullionValueInr ? formatInr(ord.grossBullionValueInr) : 'Floating'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-[#15803D]">
                      {ord.platformCommissionInr ? formatInr(ord.platformCommissionInr) : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onSelectOrder(ord)}
                        className="px-3 py-1 border border-[#D4D1C8] hover:bg-[#F3F1EC]"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 5. MCX RATE MONITOR & MANUAL OVERRIDE */}
        {module === 'mcx' && (
          <div className="space-y-6">
            <div className="bg-white border border-[#E5E3DD] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-2xl font-semibold text-[#141413]">
                    Live MCX Feed Diagnostics
                  </h2>
                  <p className="text-xs text-[#5A5852]">
                    Server endpoint: <span className="font-mono">/api/rates/mcx</span> (45s TTL,
                    zero paid API keys).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => refreshMcxRate(true)}
                  className="px-4 py-2 bg-[#141413] text-white text-xs font-medium"
                >
                  Force Live Upstream Check
                </button>
              </div>
              {mcxRate ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono tabular-nums bg-[#FAFAF8] border border-[#E5E3DD] p-4">
                  <div>
                    <div className="text-[#6F6D67]">Gold 999 / 10g</div>
                    <div className="font-semibold text-sm">{formatInr(mcxRate.gold999Per10g)}</div>
                  </div>
                  <div>
                    <div className="text-[#6F6D67]">Gold 995 / 10g</div>
                    <div className="font-semibold text-sm">{formatInr(mcxRate.gold995Per10g)}</div>
                  </div>
                  <div>
                    <div className="text-[#6F6D67]">Silver 999 / 1kg</div>
                    <div className="font-semibold text-sm">{formatInr(mcxRate.silver999Per1kg)}</div>
                  </div>
                  <div>
                    <div className="text-[#6F6D67]">Mode</div>
                    <div className="font-semibold text-sm">
                      {mcxRate.isManualOverride
                        ? 'Manual Override'
                        : mcxRate.isDelayed
                        ? 'Delayed Cache'
                        : 'Live Feed'}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#B91C1C]">
                  No live rate cached. Activate Manual Reference Override below if upstream public
                  sources are unreachable.
                </p>
              )}
            </div>

            <form onSubmit={handleSaveSettings} className="bg-white border border-[#E5E3DD] p-6 space-y-4">
              <h3 className="text-xl font-semibold text-[#141413]">
                Super Admin Manual Reference Rate Override
              </h3>
              <p className="text-xs text-[#5A5852]">
                When enabled, all UI tickers clearly display &ldquo;Delayed / Manual Reference
                Rate&rdquo; and use your specified Jaipur reference benchmarks until disabled.
              </p>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#141413]">
                <input
                  type="checkbox"
                  checked={settingsForm.manualOverrideEnabled}
                  onChange={(e) =>
                    setSettingsForm((s) => ({ ...s, manualOverrideEnabled: e.target.checked }))
                  }
                />
                Enable Manual Reference Rate Override
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Manual Gold 999 Rate (INR per 10g)
                  </label>
                  <input
                    type="number"
                    min={10000}
                    max={500000}
                    value={settingsForm.manualGold999Per10g || mcxRate?.gold999Per10g || 78500}
                    onChange={(e) =>
                      setSettingsForm((s) => ({
                        ...s,
                        manualGold999Per10g: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D4D1C8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Manual Silver 999 Rate (INR per 1kg)
                  </label>
                  <input
                    type="number"
                    min={10000}
                    max={500000}
                    value={settingsForm.manualSilver999Per1kg || mcxRate?.silver999Per1kg || 92000}
                    onChange={(e) =>
                      setSettingsForm((s) => ({
                        ...s,
                        manualSilver999Per1kg: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D4D1C8]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Override Reason (Audited)
                  </label>
                  <input
                    type="text"
                    value={settingsForm.manualOverrideReason || ''}
                    onChange={(e) =>
                      setSettingsForm((s) => ({ ...s, manualOverrideReason: e.target.value }))
                    }
                    placeholder="e.g. Weekend MCX closure / Jaipur Sarafa Association closing reference"
                    className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSettings}
                className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28]"
              >
                {savingSettings ? 'Saving...' : 'Save MCX Override Settings'}
              </button>
            </form>
          </div>
        )}

        {/* 6. COMMISSION & VENTURE FINANCIAL MODEL */}
        {module === 'commission' && (
          <form onSubmit={handleSaveSettings} className="bg-white border border-[#E5E3DD] p-6 space-y-5">
            <div className="border-b border-[#E5E3DD] pb-4">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Commission Governance &amp; Venture Plan Model
              </h2>
              <p className="text-xs text-[#5A5852]">
                Enforced cryptographically via Firestore Security Rules so suppliers cannot alter
                platform commission during quote locking.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Platform Commission Rate (% of Gross Bullion Value)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  max={10}
                  required
                  value={settingsForm.commissionRatePct}
                  onChange={(e) =>
                    setSettingsForm((s) => ({ ...s, commissionRatePct: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Applicable Bullion GST (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  max={28}
                  required
                  value={settingsForm.gstRatePct}
                  onChange={(e) =>
                    setSettingsForm((s) => ({ ...s, gstRatePct: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Venture Base Case: Avg Transaction Value (INR)
                </label>
                <input
                  type="number"
                  required
                  value={settingsForm.benchmarkAvgTransactionInr}
                  onChange={(e) =>
                    setSettingsForm((s) => ({
                      ...s,
                      benchmarkAvgTransactionInr: Number(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Venture Base Case: Monthly Fixed Cost (INR)
                </label>
                <input
                  type="number"
                  required
                  value={settingsForm.monthlyFixedCostInr}
                  onChange={(e) =>
                    setSettingsForm((s) => ({
                      ...s,
                      monthlyFixedCostInr: Number(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#D4D1C8]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28]"
            >
              {savingSettings ? 'Updating Model...' : 'Save Commission & Venture Settings'}
            </button>
          </form>
        )}

        {/* 7. FINANCIAL REPORTS & CSV EXPORT */}
        {module === 'reports' && (
          <div className="bg-white border border-[#E5E3DD] p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E3DD] pb-4">
              <div>
                <h2 className="text-2xl font-semibold text-[#141413]">
                  Financial Reports (Real Firestore Records Only)
                </h2>
                <p className="text-xs text-[#5A5852]">
                  Gross Transaction Value is strictly separated from Platform Commission Revenue.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex p-0.5 bg-[#F3F1EC]">
                  {(['daily', 'weekly', 'monthly', 'all'] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setReportWindow(w)}
                      className={`px-3 py-1.5 text-xs font-medium capitalize ${
                        reportWindow === w ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5A5852]'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="px-4 py-2 bg-[#141413] text-white text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-[#C99D44]" />
                  Export CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
              <div className="border border-[#E5E3DD] p-4 bg-[#FAFAF8]">
                <div className="text-[#6F6D67]">Locked Orders</div>
                <div className="text-xl font-semibold mt-1">
                  {financialModel.realLockedOrdersCount}
                </div>
              </div>
              <div className="border border-[#E5E3DD] p-4 bg-[#FAFAF8]">
                <div className="text-[#6F6D67]">Gross Bullion GTV</div>
                <div className="text-xl font-semibold mt-1">
                  {formatInr(financialModel.realGrossTransactionValueInr)}
                </div>
              </div>
              <div className="border border-[#E5E3DD] p-4 bg-[#FAFAF8]">
                <div className="text-[#6F6D67]">Platform Commission Revenue</div>
                <div className="text-xl font-semibold text-[#15803D] mt-1">
                  {formatInr(financialModel.realPlatformCommissionRevenueInr)}
                </div>
              </div>
              <div className="border border-[#E5E3DD] p-4 bg-[#FAFAF8]">
                <div className="text-[#6F6D67]">Real Avg Order Value</div>
                <div className="text-xl font-semibold mt-1">
                  {formatInr(financialModel.realAverageOrderValueInr)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 8. SETTLEMENTS */}
        {module === 'settlements' && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Supplier Settlements Ledger
              </h2>
            </div>
            {settlements.length === 0 ? (
              <div className="p-8 text-xs text-[#6F6D67]">No settlement entries yet.</div>
            ) : (
              <div className="divide-y divide-[#E5E3DD]">
                {settlements.map((s) => (
                  <div
                    key={s.id}
                    className="p-5 flex flex-wrap items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <div className="font-mono font-semibold text-[#141413]">
                        {s.orderNumber} · {s.supplierName}
                      </div>
                      <div className="font-mono text-[#5A5852] mt-0.5 tabular-nums">
                        GTV {formatInr(s.grossTransactionValueInr)} · Fee{' '}
                        {formatInr(s.platformCommissionInr)} ({s.platformCommissionRatePct}%) · Net{' '}
                        <strong>{formatInr(s.supplierNetPayableInr)}</strong>
                      </div>
                    </div>
                    {s.status === 'Settled' ? (
                      <span className="font-semibold text-[#15803D]">
                        Settled ({s.referenceNumber})
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={settlementRefMap[s.id] || ''}
                          onChange={(e) =>
                            setSettlementRefMap((p) => ({ ...p, [s.id]: e.target.value }))
                          }
                          placeholder="UTR / Settlement Ref"
                          className="px-2.5 py-1.5 text-xs font-mono border border-[#D4D1C8]"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const refNum = settlementRefMap[s.id]?.trim();
                            if (!refNum) {
                              showToast('error', 'Enter a bank UTR / settlement reference first.');
                              return;
                            }
                            await adminMarkSettlementSettled(
                              s.id,
                              s.supplierOwnerId,
                              s.orderNumber,
                              refNum
                            );
                            showToast('success', `Settlement ${s.orderNumber} marked Settled.`);
                          }}
                          className="px-3 py-1.5 bg-[#15803D] text-white font-medium"
                        >
                          Mark Settled
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 9. SUPPORT TICKETS WITH PRIVATE INTERNAL NOTES */}
        {module === 'support' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white border border-[#E5E3DD] p-4 space-y-2">
              <h2 className="text-xl font-semibold text-[#141413] mb-2">All Support Tickets</h2>
              {tickets.length === 0 ? (
                <p className="text-xs text-[#6F6D67]">No support tickets yet.</p>
              ) : (
                tickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTicket(t)}
                    className={`w-full text-left p-3 border text-xs ${
                      selectedTicket?.id === t.id
                        ? 'border-[#8A641E] bg-[#FAF6EE]'
                        : 'border-[#E5E3DD] hover:bg-[#FAFAF8]'
                    }`}
                  >
                    <div className="flex justify-between font-semibold">
                      <span>{t.ticketNumber}</span>
                      <span className="text-[#8A641E]">{t.status}</span>
                    </div>
                    <div className="text-[#141413] mt-0.5">{t.subject}</div>
                    <div className="text-[#6F6D67] mt-0.5">
                      {t.createdByName} ({t.createdByRole})
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="lg:col-span-7 bg-white border border-[#E5E3DD] p-5 space-y-4">
              {selectedTicket ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E3DD]">
                    <div>
                      <h3 className="text-lg font-semibold text-[#141413]">
                        {selectedTicket.ticketNumber}: {selectedTicket.subject}
                      </h3>
                      <p className="text-xs text-[#6F6D67]">
                        Raised by {selectedTicket.createdByName} · {selectedTicket.category}
                      </p>
                    </div>
                    <select
                      value={selectedTicket.status}
                      onChange={async (e) => {
                        const st = e.target.value as SupportTicketDoc['status'];
                        await adminUpdateTicketStatus(selectedTicket.id, st);
                        setSelectedTicket({ ...selectedTicket, status: st });
                        showToast('success', `Ticket status updated to ${st}.`);
                      }}
                      className="px-2.5 py-1.5 text-xs border border-[#D4D1C8] bg-white"
                    >
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Resolved">Resolved</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>

                  <div className="space-y-2.5 max-h-72 overflow-y-auto">
                    {ticketMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`p-3 border text-xs ${
                          m.isInternalNote
                            ? 'bg-[#FFFBEB] border-[#FDE68A]'
                            : 'bg-[#FAFAF8] border-[#E5E3DD]'
                        }`}
                      >
                        <div className="flex justify-between text-[11px] mb-1">
                          <span className="font-semibold text-[#141413]">
                            {m.senderName} ({m.senderRole})
                            {m.isInternalNote && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[#92400E]">
                                <Lock className="w-3 h-3" /> Private Admin Note
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[#6F6D67]">
                            {m.createdAt?.toDate
                              ? m.createdAt.toDate().toLocaleString('en-IN')
                              : ''}
                          </span>
                        </div>
                        <p className="text-[#3A3935]">{m.body}</p>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleAdminReply} className="space-y-2.5 pt-2 border-t border-[#E5E3DD]">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-[#92400E]">
                      <input
                        type="checkbox"
                        checked={isInternalNote}
                        onChange={(e) => setIsInternalNote(e.target.checked)}
                      />
                      Post as Private Internal Note (strictly hidden from customer via Firestore
                      Rules)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        required
                        value={adminReply}
                        onChange={(e) => setAdminReply(e.target.value)}
                        placeholder={
                          isInternalNote ? 'Write private internal audit note...' : 'Reply to customer...'
                        }
                        className="flex-1 px-3 py-2 text-xs border border-[#D4D1C8]"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#141413] text-white text-xs font-medium"
                      >
                        {isInternalNote ? 'Save Note' : 'Send Reply'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <p className="text-xs text-[#6F6D67]">Select a ticket on the left to respond.</p>
              )}
            </div>
          </div>
        )}

        {/* 10. AUDIT LOGS */}
        {module === 'audit' && (
          <div className="bg-white border border-[#E5E3DD] overflow-x-auto">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Immutable Platform Audit Logs
              </h2>
            </div>
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD]">
                  <th className="py-2.5 px-4 font-semibold">Timestamp (IST)</th>
                  <th className="py-2.5 px-4 font-semibold">Actor</th>
                  <th className="py-2.5 px-4 font-semibold">Action</th>
                  <th className="py-2.5 px-4 font-semibold">Target</th>
                  <th className="py-2.5 px-4 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E3DD]">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      {log.createdAt?.toDate
                        ? log.createdAt.toDate().toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                          })
                        : ''}
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      {log.actorEmail} ({log.actorRole})
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold">{log.action}</td>
                    <td className="py-2.5 px-4 font-mono">
                      {log.targetCollection}/{log.targetId}
                    </td>
                    <td className="py-2.5 px-4 text-[#4B4A45]">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
