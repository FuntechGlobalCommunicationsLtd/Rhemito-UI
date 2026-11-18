import React, { useState } from "react";
import { KeyRound, Lock, User, Mail, Phone, MapPin, CheckCircle2, Check } from "lucide-react";
import { useLocation } from "wouter";
import { PasswordInput } from "@/components/ui/password-input";
import { getSafePostAuthRedirect } from "@/lib/support";

// Simulating the UI state for the OBO Flow
type AuthStep = "email" | "pin" | "password" | "review";

export default function Login() {
    const [, setLocation] = useLocation();
    const [step, setStep] = useState<AuthStep>("email");
    const [email, setEmail] = useState("");
    const [pin, setPin] = useState("");
    const [isPinVerified, setIsPinVerified] = useState(false);
    const [pinAttempts, setPinAttempts] = useState(0);
    const [isBlocked, setIsBlocked] = useState(false);
    const [pinError, setPinError] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [passwordError, setPasswordError] = useState("");
    const [termsAccepted, setTermsAccepted] = useState(false);

    // Profile Form State
    const [firstName, setFirstName] = useState("James");
    const [lastName, setLastName] = useState("Collor");
    const [phone, setPhone] = useState("+44 7700 900077");
    const [address, setAddress] = useState("14 Baker Street, London, W1U 3BW");

    const handleEmailSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;
        setStep("pin");
    };

    const handlePinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (pin.length !== 6 || isBlocked) return;

        // Mocking '123456' as the ONLY correct PIN to test the error conditions
        if (pin !== "123456") {
            const newAttempts = pinAttempts + 1;
            setPinAttempts(newAttempts);

            if (newAttempts >= 6) {
                setIsBlocked(true);
                setPinError("");
            } else {
                setPinError(`Incorrect or expired PIN. You have ${6 - newAttempts} attempts remaining.`);
            }
            return;
        }

        // Show success state
        setPinError("");
        setIsPinVerified(true);

        // Wait 2 seconds before moving to next step
        setTimeout(() => {
            setIsPinVerified(false);
            setStep("password");
        }, 2000);
    };

    const handlePasswordSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setPasswordError(""); // Clear previous errors

        if (!password || !confirmPassword) return;

        if (password !== confirmPassword) {
            setPasswordError("Passwords do not match");
            return;
        }

        if (!termsAccepted) return;

        setStep("review");
    };

    const handleProfileSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setLocation(getSafePostAuthRedirect());
    };

    return (
        <div className="min-h-screen flex flex-col items-center relative overflow-hidden"
            style={{ background: 'linear-gradient(180deg, #f5f7fb 0%, #edf0f7 100%)' }}>

            {/* Header Logo section */}
            <div className="flex flex-col items-center mt-8 mb-2">
                <div className="flex items-center space-x-2">
                    <svg width="26" height="33" viewBox="0 0 26 33" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
                        <path d="M25.0764 30.3999C25.0471 30.0963 24.9593 29.8023 24.813 29.5351L16.8761 14.4493L24.8398 3.57589C25.5715 2.5726 25.352 1.17091 24.3471 0.439699C23.9495 0.165191 23.5007 0 22.9983 0H2.25129C1.63908 0 1.08296 0.238069 0.658557 0.655904C0.251228 1.06159 0 1.62275 0 2.24222V30.604C0 31.3109 0.348792 32.0008 0.924419 32.4162C1.83664 33.0988 3.22693 32.9434 3.95622 32.0688C3.99769 32.0227 4.03183 31.9741 4.07086 31.9279L10.3296 23.3818L21.3836 32.3312C21.5568 32.4769 21.7543 32.5911 21.9641 32.6786C23.5007 33.332 25.2447 32.0591 25.0739 30.4023L25.0764 30.3999ZM9.49542 16.915L4.5099 23.7218V4.4893H18.6006L11.5857 14.0606L15.7541 21.9825L9.49542 16.915Z" fill="#3D48D1" />
                    </svg>
                    <span className="text-3xl font-semibold text-slate-800 tracking-tight">Rhemito</span>
                </div>
                {/* Blue gradient line under logo */}
                <div className="mt-2 h-[3px] w-32 rounded-full"
                    style={{ background: 'linear-gradient(90deg, transparent, #4f56e8, transparent)' }} />
            </div>

            {/* Main content area */}
            <div className="flex-grow flex items-start justify-center px-4 w-full mt-6 z-10">
                {step === "email" && (
                    <div className="w-full max-w-lg flex flex-col items-center">
                        <h1 className="text-xl font-normal text-slate-600 mb-8">Enter your email address</h1>

                        {/* White form card */}
                        <div className="w-full bg-white rounded-lg shadow-sm border border-slate-100 px-8 py-6">
                            <form onSubmit={handleEmailSubmit}>
                                <div className="mb-5">
                                    <label className="block text-sm text-slate-500 mb-1">Email<span className="text-red-400">*</span></label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="block w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-slate-700"
                                        placeholder="e.g. jamescollar@email.com"
                                        required
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="w-full text-white font-medium py-2.5 px-4 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors text-sm"
                                    style={{ background: '#4f56e8' }}
                                >
                                    Continue
                                </button>
                            </form>
                        </div>
                    </div>
                )}

                {step === "pin" && (
                    <div className="w-full max-w-lg flex flex-col items-center">
                        <h1 className="text-xl font-normal text-slate-600 mb-4">Verify your email</h1>

                        {/* OBO Banner */}
                        <div className="w-full mb-4 bg-yellow-50 text-yellow-800 text-sm py-2.5 px-4 rounded flex items-start text-left border border-yellow-200">
                            <span className="mr-2 text-base">🟡</span>
                            <p>You already have an account with us, please verify your email.</p>
                        </div>

                        {/* White form card */}
                        <div className="w-full bg-white rounded-lg shadow-sm border border-slate-100 px-8 py-6">
                            <p className="text-sm text-slate-500 mb-1">
                                We've sent a code to <span className="font-semibold text-slate-700">{email}</span>
                            </p>
                            <button onClick={() => setStep("email")} className="text-blue-600 font-medium text-xs mb-5 hover:underline">
                                Change email
                            </button>

                            <form onSubmit={handlePinSubmit}>
                                {isBlocked ? (
                                    <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-md">
                                        <h3 className="text-red-800 font-medium mb-1">Account blocked</h3>
                                        <p className="text-sm text-red-600">
                                            You have exceeded the maximum number of verification attempts. Your account has been blocked for security. Please contact your administrator at <a href="mailto:admin@rhemito.com" className="font-semibold hover:underline">admin@rhemito.com</a> to resolve this.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <div className="mb-5">
                                            <label className="block text-sm text-slate-500 mb-1">Verification Code<span className="text-red-400">*</span></label>
                                            <input
                                                type="text"
                                                maxLength={6}
                                                value={pin}
                                                disabled={isPinVerified}
                                                onChange={(e) => {
                                                    setPin(e.target.value.replace(/\D/g, ""));
                                                    setPinError("");
                                                }}
                                                className={`block w-full px-3 py-2.5 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm tracking-[0.5em] font-mono text-slate-700 disabled:bg-slate-50 disabled:text-slate-400 ${pinError ? 'border-red-300 focus:ring-red-500' : 'border-slate-200'}`}
                                                placeholder="123456"
                                                required
                                            />
                                            {pinError && (
                                                <p className="text-red-500 text-xs mt-1.5 font-medium">{pinError}</p>
                                            )}
                                        </div>

                                        {isPinVerified ? (
                                            <div className="w-full bg-green-50 text-green-700 font-medium py-2.5 px-4 rounded text-sm flex items-center justify-center border border-green-200">
                                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                                Your account has been successfully verified
                                            </div>
                                        ) : (
                                            <button
                                                type="submit"
                                                disabled={pin.length !== 6}
                                                className="w-full text-white font-medium py-2.5 px-4 rounded disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors text-sm"
                                                style={{ background: '#4f56e8' }}
                                            >
                                                Verify Code
                                            </button>
                                        )}

                                        {!isPinVerified && (
                                            <div className="mt-4 text-center">
                                                <p className="text-xs text-slate-400">
                                                    Didn't receive code? <button type="button" className="text-blue-600 font-medium hover:underline">Resend</button>
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </form>
                        </div>
                    </div>
                )}

                {step === "password" && (
                    <div className="w-full max-w-lg flex flex-col items-center">
                        <h1 className="text-xl font-normal text-slate-600 mb-2">Create a password</h1>
                        <p className="text-sm text-slate-500 mb-6 text-center max-w-md">
                            Please create a secure password to complete your account setup and ensure your information stays safe.
                        </p>

                        {/* White form card */}
                        <div className="w-full bg-white rounded-lg shadow-sm border border-slate-100 px-8 py-6">
                            <form onSubmit={handlePasswordSubmit}>
                                <div className="space-y-4 mb-5">
                                    <div>
                                        <label className="block text-sm text-slate-500 mb-1">New Password<span className="text-red-400">*</span></label>
                                        <PasswordInput
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="h-11 w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-slate-700"
                                            placeholder="Min. 8 characters"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm text-slate-500 mb-1">Confirm Password<span className="text-red-400">*</span></label>
                                        <PasswordInput
                                            value={confirmPassword}
                                            onChange={(e) => {
                                                setConfirmPassword(e.target.value);
                                                setPasswordError(""); // Clear error when typing
                                            }}
                                            className={`h-11 w-full px-3 py-2.5 border rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-slate-700 ${passwordError ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 'border-slate-200'}`}
                                            placeholder="Re-enter password"
                                            required
                                        />
                                        {passwordError && (
                                            <p className="text-red-500 text-xs mt-1.5 font-medium">{passwordError}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Password Policy */}
                                <div className="bg-slate-50 rounded p-3 mb-5">
                                    <ul className="space-y-1.5 text-xs text-slate-500">
                                        <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-500" /> Minimum 8 characters</li>
                                        <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-500" /> At least 1 uppercase letter</li>
                                        <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-500" /> At least 1 number</li>
                                        <li className="flex items-center"><CheckCircle2 className="w-3.5 h-3.5 mr-2 text-green-500" /> At least 1 special character</li>
                                    </ul>
                                </div>

                                <div className="mb-5 flex items-start">
                                    <input
                                        id="terms"
                                        type="checkbox"
                                        checked={termsAccepted}
                                        onChange={(e) => setTermsAccepted(e.target.checked)}
                                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded mt-0.5"
                                        required
                                    />
                                    <label htmlFor="terms" className="ml-2 block text-xs text-slate-500">
                                        I agree to the <a href="#" className="font-medium text-blue-600 hover:text-blue-500">Terms & Conditions</a> and <a href="#" className="font-medium text-blue-600 hover:text-blue-500">Privacy Policy</a>.
                                    </label>
                                </div>

                                <button
                                    type="submit"
                                    disabled={!password || !confirmPassword || !termsAccepted}
                                    className="w-full text-white font-medium py-2.5 px-4 rounded disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors text-sm"
                                    style={{ background: '#4f56e8' }}
                                >
                                    Continue
                                </button>
                            </form>
                        </div>
                    </div>
                )}

                {step === "review" && (
                    <div className="w-full max-w-lg flex flex-col items-center">
                        <h1 className="text-xl font-normal text-slate-600 mb-2">Review your profile</h1>
                        <p className="text-sm text-slate-400 mb-6 text-center max-w-md">
                            Please confirm the details entered by your administrator are correct. You must verify these before making a transaction.
                        </p>

                        {/* White form card */}
                        <div className="w-full bg-white rounded-lg shadow-sm border border-slate-100 px-8 py-6">
                            <form onSubmit={handleProfileSubmit}>
                                <div className="space-y-4 mb-5">
                                    <div>
                                        <label className="block text-sm text-slate-500 mb-1">Email Address</label>
                                        <input
                                            type="email"
                                            value={email}
                                            disabled
                                            className="block w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded text-slate-400 text-sm cursor-not-allowed"
                                            placeholder="Email"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm text-slate-500 mb-1">First Name<span className="text-red-400">*</span></label>
                                            <input
                                                type="text"
                                                value={firstName}
                                                onChange={(e) => setFirstName(e.target.value)}
                                                className="block w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-slate-700"
                                                placeholder="First Name"
                                                required
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-slate-500 mb-1">Last Name<span className="text-red-400">*</span></label>
                                            <input
                                                type="text"
                                                value={lastName}
                                                onChange={(e) => setLastName(e.target.value)}
                                                className="block w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-slate-700"
                                                placeholder="Last Name"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm text-slate-500 mb-1">Phone Number<span className="text-red-400">*</span></label>
                                        <input
                                            type="tel"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            className="block w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm text-slate-700"
                                            placeholder="Phone Number"
                                            required
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm text-slate-500 mb-1">Address</label>
                                        <textarea
                                            value={address}
                                            onChange={(e) => setAddress(e.target.value)}
                                            className="block w-full px-3 py-2.5 border border-slate-200 rounded focus:ring-blue-500 focus:border-blue-500 text-sm h-20 resize-none text-slate-700"
                                            placeholder="Enter your full address"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    className="w-full flex items-center justify-center text-white font-medium py-2.5 px-4 rounded focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors text-sm"
                                    style={{ background: '#4f56e8' }}
                                >
                                    <Check className="w-4 h-4 mr-2" />
                                    Confirm Details & Go to Dashboard
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>

            {/* Background Graphic (Official Globe SVG) */}
            <div className="absolute bottom-0 left-0 right-0 pointer-events-none overflow-hidden flex justify-center">
                <img
                    src="/rhemitoGlobeBg.svg"
                    alt="Globe Background"
                    style={{ width: '800px', maxWidth: '100%' }}
                />
            </div>
        </div>
    );
}
