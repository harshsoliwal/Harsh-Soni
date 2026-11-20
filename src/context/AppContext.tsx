import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
} from '../lib/firebase';
import { ensureUserProfile, syncLiveRateToFirestore } from '../lib/firestoreService';
import { buildUnitConversions, DEFAULT_PLATFORM_SETTINGS } from '../lib/pricing';
import type {
  BullionListingDoc,
  LiveMcxRate,
  NotificationDoc,
  PlatformSettingsDoc,
  ReviewDoc,
  SupplierDoc,
  UserDoc,
  UserRole,
} from '../types/bullion';

interface AppContextValue {
  firebaseUser: User | null;
  userDoc: UserDoc | null;
  authLoading: boolean;
  effectiveRole: UserRole | null;
  isAdmin: boolean;
  mcxRate: LiveMcxRate | null;
  mcxLoading: boolean;
  mcxError: string | null;
  refreshMcxRate: (force?: boolean) => Promise<void>;
  platformSettings: PlatformSettingsDoc;
  approvedSuppliers: SupplierDoc[];
  publicListings: BullionListingDoc[];
  publicReviews: ReviewDoc[];
  notifications: NotificationDoc[];
  logout: () => Promise<void>;
  reloadUserAndProfile: (preferredRole?: UserRole) => Promise<void>;
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;
  showToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsDoc>(
    DEFAULT_PLATFORM_SETTINGS
  );
  const [firestoreCachedRate, setFirestoreCachedRate] = useState<LiveMcxRate | null>(null);
  const [apiLiveRate, setApiLiveRate] = useState<LiveMcxRate | null>(null);
  const [mcxLoading, setMcxLoading] = useState(true);
  const [mcxError, setMcxError] = useState<string | null>(null);

