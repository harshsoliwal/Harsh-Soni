import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { CheckCircle2, Mail, ShieldCheck, X } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import type { UserRole } from '../types/bullion';

interface AuthModalProps {
  isOpen: boolean;
  initialMode?: 'signin' | 'signup';
  initialRole?: 'jeweller' | 'supplier';
  onClose: () => void;
}

export function AuthModal({
  isOpen,
  initialMode = 'signin',
  initialRole = 'jeweller',
  onClose,
}: AuthModalProps) {
  const { firebaseUser, reloadUserAndProfile, showToast } = useApp();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>(initialMode);
  const [role, setRole] = useState<'jeweller' | 'supplier'>(initialRole);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const needsEmailVerification = Boolean(firebaseUser && !firebaseUser.emailVerified);

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      sessionStorage.setItem('bb_pending_role', role);
      await signInWithPopup(auth, googleProvider);
      showToast('success', 'Signed in with Google.');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setErrorMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);

    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setInfoMsg('Password reset link sent to your email address.');
        return;
      }

      if (mode === 'signup') {
        sessionStorage.setItem('bb_pending_role', role);
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (displayName.trim()) {
          await updateProfile(cred.user, { displayName: displayName.trim() });
        }
        await sendEmailVerification(cred.user);
        setInfoMsg(
          'Account created. Please check your inbox and click the verification link before continuing.'
        );
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (!cred.user.emailVerified) {
          setInfoMsg('Your email is not verified yet. Please verify via the link sent to your inbox.');
        } else {
          showToast('success', 'Welcome back to BullionBridge.');
          onClose();
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('operation-not-allowed')) {
        setErrorMsg(
          'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Enable Email/Password there, or sign in immediately using Google Sign-In below.'
        );
      } else {
        setErrorMsg(raw.replace('Firebase: ', ''));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await sendEmailVerification(auth.currentUser);
      setInfoMsg('Verification email resent. Check your inbox and spam folder.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to resend verification email.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerification = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await reloadUserAndProfile(role as UserRole);
      if (auth.currentUser?.emailVerified) {
        showToast('success', 'Email verified. Welcome to BullionBridge.');
        onClose();
      } else {
        setErrorMsg('Email is still unverified. Click the link in your email first.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#141413]/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-white border border-[#E5E3DD] max-w-md w-full p-6 sm:p-8 relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close authentication modal"
          className="absolute top-5 right-5 text-[#6F6D67] hover:text-[#141413] p-1"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <p className="text-xs font-medium text-[#8A641E] mb-1">
            Jaipur B2B Bullion Access
          </p>
          <h2 id="auth-modal-title" className="text-3xl font-semibold text-[#141413]">
            {needsEmailVerification
              ? 'Verify Your Email'
              : mode === 'signin'
              ? 'Sign in to BullionBridge'
              : mode === 'signup'
              ? 'Register Business Account'
              : 'Reset Account Password'}
          </h2>
        </div>

        {needsEmailVerification ? (
          <div className="space-y-4">
            <div className="bg-[#FAFAF8] border border-[#E5E3DD] p-4 text-sm text-[#4B4A45] space-y-2">
              <div className="flex items-center gap-2 font-semibold text-[#141413]">
                <Mail className="w-4 h-4 text-[#8A641E]" />
                Verification required for {firebaseUser?.email}
              </div>
              <p>
                BullionBridge requires verified email addresses for all live MCX quote requests,
                KYC uploads, and supplier rate locks.
              </p>
            </div>
            {errorMsg && <p className="text-xs text-[#B91C1C]">{errorMsg}</p>}
            {infoMsg && <p className="text-xs text-[#15803D]">{infoMsg}</p>}
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={handleCheckVerification}
                className="w-full py-2.5 px-4 bg-[#141413] text-white text-sm font-medium hover:bg-[#2A2A28] transition-colors inline-flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                I Have Verified — Continue
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleResendVerification}
                className="w-full py-2.5 px-4 border border-[#D4D1C8] text-[#141413] text-sm font-medium hover:bg-[#F3F1EC] transition-colors"
              >
                Resend Verification Email
              </button>
            </div>
          </div>
        ) : (
          <>
            {mode !== 'reset' && (
              <div className="mb-5">
                <label className="block text-xs font-medium text-[#5A5852] mb-2">
                  Select Business Role (for new registrations)
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#F3F1EC]">
                  <button
                    type="button"
                    onClick={() => setRole('jeweller')}
                    className={`py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                      role === 'jeweller'
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#5A5852] hover:text-[#141413]'
                    }`}
                  >
                    Jeweller (Buyer/Seller)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('supplier')}
                    className={`py-2 px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                      role === 'supplier'
                        ? 'bg-white text-[#141413] shadow-xs'
                        : 'text-[#5A5852] hover:text-[#141413]'
                    }`}
                  >
                    Bullion Supplier
                  </button>
                </div>
              </div>
            )}

            {mode !== 'reset' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleGoogleSignIn}
                  className="w-full py-2.5 px-4 bg-[#141413] text-white text-sm font-medium hover:bg-[#2A2A28] transition-colors flex items-center justify-center gap-2.5 mb-5"
                >
                  <ShieldCheck className="w-4 h-4 text-[#C99D44]" />
                  Continue with Google Sign-In
                </button>

                <div className="relative flex items-center justify-center mb-5">
                  <div className="border-t border-[#E5E3DD] w-full" />
                  <span className="bg-white px-3 text-xs text-[#6F6D67] shrink-0">
                    or use business email
                  </span>
                  <div className="border-t border-[#E5E3DD] w-full" />
                </div>
              </>
            )}

            <form onSubmit={handleEmailSubmit} className="space-y-3.5">
              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                    Contact / Proprietor Name
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Rajesh Khandelwal"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#4B4A45] mb-1">
                  Business Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="desk@jaipurjewellers.in"
                  className="w-full px-3.5 py-2.5 text-sm border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
                />
              </div>

              {mode !== 'reset' && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-[#4B4A45]">Password</label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('reset');
                          setErrorMsg(null);
                          setInfoMsg(null);
                        }}
                        className="text-xs text-[#8A641E] hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#D4D1C8] bg-white focus:outline-none focus:border-[#8A641E]"
                  />
                </div>
              )}

              {errorMsg && (
                <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]">
                  {errorMsg}
                </div>
              )}
              {infoMsg && (
                <div className="p-3 bg-[#F0FDF4] border border-[#BBF7D0] text-xs text-[#166534]">
                  {infoMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 bg-[#8A641E] text-white text-sm font-medium hover:bg-[#745318] transition-colors disabled:opacity-50"
              >
                {busy
                  ? 'Processing...'
                  : mode === 'signin'
                  ? 'Sign In with Email'
                  : mode === 'signup'
                  ? 'Create Verified Account'
                  : 'Send Password Reset Email'}
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-[#E5E3DD] flex items-center justify-between text-xs text-[#5A5852]">
              {mode === 'signin' ? (
                <>
                  <span>New to BullionBridge?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signup');
                      setErrorMsg(null);
                    }}
                    className="font-semibold text-[#141413] hover:text-[#8A641E]"
                  >
                    Register Business
                  </button>
                </>
              ) : (
                <>
                  <span>Already registered?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setErrorMsg(null);
                    }}
                    className="font-semibold text-[#141413] hover:text-[#8A641E]"
                  >
                    Back to Sign In
                  </button>
                </>
              )}
            </div>
            <p className="mt-3 text-[11px] text-[#6F6D67]">
              Supplier Staff receive access automatically when invited by their Supplier owner.
              Super Admin accounts are provisioned strictly server-side.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
