import React, { useEffect, useState } from 'react';
import {
  Building2,
  Coins,
  IndianRupee,
  PackageCheck,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import {
  addSupplierStaff,
  createOrUpdateListing,
  deleteListing,
  removeSupplierStaff,
  saveSupplierApplication,
  uploadDocumentFile,
} from '../lib/firestoreService';
import {
  calculateBullionPricing,
  formatInr,
  getEffectiveOrderPricing,
  getMcxRatePerUnit,
} from '../lib/pricing';
import {
  JAIPUR_LOCALITIES,
  type BullionForm,
  type BullionListingDoc,
  type MetalType,
  type OrderDoc,
  type PurityGrade,
  type SettlementDoc,
  type SupplierDoc,
  type SupplierStaffDoc,
} from '../types/bullion';

type SupplierTab = 'orders' | 'listings' | 'settlements' | 'staff' | 'profile';

interface SupplierDashboardProps {
  onSelectOrder: (order: OrderDoc) => void;
}

export function SupplierDashboard({ onSelectOrder }: SupplierDashboardProps) {
  const { firebaseUser, effectiveRole, mcxRate, platformSettings, showToast } = useApp();
  const isStaff = effectiveRole === 'supplier_staff';

  const [tab, setTab] = useState<SupplierTab>('orders');
  const [supplier, setSupplier] = useState<SupplierDoc | null>(null);
  const [listings, setListings] = useState<BullionListingDoc[]>([]);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [settlements, setSettlements] = useState<SettlementDoc[]>([]);
  const [staffList, setStaffList] = useState<SupplierStaffDoc[]>([]);

  // Supplier onboarding/profile fields
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [bisLicenseNumber, setBisLicenseNumber] = useState('');
  const [assayingPartner, setAssayingPartner] = useState('');
  const [jaipurLocality, setJaipurLocality] = useState<string>(JAIPUR_LOCALITIES[0]);
  const [officeAddress, setOfficeAddress] = useState('');
  const [deliveryCenter, setDeliveryCenter] = useState('');
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Listing creator form
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [metal, setMetal] = useState<MetalType>('GOLD');
  const [purity, setPurity] = useState<PurityGrade>('999');
  const [form, setForm] = useState<BullionForm>('Bar');
  const [title, setTitle] = useState('999.9 Fine Gold Bullion Bar (Jaipur Desk)');
  const [minWeight, setMinWeight] = useState(10);
  const [maxWeight, setMaxWeight] = useState(1000);
  const [stockGrams, setStockGrams] = useState(5000);
  const [premiumPerUnit, setPremiumPerUnit] = useState(350);
  const [supportsBuy, setSupportsBuy] = useState(true);
  const [supportsSell, setSupportsSell] = useState(true);
  const [supportsExchange, setSupportsExchange] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [savingListing, setSavingListing] = useState(false);

  // Staff creator form
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffDesignation, setStaffDesignation] = useState('Desk Operations Executive');
  const [canLockRates, setCanLockRates] = useState(true);
  const [canUploadPurityDocs, setCanUploadPurityDocs] = useState(true);

  useEffect(() => {
    if (!firebaseUser) return;

    const unsubOrders = onSnapshot(
      isStaff
        ? query(
            collection(db, 'orders'),
            where('assignedStaffUids', 'array-contains', firebaseUser.uid)
          )
        : query(collection(db, 'orders'), where('supplierOwnerId', '==', firebaseUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<OrderDoc, 'id'>) }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setOrders(list);
      },
      (err) => console.error('supplier orders listener:', err)
    );

    if (isStaff) {
      return () => unsubOrders();
    }

    const unsubSup = onSnapshot(
      query(collection(db, 'suppliers'), where('ownerUserId', '==', firebaseUser.uid)),
      (snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = { id: d.id, ...(d.data() as Omit<SupplierDoc, 'id'>) };
          setSupplier(data);
          setBusinessName(data.businessName);
          setGstin(data.gstin);
          setBisLicenseNumber(data.bisLicenseNumber);
          setAssayingPartner(data.assayingPartner || '');
          setJaipurLocality(data.jaipurLocality);
          setOfficeAddress(data.officeAddress);
          setDeliveryCenter(data.deliveryCenter);
        } else {
          setSupplier(null);
          setTab('profile');
        }
      },
      (err) => console.error('supplier doc listener:', err)
    );

    const unsubListings = onSnapshot(
      query(collection(db, 'bullion_listings'), where('supplierOwnerId', '==', firebaseUser.uid)),
      (snap) => {
        setListings(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BullionListingDoc, 'id'>) }))
        );
      },
      (err) => console.error('supplier listings listener:', err)
    );

    const unsubSettlements = onSnapshot(
      query(collection(db, 'settlements'), where('supplierOwnerId', '==', firebaseUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<SettlementDoc, 'id'>) }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setSettlements(list);
      },
      (err) => console.error('supplier settlements listener:', err)
    );

    const unsubStaff = onSnapshot(
      query(collection(db, 'supplier_staff'), where('supplierOwnerId', '==', firebaseUser.uid)),
      (snap) => {
        setStaffList(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupplierStaffDoc, 'id'>) }))
        );
      },
      (err) => console.error('supplier staff listener:', err)
    );

    return () => {
      unsubOrders();
      unsubSup();
      unsubListings();
      unsubSettlements();
      unsubStaff();
    };
  }, [firebaseUser, isStaff]);

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setSavingSupplier(true);
    try {
      let kycDocumentUrl = supplier?.kycDocumentUrl;
      let kycDocumentName = supplier?.kycDocumentName;
      if (kycFile) {
        const uploaded = await uploadDocumentFile(`supplier_kyc/${firebaseUser.uid}`, kycFile);
        kycDocumentUrl = uploaded.url || kycDocumentUrl;
        kycDocumentName = uploaded.fileName;
      }
      await saveSupplierApplication(firebaseUser.uid, supplier?.id || null, {
        businessName,
        gstin,
        bisLicenseNumber,
        assayingPartner,
        jaipurLocality,
        officeAddress,
        deliveryCenter,
        kycDocumentUrl,
        kycDocumentName,
      });
      setKycFile(null);
      showToast(
        'success',
        supplier
          ? 'Supplier profile updated.'
          : 'Supplier onboarding application submitted for Super Admin review.'
      );
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save supplier profile.');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleSaveListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplier) {
      showToast('error', 'Submit your Supplier verification profile first.');
      return;
    }
    setSavingListing(true);
    try {
      await createOrUpdateListing(supplier, editingListingId, {
        metal,
        purity,
        form,
        title,
        unitGrams: metal === 'GOLD' ? 10 : 1000,
        minWeightGrams: minWeight,
        maxWeightGrams: maxWeight,
        availableStockGrams: stockGrams,
        premiumPerUnitInr: premiumPerUnit,
        deliveryCenter: supplier.deliveryCenter,
        supportsBuy,
        supportsSell,
        supportsExchange,
        isActive,
      });
      setEditingListingId(null);
      showToast('success', editingListingId ? 'Listing updated.' : 'Bullion listing published.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save listing.');
    } finally {
      setSavingListing(false);
    }
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplier) return;
    try {
      await addSupplierStaff(supplier, {
        staffEmail,
        staffName,
        designation: staffDesignation,
        canLockRates,
        canUploadPurityDocs,
      });
      setStaffEmail('');
      setStaffName('');
      showToast('success', 'Authorized staff member added.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to add staff.');
    }
  };

  const previewBase = mcxRate ? getMcxRatePerUnit(mcxRate, metal, purity) : 0;
  const previewCalc = mcxRate
    ? calculateBullionPricing({
        metal,
        purity,
        weightGrams: metal === 'GOLD' ? 10 : 1000,
        mcxBaseRatePerUnit: previewBase,
        supplierPremiumPerUnitInr: premiumPerUnit,
        platformCommissionRatePct: platformSettings.commissionRatePct,
        gstRatePct: platformSettings.gstRatePct,
      })
    : null;

  const totalNetEarnings = settlements.reduce((sum, s) => sum + s.supplierNetPayableInr, 0);

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
      <aside className="lg:col-span-3 space-y-6">
        <div className="bg-white border border-[#E5E3DD] p-5">
          <p className="text-xs text-[#8A641E] font-medium mb-1">
            {isStaff ? 'Authorized Supplier Staff' : 'Bullion Supplier Partner'}
          </p>
          <h1 className="text-2xl font-semibold text-[#141413] truncate">
            {supplier?.businessName || firebaseUser?.displayName || 'Supplier Desk'}
          </h1>
          {supplier && (
            <p
              className={`text-xs font-semibold mt-1.5 ${
                supplier.status === 'Approved'
                  ? 'text-[#15803D]'
                  : supplier.status === 'Rejected' || supplier.status === 'Suspended'
                  ? 'text-[#B91C1C]'
                  : 'text-[#B45309]'
              }`}
            >
              Verification Status: {supplier.status}
            </p>
          )}
          {supplier && supplier.status !== 'Approved' && (
            <p className="text-[11px] text-[#6F6D67] mt-1">
              Only Approved suppliers appear publicly in the Jaipur marketplace.
            </p>
          )}
        </div>

        <nav className="bg-white border border-[#E5E3DD] divide-y divide-[#E5E3DD]">
          <button
            type="button"
            onClick={() => setTab('orders')}
            className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 ${
              tab === 'orders' ? 'bg-[#141413] text-white' : 'text-[#4B4A45] hover:bg-[#FAFAF8]'
            }`}
          >
            <PackageCheck className="w-4 h-4" />
            Incoming Quotes &amp; Orders ({orders.length})
          </button>
          {!isStaff && (
            <>
              <button
                type="button"
                onClick={() => setTab('listings')}
                className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 ${
                  tab === 'listings'
                    ? 'bg-[#141413] text-white'
                    : 'text-[#4B4A45] hover:bg-[#FAFAF8]'
                }`}
              >
                <Coins className="w-4 h-4" />
                Inventory &amp; Premiums ({listings.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('settlements')}
                className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 ${
                  tab === 'settlements'
                    ? 'bg-[#141413] text-white'
                    : 'text-[#4B4A45] hover:bg-[#FAFAF8]'
                }`}
              >
                <IndianRupee className="w-4 h-4" />
                Settlement Ledger ({settlements.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('staff')}
                className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 ${
                  tab === 'staff' ? 'bg-[#141413] text-white' : 'text-[#4B4A45] hover:bg-[#FAFAF8]'
                }`}
              >
                <Users className="w-4 h-4" />
                Authorized Staff ({staffList.length})
              </button>
              <button
                type="button"
                onClick={() => setTab('profile')}
                className={`w-full px-4 py-3 text-left text-xs font-medium flex items-center gap-3 ${
                  tab === 'profile'
                    ? 'bg-[#141413] text-white'
                    : 'text-[#4B4A45] hover:bg-[#FAFAF8]'
                }`}
              >
                <Building2 className="w-4 h-4" />
                Verification &amp; Credentials
              </button>
            </>
          )}
        </nav>

        {!isStaff && (
          <div className="bg-white border border-[#E5E3DD] p-5 space-y-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-[#6F6D67]">Net Ledger Value</span>
              <span className="font-mono font-semibold tabular-nums">
                {formatInr(totalNetEarnings)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6F6D67]">Platform Commission</span>
              <span className="font-mono tabular-nums text-[#8A641E]">
                {platformSettings.commissionRatePct}% (Locked by Admin)
              </span>
            </div>
          </div>
        )}
      </aside>

      <main className="lg:col-span-9 space-y-6">
        {tab === 'orders' && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Incoming Quote Requests &amp; Active Orders
              </h2>
              <p className="text-xs text-[#5A5852]">
                Pending quotes update dynamically with live MCX prices. Open an order to confirm
                &amp; lock rate, upload purity certificates, or issue GST invoices.
              </p>
            </div>
            {orders.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A5852]">
                No quote requests received yet. Ensure your Supplier Verification is Approved and at
                least one bullion listing is active.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD] text-[#4B4A45]">
                      <th className="py-3 px-4 font-semibold">Order</th>
                      <th className="py-3 px-4 font-semibold">Jeweller</th>
                      <th className="py-3 px-4 font-semibold">Bullion</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                      <th className="py-3 px-4 font-semibold text-right">Live / Locked Total</th>
                      <th className="py-3 px-4 font-semibold text-right">Action</th>
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
                              {ord.orderType} · {isFloating ? 'Live Floating' : 'Rate Locked'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4">{ord.jewellerShopName}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums">
                            {ord.weightGrams}g {ord.metal} {ord.purity}
                          </td>
                          <td className="py-3.5 px-4 font-medium">{ord.status}</td>
                          <td className="py-3.5 px-4 text-right font-mono font-semibold tabular-nums">
                            {formatInr(breakdown.finalPayableTotalInr)}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => onSelectOrder(ord)}
                              className="px-3.5 py-1.5 bg-[#141413] text-white font-medium hover:bg-[#2A2A28] whitespace-nowrap"
                            >
                              {ord.status === 'Quote Requested' ? 'Review & Lock' : 'Open Order'}
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

        {tab === 'listings' && !isStaff && (
          <div className="space-y-6">
            <form onSubmit={handleSaveListing} className="bg-white border border-[#E5E3DD] p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#E5E3DD] pb-3">
                <h2 className="text-2xl font-semibold text-[#141413]">
                  {editingListingId ? 'Edit Bullion Listing' : 'Publish Live MCX-Linked Listing'}
                </h2>
                <span className="text-xs font-mono text-[#6F6D67]">
                  Commission Fixed: {platformSettings.commissionRatePct}%
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">Metal</label>
                  <select
                    value={metal}
                    disabled={Boolean(editingListingId)}
                    onChange={(e) => {
                      const m = e.target.value as MetalType;
                      setMetal(m);
                      setMinWeight(m === 'GOLD' ? 10 : 1000);
                      setMaxWeight(m === 'GOLD' ? 1000 : 30000);
                      setPremiumPerUnit(m === 'GOLD' ? 350 : 900);
                      setTitle(
                        m === 'GOLD'
                          ? '999.9 Fine Gold Bullion Bar (Jaipur Desk)'
                          : '999 Fine Silver Bullion Ingot 1kg'
                      );
                    }}
                    className="w-full px-3 py-2 text-xs border border-[#D4D1C8] bg-white"
                  >
                    <option value="GOLD">Gold (per 10g)</option>
                    <option value="SILVER">Silver (per 1kg)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">Purity</label>
                  <select
                    value={purity}
                    disabled={Boolean(editingListingId)}
                    onChange={(e) => setPurity(e.target.value as PurityGrade)}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#D4D1C8] bg-white"
                  >
                    <option value="999">999 Fine</option>
                    <option value="995">995 Fine</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">Form</label>
                  <select
                    value={form}
                    onChange={(e) => setForm(e.target.value as BullionForm)}
                    className="w-full px-3 py-2 text-xs border border-[#D4D1C8] bg-white"
                  >
                    <option value="Bar">Bar</option>
                    <option value="Coin">Coin</option>
                    <option value="Biscuit">Biscuit</option>
                    <option value="Kacha">Kacha</option>
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Listing Title
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#D4D1C8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Supplier Premium (₹/{metal === 'GOLD' ? '10g' : '1kg'})
                  </label>
                  <input
                    type="number"
                    required
                    value={premiumPerUnit}
                    onChange={(e) => setPremiumPerUnit(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Min Weight (g)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={minWeight}
                    onChange={(e) => setMinWeight(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Max Weight (g)
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={maxWeight}
                    onChange={(e) => setMaxWeight(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Available Stock (g)
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={stockGrams}
                    onChange={(e) => setStockGrams(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-[#D4D1C8]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-6 text-xs text-[#4B4A45] pt-1">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={supportsBuy}
                    onChange={(e) => setSupportsBuy(e.target.checked)}
                  />
                  Buy Orders
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={supportsSell}
                    onChange={(e) => setSupportsSell(e.target.checked)}
                  />
                  Sell-Back Orders
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={supportsExchange}
                    onChange={(e) => setSupportsExchange(e.target.checked)}
                  />
                  Metal Exchange
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  Active in Marketplace
                </label>
              </div>

              {previewCalc && (
                <div className="bg-[#FAFAF8] border border-[#E5E3DD] p-3.5 text-xs font-mono tabular-nums flex flex-wrap justify-between gap-2">
                  <span>
                    Live Buyer Unit Price ({metal === 'GOLD' ? '10g' : '1kg'}): MCX{' '}
                    {formatInr(previewCalc.mcxBaseRatePerUnit)} + Premium{' '}
                    {formatInr(premiumPerUnit)} + {platformSettings.commissionRatePct}% Fee +{' '}
                    {platformSettings.gstRatePct}% GST
                  </span>
                  <strong className="text-[#141413]">
                    {formatInr(previewCalc.finalPayableTotalInr)}
                  </strong>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={savingListing || !supplier}
                  className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28] inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C99D44]" />
                  {savingListing
                    ? 'Saving...'
                    : editingListingId
                    ? 'Update Listing'
                    : 'Publish Listing'}
                </button>
                {editingListingId && (
                  <button
                    type="button"
                    onClick={() => setEditingListingId(null)}
                    className="px-4 py-2.5 border border-[#D4D1C8] text-xs font-medium"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </form>

            <div className="bg-white border border-[#E5E3DD] overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD]">
                    <th className="py-3 px-4 font-semibold">Listing</th>
                    <th className="py-3 px-4 font-semibold">Spec</th>
                    <th className="py-3 px-4 font-semibold text-right">Premium</th>
                    <th className="py-3 px-4 font-semibold text-right">Stock</th>
                    <th className="py-3 px-4 font-semibold">Visibility</th>
                    <th className="py-3 px-4 font-semibold text-right">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E3DD]">
                  {listings.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 px-4 font-semibold text-[#141413]">{item.title}</td>
                      <td className="py-3 px-4 font-mono">
                        {item.metal} {item.purity} · {item.form}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        +{formatInr(item.premiumPerUnitInr)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {item.availableStockGrams}g
                      </td>
                      <td className="py-3 px-4">
                        {item.supplierApproved && item.isActive
                          ? 'Live Public'
                          : !item.supplierApproved
                          ? 'Awaiting Approval'
                          : 'Paused'}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingListingId(item.id);
                            setMetal(item.metal);
                            setPurity(item.purity);
                            setForm(item.form);
                            setTitle(item.title);
                            setMinWeight(item.minWeightGrams);
                            setMaxWeight(item.maxWeightGrams);
                            setStockGrams(item.availableStockGrams);
                            setPremiumPerUnit(item.premiumPerUnitInr);
                            setSupportsBuy(item.supportsBuy);
                            setSupportsSell(item.supportsSell);
                            setSupportsExchange(item.supportsExchange);
                            setIsActive(item.isActive);
                          }}
                          className="text-[#8A641E] hover:underline font-medium"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteListing(item.id)}
                          aria-label="Delete listing"
                          className="text-[#B91C1C] hover:underline inline-flex items-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'settlements' && !isStaff && (
          <div className="bg-white border border-[#E5E3DD]">
            <div className="px-6 py-4 border-b border-[#E5E3DD]">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Earnings &amp; Settlement Ledger
              </h2>
              <p className="text-xs text-[#5A5852]">
                Generated automatically on every locked order. Platform commission rate is governed
                strictly by Super Admin.
              </p>
            </div>
            {settlements.length === 0 ? (
              <div className="p-10 text-center text-sm text-[#5A5852]">
                No settlements recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F3F1EC] border-b border-[#E5E3DD]">
                      <th className="py-3 px-4 font-semibold">Order</th>
                      <th className="py-3 px-4 font-semibold text-right">GTV (Gross)</th>
                      <th className="py-3 px-4 font-semibold text-right">Platform Fee</th>
                      <th className="py-3 px-4 font-semibold text-right">Supplier Net</th>
                      <th className="py-3 px-4 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E3DD]">
                    {settlements.map((s) => (
                      <tr key={s.id}>
                        <td className="py-3 px-4 font-mono font-semibold">{s.orderNumber}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {formatInr(s.grossTransactionValueInr)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[#6F6D67]">
                          -{formatInr(s.platformCommissionInr)} ({s.platformCommissionRatePct}%)
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-[#15803D]">
                          {formatInr(s.supplierNetPayableInr)}
                        </td>
                        <td className="py-3 px-4">
                          {s.status} {s.referenceNumber ? `· ${s.referenceNumber}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'staff' && !isStaff && (
          <div className="space-y-6">
            <form onSubmit={handleAddStaff} className="bg-white border border-[#E5E3DD] p-6 space-y-4">
              <h2 className="text-2xl font-semibold text-[#141413]">Authorize Supplier Staff</h2>
              <p className="text-xs text-[#5A5852]">
                Authorized staff can sign in with their invited email to manage your assigned
                orders and upload purity documentation only.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder="Staff Full Name"
                  className="px-3 py-2 text-xs border border-[#D4D1C8]"
                />
                <input
                  type="email"
                  required
                  value={staffEmail}
                  onChange={(e) => setStaffEmail(e.target.value)}
                  placeholder="staff@jaipurbullion.in"
                  className="px-3 py-2 text-xs border border-[#D4D1C8]"
                />
                <input
                  type="text"
                  value={staffDesignation}
                  onChange={(e) => setStaffDesignation(e.target.value)}
                  placeholder="Designation"
                  className="px-3 py-2 text-xs border border-[#D4D1C8]"
                />
              </div>
              <div className="flex gap-6 text-xs">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={canLockRates}
                    onChange={(e) => setCanLockRates(e.target.checked)}
                  />
                  Can Confirm &amp; Lock Rates
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={canUploadPurityDocs}
                    onChange={(e) => setCanUploadPurityDocs(e.target.checked)}
                  />
                  Can Upload Purity Certificates
                </label>
              </div>
              <button
                type="submit"
                disabled={!supplier}
                className="px-4 py-2 bg-[#141413] text-white text-xs font-medium disabled:opacity-50"
              >
                Add Authorized Staff
              </button>
            </form>

            <div className="bg-white border border-[#E5E3DD] divide-y divide-[#E5E3DD]">
              {staffList.length === 0 ? (
                <div className="p-6 text-xs text-[#6F6D67]">No staff members assigned yet.</div>
              ) : (
                staffList.map((st) => (
                  <div key={st.id} className="p-4 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-[#141413]">
                        {st.staffName} · {st.designation}
                      </div>
                      <div className="text-[#6F6D67]">{st.staffEmail}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSupplierStaff(st.id)}
                      className="text-[#B91C1C] hover:underline"
                    >
                      Revoke Access
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'profile' && !isStaff && (
          <form onSubmit={handleSaveSupplier} className="bg-white border border-[#E5E3DD] p-6 space-y-5">
            <div className="border-b border-[#E5E3DD] pb-4">
              <h2 className="text-2xl font-semibold text-[#141413]">
                Supplier Onboarding &amp; Verification Credentials
              </h2>
              <p className="text-xs text-[#5A5852]">
                Submit your Jaipur bullion firm registration, GSTIN, BIS/assaying credentials, and
                physical delivery centre. Super Admin approval is required before public visibility.
              </p>
              {supplier?.adminRemarks && (
                <div className="mt-3 p-3 bg-[#FAF6EE] border border-[#E3C27A] text-xs text-[#785517]">
                  <strong>Admin Review Note:</strong> {supplier.adminRemarks}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Bullion Firm / Refinery Legal Name
                </label>
                <input
                  type="text"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Rajasthan Sovereign Bullion House"
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
                  placeholder="08AABCR1234K1Z2"
                  className="w-full px-3 py-2 text-sm font-mono uppercase border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  BIS / Assaying License Number
                </label>
                <input
                  type="text"
                  required
                  value={bisLicenseNumber}
                  onChange={(e) => setBisLicenseNumber(e.target.value)}
                  placeholder="BIS/RJA/AHC-2026-041"
                  className="w-full px-3 py-2 text-sm font-mono border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Partner Assaying Lab (Optional)
                </label>
                <input
                  type="text"
                  value={assayingPartner}
                  onChange={(e) => setAssayingPartner(e.target.value)}
                  placeholder="Jaipur Precious Metals Testing Lab"
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Jaipur Locality
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
                  Jaipur Pickup / Delivery Centre
                </label>
                <input
                  type="text"
                  required
                  value={deliveryCenter}
                  onChange={(e) => setDeliveryCenter(e.target.value)}
                  placeholder="Johari Bazaar Vault Desk, Gate 2"
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Registered Jaipur Office Address
                </label>
                <input
                  type="text"
                  required
                  value={officeAddress}
                  onChange={(e) => setOfficeAddress(e.target.value)}
                  placeholder="3rd Floor, Bullion Chambers, Gopalji Ka Rasta, Jaipur 302003"
                  className="w-full px-3 py-2 text-sm border border-[#D4D1C8]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Upload GST Registration &amp; BIS/Assaying Credentials (PDF/Image)
                </label>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={(e) => setKycFile(e.target.files?.[0] || null)}
                  className="text-xs text-[#4B4A45]"
                />
                {supplier?.kycDocumentName && (
                  <p className="text-xs text-[#15803D] mt-1">
                    Uploaded credential: {supplier.kycDocumentName}
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSupplier}
              className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium hover:bg-[#2A2A28]"
            >
              {savingSupplier
                ? 'Saving Credentials...'
                : supplier
                ? 'Update Verification Profile'
                : 'Submit for Super Admin Verification'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