  const [approvedSuppliers, setApprovedSuppliers] = useState<SupplierDoc[]>([]);
  const [publicListings, setPublicListings] = useState<BullionListingDoc[]>([]);
  const [publicReviews, setPublicReviews] = useState<ReviewDoc[]>([]);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );

  const showToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // 1. Auth state listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setUserDoc(null);
        setAuthLoading(false);
        return;
      }
      try {
        const pendingRole = (sessionStorage.getItem('bb_pending_role') as UserRole) || 'jeweller';
        const profile = await ensureUserProfile(
          user.uid,
          user.email || '',
          user.displayName || user.email?.split('@')[0] || 'User',
          pendingRole
        );
        if (profile) {
          sessionStorage.removeItem('bb_pending_role');
        }
        setUserDoc(profile);
      } catch (err) {
        console.error('Failed loading user profile:', err);
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Keep userDoc synced in real time when signed in
  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          setUserDoc(snap.data() as UserDoc);
        }
      },
      (err) => {
        console.error('User profile listener error:', err);
      }
    );
    return () => unsub();
  }, [firebaseUser]);

  // 2. Public listeners: platform_settings/config, market_rates/current, Approved suppliers, active listings, reviews
  useEffect(() => {
    const unsubSettings = onSnapshot(
      doc(db, 'platform_settings', 'config'),
      (snap) => {
        if (snap.exists()) {
          setPlatformSettings({
            ...DEFAULT_PLATFORM_SETTINGS,
            ...(snap.data() as PlatformSettingsDoc),
          });
        }
      },
      (err) => console.error('platform_settings listener:', err)
    );

    const unsubRateDoc = onSnapshot(
      doc(db, 'market_rates', 'current'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          const ts = d.lastUpdatedAt?.toDate ? d.lastUpdatedAt.toDate().toISOString() : new Date().toISOString();
          setFirestoreCachedRate({
            gold999Per10g: d.gold999Per10g,
            gold995Per10g: d.gold995Per10g,
            gold999Per1g: d.gold999Per1g,
            silver999Per1kg: d.silver999Per1kg,
            silver999Per100g: d.silver999Per100g,
            usdInr: d.usdInr,
            xauUsd: d.xauUsd,
            xagUsd: d.xagUsd,
            source: d.source,
            isDelayed: Boolean(d.isDelayed),
            isManualOverride: Boolean(d.isManualOverride),
            manualOverrideNote: d.manualOverrideNote,
            lastUpdatedAt: ts,
            status: d.isManualOverride ? 'manual_override' : d.isDelayed ? 'delayed' : 'live',
          });
        }
      },
      (err) => console.error('market_rates listener:', err)
    );

    const unsubSuppliers = onSnapshot(
      query(collection(db, 'suppliers'), where('status', '==', 'Approved')),
      (snap) => {
        setApprovedSuppliers(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupplierDoc, 'id'>) }))
        );
      },
      (err) => console.error('suppliers listener:', err)
    );

    const unsubListings = onSnapshot(
      query(
        collection(db, 'bullion_listings'),
        where('supplierApproved', '==', true),
        where('isActive', '==', true)
      ),
      (snap) => {
        setPublicListings(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BullionListingDoc, 'id'>) }))
        );
      },
      (err) => console.error('bullion_listings listener:', err)
    );

    const unsubReviews = onSnapshot(
      query(collection(db, 'reviews'), where('rating', '>=', 1)),
      (snap) => {
        setPublicReviews(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ReviewDoc, 'id'>) }))
        );
      },
      (err) => console.error('reviews listener:', err)
    );

    return () => {
      unsubSettings();
      unsubRateDoc();
      unsubSuppliers();
      unsubListings();
      unsubReviews();
    };
  }, []);

  // 3. Notifications listener for authenticated user
  useEffect(() => {
    if (!firebaseUser) {
      setNotifications([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'notifications'), where('userId', '==', firebaseUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationDoc, 'id'>) }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setNotifications(list);
      },
      (err) => console.error('notifications listener:', err)
    );
    return () => unsub();
  }, [firebaseUser]);

  // 4. Live MCX rate fetcher (polls /api/rates/mcx every 45s)
  const refreshMcxRate = useCallback(async (force = false) => {
    setMcxLoading(true);
    try {
      const resp = await fetch(`/api/rates/mcx${force ? '?refresh=true' : ''}`);
      const data = (await resp.json()) as {
        ok: boolean;
        rate: LiveMcxRate | null;
        error?: string;
        warning?: string;
      };
      if (data.rate) {
        setApiLiveRate(data.rate);
        setMcxError(data.warning || null);
        if (auth.currentUser?.emailVerified && !data.rate.isDelayed) {
          syncLiveRateToFirestore(data.rate).catch(() => {});
        }
      } else {
        setApiLiveRate(null);
        setMcxError(data.error || 'Live MCX source temporarily unavailable.');
      }
    } catch {
      setApiLiveRate(null);
      setMcxError('Unable to reach /api/rates/mcx endpoint.');
    } finally {
      setMcxLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMcxRate(false);
    const interval = setInterval(() => {
      refreshMcxRate(false);
    }, 45_000);
    return () => clearInterval(interval);
  }, [refreshMcxRate]);

  // Resolve effective active rate obeying Super Admin manual override & honesty guardrails
  let resolvedRate: LiveMcxRate | null = null;
  if (
    platformSettings.manualOverrideEnabled &&
    platformSettings.manualGold999Per10g &&
    platformSettings.manualSilver999Per1kg
  ) {
    const conv = buildUnitConversions(
      platformSettings.manualGold999Per10g,
      platformSettings.manualSilver999Per1kg
    );
    resolvedRate = {
      ...conv,
      source: 'Super Admin Manual Reference Rate',
      isDelayed: true,
      isManualOverride: true,
      manualOverrideNote: platformSettings.manualOverrideReason,
      lastUpdatedAt:
        platformSettings.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      status: 'manual_override',
    };
  } else if (firestoreCachedRate?.isManualOverride) {
    resolvedRate = firestoreCachedRate;
  } else if (apiLiveRate) {
    resolvedRate = apiLiveRate;
  } else if (firestoreCachedRate) {
    resolvedRate = {
      ...firestoreCachedRate,
      isDelayed: true,
      status: 'delayed',
    };
  }

  const isBootstrappedAdmin = Boolean(
    firebaseUser?.emailVerified &&
      firebaseUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase()
  );

  const effectiveRole: UserRole | null = isBootstrappedAdmin
    ? 'super_admin'
    : userDoc?.role || null;

  const isAdmin = effectiveRole === 'super_admin';

  const logout = async () => {
    await signOut(auth);
    setUserDoc(null);
    showToast('info', 'Signed out of BullionBridge.');
  };

  const reloadUserAndProfile = async (preferredRole?: UserRole) => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    const refreshed = auth.currentUser;
    setFirebaseUser({ ...refreshed });
    if (refreshed.emailVerified) {
      const prof = await ensureUserProfile(
        refreshed.uid,
        refreshed.email || '',
        refreshed.displayName || refreshed.email?.split('@')[0] || 'User',
        preferredRole || 'jeweller'
      );
      setUserDoc(prof);
    }
  };

  return (
    <AppContext.Provider
      value={{
        firebaseUser,
        userDoc,
        authLoading,
        effectiveRole,
        isAdmin,
        mcxRate: resolvedRate,
        mcxLoading,
        mcxError,
        refreshMcxRate,
        platformSettings,
        approvedSuppliers,
        publicListings,
        publicReviews,
        notifications,
        logout,
        reloadUserAndProfile,
        toast,
        showToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
