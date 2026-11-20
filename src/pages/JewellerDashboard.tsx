import React, { useEffect, useState } from 'react';
import {
  Building2,
  Download,
  FileText,
  LifeBuoy,
  PackageCheck,
  Receipt,
  Scale,
  Upload,
} from 'lucide-react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import {
  createSupportTicket,
  saveJewellerProfile,
  sendSupportMessage,
  uploadDocumentFile,
} from '../lib/firestoreService';
import { downloadGstInvoiceHtml } from '../lib/invoicePdf';
import {
  calculateBullionPricing,
  formatInr,
  getEffectiveOrderPricing,
  getMcxRatePerUnit,
} from '../lib/pricing';
import {
  JAIPUR_LOCALITIES,
  type BullionListingDoc,
  type InvoiceDoc,
  type JewellerProfileDoc,
  type OrderDoc,
  type SupportMessageDoc,
  type SupportTicketDoc,
} from '../types/bullion';

type TabKey = 'listings' | 'orders' | 'documents' | 'profile' | 'support';

interface JewellerDashboardProps {
  onRequestQuote: (listing: BullionListingDoc, shopName: string) => void;
  onSelectOrder: (order: OrderDoc) => void;
}

export function JewellerDashboard({
  onRequestQuote,
  onSelectOrder,
}: JewellerDashboardProps) {
  const { firebaseUser, mcxRate, platformSettings, publicListings, showToast } = useApp();

  const [tab, setTab] = useState<TabKey>('listings');
  const [profile, setProfile] = useState<JewellerProfileDoc | null>(null);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [tickets, setTickets] = useState<SupportTicketDoc[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketDoc | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportMessageDoc[]>([]);

  // Profile form state
  const [shopName, setShopName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [gstin, setGstin] = useState('');
  const [pan, setPan] = useState('');
  const [jaipurLocality, setJaipurLocality] = useState<string>(JAIPUR_LOCALITIES[0]);
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Support ticket form state
  const [tktSubject, setTktSubject] = useState('');
  const [tktCategory, setTktCategory] = useState<SupportTicketDoc['category']>('Order Issue');
  const [tktPriority, setTktPriority] = useState<SupportTicketDoc['priority']>('Medium');
  const [tktMessage, setTktMessage] = useState('');
  const [replyText, setReplyText] = useState('');
  const [creatingTicket, setCreatingTicket] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;

    const unsubProfile = onSnapshot(
      doc(db, 'jeweller_profiles', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...(snap.data() as Omit<JewellerProfileDoc, 'id'>) };
          setProfile(data);
          setShopName(data.shopName);
          setOwnerName(data.ownerName);
          setGstin(data.gstin);
          setPan(data.pan || '');
          setJaipurLocality(data.jaipurLocality);
          setAddress(data.address || '');
          setContactPhone(data.contactPhone || '');
        }
      },
      (err) => console.error('jeweller_profiles listener:', err)
    );

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('jewellerId', '==', firebaseUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<OrderDoc, 'id'>) }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setOrders(list);
      },
      (err) => console.error('jeweller orders listener:', err)
    );

    const unsubInvoices = onSnapshot(
      query(collection(db, 'invoices'), where('jewellerId', '==', firebaseUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<InvoiceDoc, 'id'>) }))
          .sort((a, b) => (b.issuedAt?.toMillis?.() || 0) - (a.issuedAt?.toMillis?.() || 0));
        setInvoices(list);
      },
      (err) => console.error('jeweller invoices listener:', err)
    );

    const unsubTickets = onSnapshot(
      query(collection(db, 'support_tickets'), where('createdByUid', '==', firebaseUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SupportTicketDoc, 'id'>) }))
          .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
        setTickets(list);
      },
      (err) => console.error('jeweller support_tickets listener:', err)
    );

    return () => {
      unsubProfile();
      unsubOrders();
      unsubInvoices();
      unsubTickets();
    };
  }, [firebaseUser]);

  useEffect(() => {
    if (!selectedTicket || !firebaseUser) {
      setTicketMessages([]);
      return;
    }
    const unsub = onSnapshot(
      query(
        collection(db, 'support_messages'),
        where('ticketId', '==', selectedTicket.id),
        where('ticketOwnerId', '==', firebaseUser.uid),
        where('isInternalNote', '==', false)
      ),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SupportMessageDoc, 'id'>) }))
          .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));
        setTicketMessages(list);
      },
      (err) => console.error('jeweller support_messages listener:', err)
    );
    return () => unsub();
  }, [selectedTicket?.id, firebaseUser]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setSavingProfile(true);
    try {
      let kycDocumentUrl = profile?.kycDocumentUrl;
      let kycDocumentName = profile?.kycDocumentName;
      if (kycFile) {
        const uploaded = await uploadDocumentFile(`jeweller_kyc/${firebaseUser.uid}`, kycFile);
        kycDocumentUrl = uploaded.url || kycDocumentUrl;
        kycDocumentName = uploaded.fileName;
      }
      await saveJewellerProfile(firebaseUser.uid, {
        shopName,
        ownerName,
        gstin,
        pan,
        jaipurLocality,
        address,
        contactPhone,
        kycDocumentUrl,
        kycDocumentName,
      });
      setKycFile(null);
      showToast('success', 'Jaipur Jeweller business profile & KYC saved.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setCreatingTicket(true);
    try {
      await createSupportTicket({
        createdByName: profile?.shopName || firebaseUser.displayName || 'Jeweller',
        createdByRole: 'jeweller',
        subject: tktSubject,
        category: tktCategory,
        priority: tktPriority,
        initialMessage: tktMessage,
      });
      setTktSubject('');
      setTktMessage('');
      showToast('success', 'Support ticket opened.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to open ticket.');
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim() || !firebaseUser) return;
    try {
      await sendSupportMessage({
        ticketId: selectedTicket.id,
        ticketOwnerId: firebaseUser.uid,
        senderName: profile?.shopName || firebaseUser.displayName || 'Jeweller',
        senderRole: 'jeweller',
        body: replyText,
        isInternalNote: false,
      });
      setReplyText('');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to send reply.');
    }
  };

  const activeOrdersCount = orders.filter(
    (o) => !['Completed', 'Cancelled', 'Rejected'].includes(o.status)
  ).length;
  const totalCompletedVolume = orders
    .filter((o) => o.status === 'Completed' && o.grossBullionValueInr)
    .reduce((sum, o) => sum + (o.grossBullionValueInr || 0), 0);

  const navItems: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'listings', label: 'Live Bullion Board', icon: <Scale className="w-4 h-4" /> },
    { key: 'orders', label: `Orders & Quotes (${orders.length})`, icon: <PackageCheck className="w-4 h-4" /> },
    { key: 'documents', label: `Tax Invoices (${invoices.length})`, icon: <Receipt className="w-4 h-4" /> },
    { key: 'profile', label: 'Shop Profile & KYC', icon: <Building2 className="w-4 h-4" /> },
    { key: 'support', label: `Support Desk (${tickets.length})`, icon: <LifeBuoy className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
      {/* Sidebar Navigation */}
      <aside className="lg:col-span-3 space-y-6">
        <div className="bg-white border border-[#E5E3DD] p-5">
          <p className="text-xs text-[#8A641E] font-medium mb-1">Jeweller Workspace</p>
          <h1 className="text-2xl font-semibold text-[#141413] truncate">
            {profile?.shopName || firebaseUser?.displayName || 'Jaipur Jeweller'}
          </h1>
          <p className="text-xs text-[#5A5852] mt-1">
            {profile
              ? `${profile.jaipurLocality} · KYC ${profile.verificationStatus}`
              : 'Complete business KYC to unlock full trade records'}
          </p>
        </div>

        <nav className="bg-white border border-[#E5E3DD] divide-y divide-[#E5E3DD]">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 transition-colors ${
                tab === item.key
                  ? 'bg-[#141413] text-white'
                  : 'text-[#4B4A45] hover:bg-[#FAFAF8] hover:text-[#141413]'
              }`}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="bg-white border border-[#E5E3DD] p-5 space-y-3 text-xs">
          <div className="flex justify-between">
            <span className="text-[#6F6D67]">Active Orders</span>
            <span className="font-mono font-semibold tabular-nums">{activeOrdersCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6F6D67]">Completed Volume</span>
            <span className="font-mono font-semibold tabular-nums">
              {formatInr(totalCompletedVolume)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6F6D67]">Platform Fee</span>
            <span className="font-mono tabular-nums">{platformSettings.commissionRatePct}%</span>
          </div>
        </div>
      </aside>

      {/* Main Content Canvas */}
      <main className="lg:col-span-9 space-y-6">
        {tab === 'listings' && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-2xl font-semibold text-[#141413]">
                  Verified Bullion Listings
                </h2>
                <p className="text-xs text-[#5A5852]">
                  Live MCX base + supplier premium + {platformSettings.commissionRatePct}% platform
                  commission + {platformSettings.gstRatePct}% GST.
                </p>
              </div>
              <span className="text-xs font-mono text-[#6F6D67] tabular-nums">
                {publicListings.length} active offers
              </span>
            </div>

            {publicListings.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A5852]">
                No approved supplier listings are currently active. Approved Jaipur suppliers will
                appear here immediately upon publishing inventory.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD] text-[#4B4A45]">
                      <th className="py-3 px-4 font-semibold">Supplier &amp; Listing</th>
                      <th className="py-3 px-4 font-semibold">Metal / Purity</th>
                      <th className="py-3 px-4 font-semibold text-right">MCX Base</th>
                      <th className="py-3 px-4 font-semibold text-right">Premium</th>
                      <th className="py-3 px-4 font-semibold text-right">Est. / Unit (+Fee/GST)</th>
                      <th className="py-3 px-4 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E3DD]">
                    {publicListings.map((l) => {
                      const unitGrams = l.metal === 'GOLD' ? 10 : 1000;
                      const unitLabel = l.metal === 'GOLD' ? '10g' : '1kg';
                      const base = mcxRate ? getMcxRatePerUnit(mcxRate, l.metal, l.purity) : 0;
                      const calc = mcxRate
                        ? calculateBullionPricing({
                            metal: l.metal,
                            purity: l.purity,
                            weightGrams: unitGrams,
                            mcxBaseRatePerUnit: base,
                            supplierPremiumPerUnitInr: l.premiumPerUnitInr,
                            platformCommissionRatePct: platformSettings.commissionRatePct,
                            gstRatePct: platformSettings.gstRatePct,
                          })
                        : null;
                      return (
                        <tr key={l.id} className="hover:bg-[#FAFAF8]">
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-[#141413]">{l.title}</div>
                            <div className="text-[#6F6D67]">
                              {l.supplierName} · {l.jaipurLocality}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono">
                            {l.metal} {l.purity} ({l.form})
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                            {mcxRate ? `${formatInr(base)}/${unitLabel}` : '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#8A641E]">
                            +{formatInr(l.premiumPerUnitInr)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums">
                            {calc ? formatInr(calc.finalPayableTotalInr) : '—'}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                onRequestQuote(
                                  l,
                                  profile?.shopName ||
                                    firebaseUser?.displayName ||
                                    'Jaipur Jeweller'
                                )
                              }
                              className="px-3.5 py-1.5 bg-[#141413] text-white font-medium hover:bg-[#2A2A28] whitespace-nowrap"
                            >
                              Request Quote
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'orders' && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                My Quotes &amp; Order History
              </h2>
              <p className="text-xs text-[#5A5852]">
                Click any order to inspect live/locked pricing, purity certificates, tax invoice,
                and workflow actions.
              </p>
            </div>
            {orders.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A5852]">
                You have not submitted any bullion quotes yet. Browse the Live Bullion Board to
                submit your first Buy, Sell, or Exchange request.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD] text-[#4B4A45]">
                      <th className="py-3 px-4 font-semibold">Order</th>
                      <th className="py-3 px-4 font-semibold">Supplier</th>
                      <th className="py-3 px-4 font-semibold">Spec</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Payable Total</th>
                      <th className="py-3 px-4 font-semibold text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E3DD]">
                    {orders.map((ord) => {
                      const { isFloating, breakdown } = getEffectiveOrderPricing(ord, mcxRate);
                      return (
                        <tr key={ord.id} className="hover:bg-[#FAFAF8]">
                          <td className="py-3.5 px-4">
                            <div className="font-mono font-semibold text-[#141413]">
                              {ord.orderNumber}
                            </div>
                            <div className="text-[11px] text-[#6F6D67]">
                              {ord.orderType} · {isFloating ? 'Floating MCX' : 'Rate Locked'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">{ord.supplierName}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums">
                            {ord.weightGrams}g {ord.metal} {ord.purity}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-[#141413]">{ord.status}</td>
                          <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums">
                            {formatInr(breakdown.finalPayableTotalInr)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onSelectOrder(ord)}
                              className="px-3 py-1.5 border border-[#D4D1C8] text-[#141413] hover:bg-[#F3F1EC] font-medium whitespace-nowrap"
                            >
                              Manage
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'documents' && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">GST Tax Invoices Archive</h2>
              <p className="text-xs text-[#5A5852]">
                Permanent transaction invoices generated from locked MCX price snapshots.
              </p>
            </div>
            {invoices.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A5852]">
                No GST tax invoices issued yet. Invoices appear automatically once your supplier
                generates them on a locked order.
              </div>
            ) : (
              <div className="divide-y divide-[#E5E3DD]">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs"
                  >
                    <div>
                      <div className="font-mono font-semibold text-[#141413]">
                        {inv.invoiceNumber}
                      </div>
                      <div className="text-[#5A5852] mt-0.5">
                        {inv.supplierName} · {inv.weightGrams}g {inv.metal} {inv.purity}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right font-mono tabular-nums">
                        <div className="font-semibold text-[#141413]">
                          {formatInr(inv.finalPayableTotalInr)}
                        </div>
                        <div className="text-[11px] text-[#6F6D67]">
                          GTV {formatInr(inv.grossBullionValueInr)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadGstInvoiceHtml(inv)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-[#D4D1C8] hover:bg-[#F3F1EC] font-medium"
                      >
                        <Download className="w-3.5 h-3.5 text-[#8A641E]" />
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="bg-white border border-[#E5E3DD] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E5E3DD]">
              <div>
                <h2 className="text-2xl font-semibold text-[#141413]">
                  Jeweller Business Profile &amp; KYC
                </h2>
                <p className="text-xs text-[#5A5852]">
                  Used on quotes, GST tax invoices, and Super Admin trade verification.
                </p>
              </div>
              <span className="text-xs font-semibold text-[#8A641E]">
                KYC Status: {profile?.verificationStatus || 'Not Submitted'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Jewellery Shop / Firm Name
                </label>
                <input
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  placeholder="e.g. Johari Heritage Jewels Pvt Ltd"
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Proprietor / Purchasing Manager Name
                </label>
                <input
                  type="text"
                  required
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">GSTIN</label>
                <input
                  type="text"
                  required
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder="08ABCDE1234F1Z5"
                  className="w-full px-3 py-2 text-sm font-mono uppercase border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">PAN Number</label>
                <input
                  type="text"
                  value={pan}
                  onChange={(e) => setPan(e.target.value)}
                  placeholder="ABCDE1234F"
                  className="w-full px-3 py-2 text-sm font-mono uppercase border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Jaipur Locality / Market Cluster
                </label>
                <select
                  value={jaipurLocality}
                  onChange={(e) => setJaipurLocality(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8] bg-white"
                >
                  {JAIPUR_LOCALITIES.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Contact Phone
                </label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+91 98290 XXXXX"
                  className="w-full px-3 py-2 text-sm font-mono border border-[#D4D1C8]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Shop / Showroom Address (Jaipur)
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shop No. 42, Johari Bazaar Main Road, Jaipur 302003"
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Upload GST / PAN KYC Document (PDF or Image)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setKycFile(e.target.files?.[0] || null)}
                    className="text-xs text-[#4B4A45]"
                  />
                  {profile?.kycDocumentName && (
                    <span className="inline-flex items-center gap-1 text-xs text-[#15803D]">
                      <FileText className="w-3.5 h-3.5" />
                      On file: {profile.kycDocumentName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] inline-flex items-center gap-2"
            >
              <Upload className="w-3.5 h-3.5 text-[#C99D44]" />
              {savingProfile ? 'Saving Profile...' : 'Save Business Profile & KYC'}
            </button>
          </form>
        )}

        {tab === 'support' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleCreateTicket}
              className="lg:col-span-5 bg-white border border-[#E5E3DD] p-5 space-y-3.5 h-fit"
            >
              <h2 className="text-xl font-semibold text-[#141413]">Open Support Ticket</h2>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">Subject</label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={tktSubject}
                  onChange={(e) => setTktSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={tktCategory}
                  onChange={(e) => setTktCategory(e.target.value as SupportTicketDoc['category'])}
                  className="px-2.5 py-2 text-xs border border-[#D4D1C8] bg-white"
                >
                  <option value="Order Issue">Order Issue</option>
                  <option value="Purity Dispute">Purity Dispute</option>
                  <option value="KYC / Verification">KYC / Verification</option>
                  <option value="Settlement / Invoice">Settlement / Invoice</option>
                  <option value="General">General</option>
                </select>
                <select
                  value={tktPriority}
                  onChange={(e) => setTktPriority(e.target.value as SupportTicketDoc['priority'])}
                  className="px-2.5 py-2 text-xs border border-[#D4D1C8] bg-white"
                >
                  <option value="Low">Low Priority</option>
                  <option value="Medium">Medium Priority</option>
                  <option value="High">High Priority</option>
                </select>
              </div>
              <textarea
                rows={3}
                required
                value={tktMessage}
                onChange={(e) => setTktMessage(e.target.value)}
                placeholder="Describe order number or issue clearly..."
                className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
              />
              <button
                type="submit"
                disabled={creatingTicket}
                className="w-full py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28]"
              >
                {creatingTicket ? 'Submitting...' : 'Submit Ticket'}
              </button>
            </form>

            <div className="lg:col-span-7 bg-white border border-[#E5E3DD] p-5 space-y-4">
              <h2 className="text-xl font-semibold text-[#141413]">Your Support Threads</h2>
              {tickets.length === 0 ? (
                <p className="text-xs text-[#6F6D67]">No support tickets raised yet.</p>
              ) : (
                <div className="space-y-2">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTicket(t)}
                      className={`w-full text-left p-3 border text-xs transition-colors ${
                        selectedTicket?.id === t.id
                          ? 'border-[#8A641E] bg-[#FAF6EE]'
                          : 'border-[#E5E3DD] hover:bg-[#FAFAF8]'
                      }`}
                    >
                      <div className="flex justify-between font-semibold text-[#141413]">
                        <span>
                          {t.ticketNumber} · {t.subject}
                        </span>
                        <span className="text-[#8A641E]">{t.status}</span>
                      </div>
                      <div className="text-[#6F6D67] mt-0.5">
                        {t.category} · {t.priority} Priority
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedTicket && (
                <div className="pt-4 border-t border-[#E5E3DD] space-y-3">
                  <div className="text-xs font-semibold text-[#141413]">
                    Conversation: {selectedTicket.ticketNumber}
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {ticketMessages.map((m) => (
                      <div key={m.id} className="p-3 bg-[#FAFAF8] border border-[#E5E3DD] text-xs">
                        <div className="flex justify-between text-[11px] text-[#6F6D67] mb-1">
                          <span className="font-semibold text-[#141413]">
                            {m.senderName} ({m.senderRole})
                          </span>
                          <span className="font-mono">
                            {m.createdAt?.toDate
                              ? m.createdAt.toDate().toLocaleString('en-IN')
                              : ''}
                          </span>
                        </div>
                        <p className="text-[#3A3935]">{m.body}</p>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleSendReply} className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write a reply..."
                      className="flex-1 px-3 py-2 text-xs border border-[#D4D1C8]"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-[#141413] text-white text-xs font-medium"
                    >
                      Send
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
