import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppProvider, useApp } from './context/AppContext';
import { McxTickerBar } from './components/McxTickerBar';
import { AuthModal } from './components/AuthModal';
import { QuoteRequestModal } from './components/QuoteRequestModal';
import { OrderDetailDrawer } from './components/OrderDetailDrawer';
import { PublicMarketplace } from './pages/PublicMarketplace';
import { JewellerDashboard } from './pages/JewellerDashboard';
import { SupplierDashboard } from './pages/SupplierDashboard';
import { AdminDashboard } from './pages/AdminDashboard';
import { db } from './lib/firebase';
import type { BullionListingDoc, OrderDoc } from './types/bullion';

type ViewMode = 'marketplace' | 'workspace';

function BullionBridgeShell() {
  const {
    firebaseUser,
    authLoading,
    effectiveRole,
    isAdmin,
    logout,
    toast,
    showToast,
  } = useApp();

  const [view, setView] = useState<ViewMode>('marketplace');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin');
  const [authModalRole, setAuthModalRole] = useState<'jeweller' | 'supplier'>('jeweller');

  const [quoteListing, setQuoteListing] = useState<BullionListingDoc | null>(null);
  const [quoteShopName, setQuoteShopName] = useState('');

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDoc | null>(null);

  // Keep open order drawer synchronized with live Firestore state
  useEffect(() => {
    if (!selectedOrderId || !firebaseUser) {
      setSelectedOrder(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'orders', selectedOrderId),
      (snap) => {
        if (snap.exists()) {
          setSelectedOrder({ id: snap.id, ...(snap.data() as Omit<OrderDoc, 'id'>) });
        }
      },
      (err) => console.error('selectedOrder listener:', err)
    );
    return () => unsub();
  }, [selectedOrderId, firebaseUser]);

  const openAuth = (mode: 'signin' | 'signup', role: 'jeweller' | 'supplier' = 'jeweller') => {
    setAuthModalMode(mode);
    setAuthModalRole(role);
    setAuthModalOpen(true);
  };

  const handleRequestQuote = (listing: BullionListingDoc, shopName = '') => {
    if (!firebaseUser) {
      openAuth('signin', 'jeweller');
      return;
    }
    if (!firebaseUser.emailVerified) {
      setAuthModalOpen(true);
      return;
    }
    if (effectiveRole === 'supplier' || effectiveRole === 'supplier_staff') {
      showToast('info', 'Supplier accounts manage quotes; sign in as a Jeweller to request quotes.');
      return;
    }
    setQuoteShopName(shopName || firebaseUser.displayName || 'Jaipur Jeweller');
    setQuoteListing(listing);
  };

  const goToWorkspace = () => {
    if (!firebaseUser) {
      openAuth('signin', 'jeweller');
      return;
    }
    if (!firebaseUser.emailVerified) {
      setAuthModalOpen(true);
      return;
    }
    setView('workspace');
  };

  const workspaceLabel = isAdmin
    ? 'Admin Console'
    : effectiveRole === 'supplier' || effectiveRole === 'supplier_staff'
    ? 'Supplier Desk'
    : 'Jeweller Desk';

  return (
    <div className="min-h-screen flex flex-col bg-[#FAFAF8] text-[#141413]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-[#E5E3DD]">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setView('marketplace')}
            className="font-editorial text-2xl font-bold tracking-tight text-[#141413] whitespace-nowrap shrink-0 cursor-pointer"
          >
            BullionBridge
          </button>

          {/* Zone 2: 4-5 Concise Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#4B4A45]">
            <button
              type="button"
              onClick={() => setView('marketplace')}
              className={`hover:text-[#141413] transition-colors whitespace-nowrap shrink-0 ${
                view === 'marketplace' ? 'text-[#141413] underline underline-offset-8 decoration-[#8A641E]' : ''
              }`}
            >
              Marketplace
            </button>
            {view === 'marketplace' ? (
              <>
                <a
                  href="#suppliers"
                  className="hover:text-[#141413] transition-colors whitespace-nowrap shrink-0"
                >
                  Suppliers
                </a>
                <a
                  href="#how-it-works"
                  className="hover:text-[#141413] transition-colors whitespace-nowrap shrink-0"
                >
                  Pricing
                </a>
                <a
                  href="#support"
                  className="hover:text-[#141413] transition-colors whitespace-nowrap shrink-0"
                >
                  Support
                </a>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setView('workspace')}
                className="text-[#141413] underline underline-offset-8 decoration-[#8A641E] whitespace-nowrap shrink-0"
              >
                {workspaceLabel}
              </button>
            )}
            {firebaseUser && view === 'marketplace' && (
              <button
                type="button"
                onClick={goToWorkspace}
                className="text-[#8A641E] hover:text-[#141413] transition-colors whitespace-nowrap shrink-0"
              >
                {workspaceLabel}
              </button>
            )}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            {firebaseUser ? (
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  setView('marketplace');
                }}
                className="px-4 py-2 text-xs font-medium border border-[#D4D1C8] text-[#141413] hover:bg-[#F3F1EC] transition-colors whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuth('signin', 'jeweller')}
                className="px-4 py-2 text-xs font-medium bg-[#141413] text-white hover:bg-[#2A2A28] transition-colors whitespace-nowrap shrink-0"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Live MCX Gold & Silver Ticker Bar */}
      <McxTickerBar />

      {/* Mobile workspace toggle bar */}
      {firebaseUser && (
        <div className="md:hidden bg-white border-b border-[#E5E3DD] px-4 py-2 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setView('marketplace')}
            className={view === 'marketplace' ? 'font-semibold text-[#141413]' : 'text-[#5A5852]'}
          >
            Marketplace
          </button>
          <button
            type="button"
            onClick={goToWorkspace}
            className={view === 'workspace' ? 'font-semibold text-[#8A641E]' : 'text-[#5A5852]'}
          >
            {workspaceLabel}
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 border text-xs font-medium shadow-md ${
            toast.type === 'success'
              ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
              : toast.type === 'error'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
              : 'bg-[#141413] border-[#262932] text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Main Content View */}
      <div className="flex-1">
        {view === 'marketplace' ? (
          <PublicMarketplace
            onOpenAuth={openAuth}
            onRequestQuote={(listing) => handleRequestQuote(listing)}
            onGoToWorkspace={goToWorkspace}
          />
        ) : authLoading ? (
          <div className="max-w-[1360px] mx-auto px-6 py-20 text-center text-sm text-[#5A5852]">
            Loading verified workspace...
          </div>
        ) : !firebaseUser || !firebaseUser.emailVerified ? (
          <div className="max-w-lg mx-auto my-20 bg-white border border-[#E5E3DD] p-8 text-center space-y-4">
            <h2 className="text-2xl font-semibold text-[#141413]">
              Verified Account Required
            </h2>
            <p className="text-sm text-[#5A5852]">
              Please sign in and verify your email address to access protected Jaipur bullion
              trading workspaces.
            </p>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="px-5 py-2.5 bg-[#141413] text-white text-xs font-medium"
            >
              Open Sign-In &amp; Verification
            </button>
          </div>
        ) : isAdmin ? (
          <AdminDashboard onSelectOrder={(o) => setSelectedOrderId(o.id)} />
        ) : effectiveRole === 'supplier' || effectiveRole === 'supplier_staff' ? (
          <SupplierDashboard onSelectOrder={(o) => setSelectedOrderId(o.id)} />
        ) : (
          <JewellerDashboard
            onRequestQuote={(listing, shopName) => handleRequestQuote(listing, shopName)}
            onSelectOrder={(o) => setSelectedOrderId(o.id)}
          />
        )}
      </div>

      {/* Quiet Institutional Footer */}
      <footer className="bg-white border-t border-[#E5E3DD] mt-auto">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#6F6D67]">
          <div>
            <span className="font-editorial text-base font-bold text-[#141413]">BullionBridge</span>
            <span className="mx-2">·</span>
            <span>Jaipur B2B Bullion Sourcing &amp; Exchange Desk (Rajasthan, India)</span>
          </div>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setView('marketplace')}
              className="hover:text-[#141413]"
            >
              Live Rates
            </button>
            <button type="button" onClick={goToWorkspace} className="hover:text-[#141413]">
              Workspace
            </button>
            <span>© {new Date().getFullYear()} BullionBridge</span>
          </div>
        </div>
      </footer>

      {/* Modals & Order Inspector Drawer */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        initialRole={authModalRole}
        onClose={() => setAuthModalOpen(false)}
      />

      <QuoteRequestModal
        listing={quoteListing}
        jewellerShopName={quoteShopName}
        onClose={() => setQuoteListing(null)}
        onSuccess={(orderId) => {
          setView('workspace');
          setSelectedOrderId(orderId);
        }}
      />

      <OrderDetailDrawer
        order={selectedOrder}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <BullionBridgeShell />
      </AppProvider>
    </ErrorBoundary>
  );
}
