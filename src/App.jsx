import { useEffect, useRef, useState } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import "./index.css";
import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
/* =========================================================
   LATHSO RAZORPAY CHECKOUT
   Real orders are created and verified by the Express backend.
   No Razorpay secret is used in this React app.
========================================================= */
const LATHSO_API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

let razorpayScriptPromise = null;

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://checkout.razorpay.com/v1/checkout.js"]'
    );
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error("Could not load the Razorpay payment gateway."));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  runTransaction,
  where,
} from "firebase/firestore";

/* =========================================================
   LOCATION HELPERS - BROWSER GPS FOR REACT WEB APP
========================================================= */
function getBrowserLocation(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Geolocation is not supported by this browser.")); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: Number(position.coords.latitude), longitude: Number(position.coords.longitude) }),
      (error) => {
        const message = error?.code === 1 ? "Location permission was denied. Please allow location access." : error?.code === 2 ? "Your location is currently unavailable. Please try again." : error?.code === 3 ? "Location request timed out. Please try again." : "Could not access your location.";
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: options.maximumAge ?? 60000 }
    );
  });
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return Infinity;
  const [aLat, aLon, bLat, bLon] = values;
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(bLat - aLat), dLon = toRadians(bLon - aLon);
  const sinLat = Math.sin(dLat / 2), sinLon = Math.sin(dLon / 2);
  const a = sinLat * sinLat + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * sinLon * sinLon;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

/* =========================================================
   CLEAN AI ANSWER RENDERER
   Keeps Gemini markdown/math from appearing as raw symbols.
========================================================= */
function cleanAILatex(value) {
  let text = String(value ?? "");

  // Convert common LaTeX matrices into readable plain-text matrices.
  text = text.replace(
    /\\begin\{(?:p|b|B|v|V)matrix\}([\s\S]*?)\\end\{(?:p|b|B|v|V)matrix\}/g,
    (_, body) => {
      const rows = body
        .split(/\\\\/)
        .map((row) =>
          row
            .replace(/&/g, "    ")
            .replace(/\\text\{([^}]*)\}/g, "$1")
            .trim()
        )
        .filter(Boolean);

      return rows.length ? `[ ${rows.join(" ; ")} ]` : "";
    }
  );

  // Common mathematical symbols/commands.
  const replacements = [
    [/\\lambda\b/g, "λ"],
    [/\\Lambda\b/g, "Λ"],
    [/\\mu\b/g, "μ"],
    [/\\pi\b/g, "π"],
    [/\\theta\b/g, "θ"],
    [/\\alpha\b/g, "α"],
    [/\\beta\b/g, "β"],
    [/\\gamma\b/g, "γ"],
    [/\\Delta\b/g, "Δ"],
    [/\\infty\b/g, "∞"],
    [/\\neq\b|\\ne\b/g, "≠"],
    [/\\leq\b|\\le\b/g, "≤"],
    [/\\geq\b|\\ge\b/g, "≥"],
    [/\\approx\b/g, "≈"],
    [/\\times\b/g, "×"],
    [/\\cdot\b/g, "·"],
    [/\\pm\b/g, "±"],
    [/\\mp\b/g, "∓"],
    [/\\implies\b|\\Rightarrow\b/g, "⇒"],
    [/\\iff\b|\\Leftrightarrow\b/g, "⇔"],
    [/\\to\b|\\rightarrow\b/g, "→"],
    [/\\in\b/g, "∈"],
    [/\\notin\b/g, "∉"],
    [/\\subseteq\b/g, "⊆"],
    [/\\mathbb\{R\}/g, "ℝ"],
    [/\\mathbb\{N\}/g, "ℕ"],
    [/\\mathbb\{Z\}/g, "ℤ"],
    [/\\mathbb\{Q\}/g, "ℚ"],
    [/\\mathbf\{([^}]*)\}/g, "$1"],
    [/\\mathrm\{([^}]*)\}/g, "$1"],
    [/\\text\{([^}]*)\}/g, "$1"],
    [/\\left/g, ""],
    [/\\right/g, ""],
    [/\\quad/g, "  "],
    [/\\qquad/g, "    "],
    [/\\,/g, " "],
  ];

  replacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  // Simple fractions: \frac{a}{b} -> a / b
  for (let i = 0; i < 4; i += 1) {
    text = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1 / $2)");
  }

  // Remove remaining LaTeX environment/control syntax.
  text = text
    .replace(/\\begin\{[^}]+\}/g, "")
    .replace(/\\end\{[^}]+\}/g, "")
    .replace(/\\label\{[^}]*\}/g, "")
    .replace(/\\\\/g, " ")
    .replace(/\\([{}[\]])/g, "$1")
    .replace(/\\[a-zA-Z]+\b/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return text;
}

function cleanAIInline(value) {
  return cleanAILatex(
    String(value ?? "")
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\$([^$]+)\$/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
  );
}

function renderAIAnswer(answer) {
  const lines = String(answer || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let bullets = [];

  function flushBullets() {
    if (!bullets.length) return;

    blocks.push(
      <ul
        key={`ai-bullets-${blocks.length}`}
        style={{
          margin: "8px 0 16px 20px",
          padding: 0,
          lineHeight: 1.75,
        }}
      >
        {bullets.map((item, i) => (
          <li key={i} style={{ marginBottom: 5 }}>
            {cleanAIInline(item)}
          </li>
        ))}
      </ul>
    );

    bullets = [];
  }

  lines.forEach((raw, index) => {
    const line = raw.trim();

    if (!line) {
      flushBullets();
      return;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      flushBullets();
      return;
    }

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushBullets();
      blocks.push(
        <div
          key={`ai-heading-${index}`}
          style={{
            margin: "20px 0 8px",
            paddingBottom: 7,
            borderBottom: "1px solid rgba(255,255,255,.08)",
            color: "#ffffff",
            fontSize: 14,
            fontWeight: 800,
            lineHeight: 1.45,
          }}
        >
          {cleanAIInline(heading[1])}
        </div>
      );
      return;
    }

    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      flushBullets();
      blocks.push(
        <div
          key={`ai-number-${index}`}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            margin: "10px 0",
            lineHeight: 1.75,
          }}
        >
          <span
            style={{
              flex: "0 0 23px",
              width: 23,
              height: 23,
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: "rgba(124,92,255,.16)",
              color: "#d8d0ff",
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {numbered[1]}
          </span>
          <span>{cleanAIInline(numbered[2])}</span>
        </div>
      );
      return;
    }

    const bullet = line.match(/^[-•*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }

    flushBullets();

    // Standalone matrix/equation-like lines get a subtle equation surface.
    const cleanLine = cleanAIInline(line);
    const isEquation =
      /(\[.*;.*\]|=|⇒|⇔|≤|≥|≠|λ|×|\/)/.test(cleanLine) &&
      cleanLine.length < 220;

    blocks.push(
      isEquation ? (
        <div
          key={`ai-equation-${index}`}
          style={{
            margin: "10px 0",
            padding: "10px 13px",
            borderRadius: 10,
            background: "rgba(124,92,255,.07)",
            border: "1px solid rgba(124,92,255,.13)",
            color: "#f2efff",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12.5,
            lineHeight: 1.65,
            overflowX: "auto",
          }}
        >
          {cleanLine}
        </div>
      ) : (
        <p
          key={`ai-paragraph-${index}`}
          style={{
            margin: "8px 0",
            lineHeight: 1.78,
            color: "inherit",
          }}
        >
          {cleanLine}
        </p>
      )
    );
  });

  flushBullets();
  return blocks;
}

const ROLES = {
  student: {
    name: "Student",
    icon: "🎓",
    description: "Learn, solve doubts and find tutors",
  },

  parent: {
    name: "Parent",
    icon: "👨‍👩‍👧",
    description: "Track your child's learning journey",
  },

  tutor: {
    name: "Tutor",
    icon: "👨‍🏫",
    description: "Teach students and grow your impact",
  },
};

/* =====================================================
   LOGO
===================================================== */

function Logo() {
  return (
    <div className="learnora-logo">
      <div className="logo-mark">L</div>
      <span>lathso</span>
    </div>
  );
}

/* =====================================================
   HOME / ROLE SELECT
===================================================== */

function Home({ onSelectRole }) {
  return (
    <div className="home-page">

      <header className="topbar">
        <Logo />

        <div className="version-badge">
          LATHSO V1.0
        </div>
      </header>

      <main className="home-content">

        <div className="eyebrow">
          ✦ HUMAN + AI LEARNING PLATFORM
        </div>

        <h1>
          Learn smarter.
          <br />
          <span>Get clarity.</span>
        </h1>

        <p className="home-description">
          AI problem solving, human tutors,
          online sessions and trusted local tuition
          <br />
          — all in one learning ecosystem.
        </p>

        <h2>
          Continue as
        </h2>

        <div className="role-grid">

          {Object.entries(ROLES).map(
            ([key, role]) => (
              <button
                key={key}
                className="role-card"
                onClick={() =>
                  onSelectRole(key)
                }
              >

                <div className="role-card-icon">
                  {role.icon}
                </div>

                <h3>
                  {role.name}
                </h3>

                <p>
                  {role.description}
                </p>

                <span className="role-arrow">
                  →
                </span>

              </button>
            )
          )}

        </div>

        <div className="home-trust">

          <span>🔒 Secure</span>
          <span>✓ Verified Tutors</span>
          <span>🤖 AI Assisted</span>
          <span>📍 Local Learning</span>

        </div>

      </main>

    </div>
  );
}

/* =====================================================
   LOGIN
===================================================== */
function Login({ role, onBack, onLogin, manualLoginRef }) {
  const [isSignup, setIsSignup] = useState(true);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const roleData = ROLES[role];

  async function handleSignup() {
    manualLoginRef.current = true;

    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) throw new Error("Please enter your full name.");
    if (!cleanEmail) throw new Error("Please enter your email address.");
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
    if (password !== confirmPassword) throw new Error("Passwords do not match.");

    const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    const firebaseUser = credential.user;

    await setDoc(doc(db, "users", firebaseUser.uid), {
      fullName: cleanName,
      email: cleanEmail,
      role,
      createdAt: serverTimestamp(),
    });

    // Signup creates the account only. Force manual login.
    await signOut(auth);
    manualLoginRef.current = false;

    setPassword("");
    setConfirmPassword("");
    setIsSignup(false);
    setMessage("Account created successfully. Now login with your email and password.");
  }

  async function handleLogin() {
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) throw new Error("Please enter your email address.");
    if (!password) throw new Error("Please enter your password.");

    const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const firebaseUser = credential.user;

    const profileRef = doc(db, "users", firebaseUser.uid);
    const profileSnap = await getDoc(profileRef);

    // Recover an existing Firebase Auth account if its users/{uid} profile
    // was never created. This does not change the UI.
    if (!profileSnap.exists()) {
      await setDoc(profileRef, {
        fullName: firebaseUser.displayName || "",
        email: firebaseUser.email || cleanEmail,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    const profile = profileSnap.exists()
      ? profileSnap.data()
      : {
          fullName: firebaseUser.displayName || "",
          email: firebaseUser.email || cleanEmail,
          role,
        };

    const accountRole = profile?.role || role;

    if (!ROLES[accountRole]) {
      await signOut(auth);
      throw new Error("Account role is missing. Please contact Lathso support.");
    }

    // The role selected on the login screen must match the account role.
    // Never allow a Student/Parent/Tutor account to enter through another
    // role's login page.
    if (accountRole !== role) {
      await signOut(auth);
      throw new Error(
        `This account is registered as ${ROLES[accountRole].name}. Please use the ${ROLES[accountRole].name} login page.`
      );
    }

    const loginRole = accountRole;

    onLogin({
      uid: firebaseUser.uid,
      name: profile?.fullName || "Student",
      email: profile?.email || firebaseUser.email || cleanEmail,
      role: loginRole,
    });
  }

  async function handleGoogleAuth() {
    manualLoginRef.current = true;
    setMessage("");
    setLoading(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });

      const credential = await signInWithPopup(auth, provider);
      const firebaseUser = credential.user;

      const profileRef = doc(db, "users", firebaseUser.uid);
      const profileSnap = await getDoc(profileRef);

      let profile;

      if (!profileSnap.exists()) {
        profile = {
          fullName: firebaseUser.displayName || "Student",
          email: firebaseUser.email || "",
          role,
        };

        await setDoc(profileRef, {
          ...profile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        profile = profileSnap.data() || {};
      }

      const accountRole = profile?.role || role;

      if (!ROLES[accountRole]) {
        await signOut(auth);
        throw new Error("Account role is missing. Please contact Lathso support.");
      }

      // Google login must also respect the role selected on the login page.
      if (accountRole !== role) {
        await signOut(auth);
        throw new Error(
          `This account is registered as ${ROLES[accountRole].name}. Please use the ${ROLES[accountRole].name} login page.`
        );
      }

      onLogin({
        uid: firebaseUser.uid,
        name: profile?.fullName || firebaseUser.displayName || "Student",
        email: profile?.email || firebaseUser.email || "",
        role: accountRole,
      });
    } catch (error) {
      manualLoginRef.current = false;
      console.error("Google authentication error:", error);

      let friendly = error?.message || "Google authentication failed.";

      if (error?.code === "auth/popup-closed-by-user") {
        friendly = "Google sign-up was cancelled.";
      } else if (error?.code === "auth/popup-blocked") {
        friendly = "Google sign-up popup was blocked. Please allow popups for Lathso.";
      } else if (error?.code === "auth/account-exists-with-different-credential") {
        friendly = "This email is already registered with another sign-in method. Please use that login method.";
      } else if (error?.code === "auth/unauthorized-domain") {
        friendly = "This Lathso domain is not authorized for Google sign-in. Add it in Firebase Authentication settings.";
      }

      setMessage(friendly);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      if (isSignup) {
        await handleSignup();
      } else {
        // Prevent onAuthStateChanged from clearing the selected role while
        // this explicit login is resolving.
        manualLoginRef.current = true;
        await handleLogin();
      }
    } catch (error) {
      manualLoginRef.current = false;
      console.error("Authentication error:", error);

      let friendly = error?.message || "Authentication failed.";

      if (error?.code === "auth/email-already-in-use") {
        friendly = "This email is already registered. Please login.";
        setIsSignup(false);
      } else if (error?.code === "auth/invalid-email") {
        friendly = "Please enter a valid email address.";
      } else if (error?.code === "auth/weak-password") {
        friendly = "Password must be at least 6 characters.";
      } else if (
        error?.code === "auth/invalid-credential" ||
        error?.code === "auth/user-not-found" ||
        error?.code === "auth/wrong-password"
      ) {
        friendly = "Incorrect email or password.";
      } else if (error?.code === "permission-denied") {
        friendly = "Profile permission denied. Please check Firestore Rules.";
      }

      setMessage(friendly);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <style>{LOGIN_CSS}</style>
      <header className="topbar">
        <Logo />
        <button className="back-button" onClick={onBack} type="button">
          ← Back
        </button>
      </header>

      <main className="login-layout">
        <section className="login-left">
          <div className="login-welcome">
            <div className="welcome-role">{roleData.icon}</div>
            <h1>Welcome {roleData.name}! 👋</h1>
            <p>
              {isSignup
                ? "Create your Lathso account."
                : "Login to continue your Lathso journey."}
            </p>
          </div>

          <div className="login-visual">
            <div className="floating-icon icon-one">🤖</div>
            <div className="floating-icon icon-two">💡</div>
            <div className="big-learning-icon">{roleData.icon}</div>
            <div className="floating-icon icon-three">📚</div>
          </div>
        </section>

        <section className="login-card">
          <div className="login-main-icon">{roleData.icon}</div>
          <h2>{isSignup ? `${roleData.name} Sign Up` : `${roleData.name} Login`}</h2>
          <p className="login-subtitle">
            {isSignup
              ? "Create your account with email and password."
              : "Login with your registered email and password."}
          </p>

          <div className="login-tabs">
            <button
              type="button"
              className={!isSignup ? "active" : ""}
              onClick={() => {
                setIsSignup(false);
                setMessage("");
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={isSignup ? "active" : ""}
              onClick={() => {
                setIsSignup(true);
                setMessage("");
              }}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {isSignup && (
              <input
                className="login-input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name"
                autoComplete="name"
              />
            )}

            <input
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="email"
            />

            <input
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={isSignup ? "new-password" : "current-password"}
            />

            {isSignup && (
              <input
                className="login-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
              />
            )}

            {message && <div className="auth-message">{message}</div>}

            {!isSignup && (
              <div className="login-options">
                <label>
                  <input type="checkbox" /> Remember me
                </label>
                <button
                  type="button"
                  onClick={() => setMessage("Password reset will be connected to Firebase next.")}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button className="login-submit" type="submit" disabled={loading}>
              {loading ? "Please wait..." : isSignup ? "Create Account" : "Login"}
            </button>
          </form>

          <button
            className="google-auth-button"
            type="button"
            onClick={handleGoogleAuth}
            disabled={loading}
          >
            <span className="google-auth-icon">G</span>
            {isSignup ? "Sign up with Google" : "Continue with Google"}
          </button>

          <div className="login-divider">
            <span /> Secure by Firebase <span />
          </div>

          <p className="demo-text">
            Lathso V1.0 • {roleData.name} authentication
          </p>
        </section>
      </main>
    </div>
  );
}


const LOGIN_CSS = `
.login-page{min-height:100vh;background:radial-gradient(circle at 18% 10%,rgba(124,92,255,.12),transparent 32%),linear-gradient(135deg,#090817,#0c1020);color:#fff}
.login-layout{max-width:1180px;margin:0 auto;padding:42px 24px 70px;display:grid;grid-template-columns:1fr 460px;gap:54px;align-items:center;min-height:calc(100vh - 76px)}
.login-left{padding:20px 0}
.login-welcome{max-width:600px}
.welcome-role{font-size:40px;margin-bottom:14px}
.login-welcome h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:0 0 14px}
.login-welcome p{color:#aaa4b8;font-size:16px;line-height:1.7;margin:0}
.login-visual{position:relative;min-height:330px;display:grid;place-items:center;margin-top:34px}
.big-learning-icon{width:190px;height:190px;border-radius:54px;display:grid;place-items:center;font-size:92px;background:radial-gradient(circle at 35% 25%,rgba(167,139,250,.35),rgba(124,92,255,.12));border:1px solid rgba(167,139,250,.2);box-shadow:0 30px 80px rgba(0,0,0,.35)}
.floating-icon{position:absolute;width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);font-size:25px;box-shadow:0 15px 40px rgba(0,0,0,.2)}
.icon-one{top:22px;left:18%}.icon-two{right:12%;top:74px}.icon-three{left:31%;bottom:14px}
.login-card{padding:30px;border-radius:26px;background:linear-gradient(180deg,rgba(24,21,42,.98),rgba(15,14,29,.98));border:1px solid rgba(124,92,255,.22);box-shadow:0 28px 70px rgba(0,0,0,.3)}
.login-main-icon{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#6d3df0,#8b5cf6);font-size:28px;margin-bottom:16px}
.login-card h2{margin:0 0 7px;font-size:28px}
.login-subtitle{margin:0;color:#9992aa;font-size:12px;line-height:1.6}
.login-tabs{display:grid;grid-template-columns:1fr 1fr;padding:4px;background:rgba(255,255,255,.04);border-radius:13px;margin:22px 0 16px}
.login-tabs button{border:0;background:transparent;color:#91899e;padding:10px;border-radius:10px;font-weight:800;cursor:pointer}
.login-tabs button.active{background:rgba(124,92,255,.18);color:#fff}
.login-input{width:100%;box-sizing:border-box;margin:8px 0;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.09);background:#0d0c1a;color:#fff;outline:none;font-size:13px}
.login-input:focus{border-color:rgba(167,139,250,.6);box-shadow:0 0 0 3px rgba(124,92,255,.08)}
.login-input::placeholder{color:#706a7d}
.auth-message{margin:10px 0;padding:11px 12px;border-radius:11px;font-size:11px;line-height:1.55;background:rgba(124,92,255,.08);border:1px solid rgba(167,139,250,.18);color:#c5bdd4}
.login-options{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0 14px;color:#8e879c;font-size:11px}
.login-options label{display:flex;align-items:center;gap:7px}
.login-options button{border:0;background:none;color:#a78bfa;cursor:pointer;font-size:11px}
.login-submit{width:100%;padding:14px;border:0;border-radius:13px;background:linear-gradient(135deg,#6d3df0,#8b5cf6);color:#fff;font-weight:900;cursor:pointer;box-shadow:0 12px 30px rgba(109,61,240,.22)}
.login-submit:disabled{opacity:.6;cursor:not-allowed}
.google-auth-button{width:100%;margin-top:12px;padding:13px 14px;border:1px solid rgba(255,255,255,.10);border-radius:13px;background:rgba(255,255,255,.045);color:#fff;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:.2s}
.google-auth-button:hover:not(:disabled){background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.18)}
.google-auth-button:disabled{opacity:.6;cursor:not-allowed}
.google-auth-icon{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:#fff;color:#4285f4;font-weight:900;font-size:14px;font-family:Arial,sans-serif}
.login-divider{display:flex;align-items:center;gap:10px;margin:22px 0 12px;color:#746d80;font-size:10px}
.login-divider span{height:1px;flex:1;background:rgba(255,255,255,.08)}
.demo-text{margin:0;text-align:center;color:#696375;font-size:10px}
.back-button{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#c9c2d4;padding:9px 12px;border-radius:10px;cursor:pointer}
@media(max-width:850px){
  .login-layout{grid-template-columns:1fr;max-width:560px;gap:15px}
  .login-left{padding-top:5px}
  .login-visual{min-height:220px;margin-top:20px}
  .big-learning-icon{width:130px;height:130px;font-size:65px}
}
`;

function VerifiedTutorCard({ tutor, onBook }) {
  return (
    <div className="verified-tutor-card">
      <div className="verified-tutor-top">
        <div className="verified-tutor-avatar">
          {(tutor.name || "T").charAt(0).toUpperCase()}
        </div>
        <span className="verified-pill">✓ Verified</span>
      </div>

      <h3>{tutor.name || "Verified Tutor"}</h3>
      <p className="verified-subject">
        {tutor.subject || "General"} • {tutor.education || "Qualified Tutor"}
      </p>

      <div className="verified-tutor-meta">
        <span>⭐ {tutor.rating || "New"}</span>
        <span>⏳ {tutor.experience || "Verified"}</span>
        <span>📍 {tutor.distance || tutor.location || "Nearby"}</span>
      </div>

      <div className="verified-tutor-tags">
        <span>🎓 {tutor.education || "Education verified"}</span>
        <span>🟢 {tutor.mode || "Online"}</span>
      </div>

      <button className="primary-button" type="button" onClick={onBook}>
        View & Book Tutor →
      </button>
    </div>
  );
}

/* =====================================================
   STUDENT DASHBOARD
===================================================== */

function VideoSession({ session, role, onClose }) {
  const localRef = useRef(null), remoteRef = useRef(null), pcRef = useRef(null), streamRef = useRef(null);
  const roomUnsub = useRef(null), candUnsub = useRef(null), callIdRef = useRef(null), pendingRef = useRef([]);
  const [status, setStatus] = useState("Starting camera...");
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true), [cameraOn, setCameraOn] = useState(true);

  useEffect(() => {
    let stopped = false;
    const start = async () => {
      const user = auth.currentUser;
      const myUid = user?.uid || "";
      const studentId = session?.studentId || (role === "student" ? myUid : "");
      const tutorId = session?.tutorId || (role === "tutor" ? myUid : "");
      const peerUid = myUid === studentId ? tutorId : studentId;
      if (!user || !session?.id || !studentId || !tutorId || !peerUid) {
        setError("This session is missing student or tutor information."); setStatus("Unable to start video session"); return;
      }
      if (session.mode && session.mode !== "Online") { setError("Video calling is available only for Online sessions."); setStatus("Online session required"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream; if (localRef.current) localRef.current.srcObject = stream;
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
        pcRef.current = pc; stream.getTracks().forEach(track => pc.addTrack(track, stream));
        pc.ontrack = e => { if (remoteRef.current) remoteRef.current.srcObject = e.streams[0]; setStatus("Connected"); };
        pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") setStatus("Connected"); else if (pc.connectionState === "connecting") setStatus("Connecting..."); else if (pc.connectionState === "failed") setStatus("Connection failed"); };
        const roomRef = doc(db, "sessions", session.id, "videoCall", "room");
        const caller = myUid < peerUid;
        const listenCandidates = callId => {
          if (!callId || candUnsub.current) return;
          const remoteSide = caller ? "callee" : "caller";
          candUnsub.current = onSnapshot(collection(db, "sessions", session.id, "videoCall", callId, "candidates", remoteSide, "items"), async snap => {
            for (const change of snap.docChanges()) {
              if (change.type !== "added") continue;
              const raw = change.doc.data()?.candidate; if (!raw) continue;
              try { const c = new RTCIceCandidate(raw); if (pc.remoteDescription) await pc.addIceCandidate(c); else pendingRef.current.push(c); } catch (e) { console.error(e); }
            }
          });
        };
        pc.onicecandidate = async e => {
          if (!e.candidate || !callIdRef.current) return;
          try { await addDoc(collection(db, "sessions", session.id, "videoCall", callIdRef.current, "candidates", caller ? "caller" : "callee", "items"), { candidate: e.candidate.toJSON(), senderId: myUid, createdAt: serverTimestamp() }); } catch (err) { console.error("ICE write error", err); }
        };
        roomUnsub.current = onSnapshot(roomRef, async snap => {
          if (!snap.exists() || stopped) return;
          const data = snap.data(); if (!data.callId) return;
          callIdRef.current = data.callId; listenCandidates(data.callId);
          try {
            if (!caller && data.offer && !pc.remoteDescription) {
              await pc.setRemoteDescription(data.offer);
              const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
              await setDoc(roomRef, { answer: { type: answer.type, sdp: answer.sdp }, answeredBy: myUid, updatedAt: serverTimestamp() }, { merge: true });
              for (const c of pendingRef.current.splice(0)) await pc.addIceCandidate(c);
              setStatus("Connecting...");
            } else if (caller && data.answer && !pc.remoteDescription) {
              await pc.setRemoteDescription(data.answer);
              for (const c of pendingRef.current.splice(0)) await pc.addIceCandidate(c);
              setStatus("Connected");
            }
          } catch (err) { console.error("Video signaling error", err); setError(err?.message || "Could not connect the video session."); }
        }, err => { console.error(err); setError(err?.code === "permission-denied" ? "Video session permission denied. Please publish the updated Firestore Rules." : "Could not connect to the video session."); });
        if (caller) {
          const callId = `${myUid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; callIdRef.current = callId; listenCandidates(callId);
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true }); await pc.setLocalDescription(offer);
          await setDoc(roomRef, { callId, callerId: myUid, calleeId: peerUid, offer: { type: offer.type, sdp: offer.sdp }, answer: null, status: "calling", startedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          setStatus(role === "student" ? "Waiting for tutor..." : "Waiting for student...");
        } else setStatus(role === "student" ? "Waiting for tutor to start..." : "Waiting for student to start...");
      } catch (err) { console.error(err); setStatus("Video session unavailable"); setError(err?.name === "NotAllowedError" ? "Camera and microphone permission is required for the video session." : err?.message || "Could not start the video session."); }
    };
    start();
    return () => { stopped = true; roomUnsub.current?.(); candUnsub.current?.(); pcRef.current?.close(); streamRef.current?.getTracks().forEach(t => t.stop()); roomUnsub.current = null; candUnsub.current = null; pcRef.current = null; streamRef.current = null; pendingRef.current = []; callIdRef.current = null; };
  }, [session?.id, session?.studentId, session?.tutorId, session?.mode, role]);

  const toggleMic = () => { const next = !micOn; streamRef.current?.getAudioTracks().forEach(t => t.enabled = next); setMicOn(next); };
  const toggleCamera = () => { const next = !cameraOn; streamRef.current?.getVideoTracks().forEach(t => t.enabled = next); setCameraOn(next); };

  const peerName = role === "student"
    ? session?.tutor?.name || session?.tutorName || "Tutor"
    : session?.studentName || session?.student || "Student";
  const subject = session?.subject || "General";
  const isConnected = status === "Connected";

  return (
    <div className="learnora-video-overlay" role="dialog" aria-modal="true">
      <style>{`
        .learnora-video-overlay{
          position:fixed;inset:0;z-index:9999;padding:18px;box-sizing:border-box;
          background:
            radial-gradient(circle at 15% 10%,rgba(124,92,255,.16),transparent 28%),
            radial-gradient(circle at 85% 18%,rgba(79,70,229,.13),transparent 30%),
            linear-gradient(135deg,#060711 0%,#090817 48%,#070b18 100%);
          color:#fff;display:flex;flex-direction:column;overflow:hidden;
        }
        .learnora-video-shell{
          width:100%;height:100%;min-height:0;display:flex;flex-direction:column;
          max-width:1500px;margin:0 auto;
        }
        .learnora-video-topbar{
          height:66px;display:flex;align-items:center;justify-content:space-between;
          gap:18px;margin-bottom:14px;padding:0 4px;
        }
        .learnora-video-identity{display:flex;align-items:center;gap:12px;min-width:0}
        .learnora-video-icon{
          width:46px;height:46px;border-radius:15px;display:grid;place-items:center;
          background:linear-gradient(135deg,#6d3df0,#8b5cf6);
          box-shadow:0 12px 32px rgba(109,61,240,.28);font-size:22px;flex:0 0 auto;
        }
        .learnora-video-title{min-width:0}
        .learnora-video-title strong{display:block;font-size:16px;letter-spacing:.1px}
        .learnora-video-title span{
          display:block;margin-top:4px;color:#8f899d;font-size:10px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .learnora-video-status{
          display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:999px;
          background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);
          color:#b9b2c5;font-size:10px;font-weight:800;white-space:nowrap;
        }
        .learnora-video-status-dot{
          width:7px;height:7px;border-radius:50%;background:#77718a;
          box-shadow:0 0 0 4px rgba(119,113,138,.08);
        }
        .learnora-video-status-dot.connected{
          background:#62e6a2;box-shadow:0 0 0 4px rgba(98,230,162,.10),0 0 14px rgba(98,230,162,.6);
        }
        .learnora-video-stage{
          position:relative;flex:1;min-height:0;border-radius:24px;overflow:hidden;
          background:#020307;border:1px solid rgba(255,255,255,.09);
          box-shadow:0 30px 90px rgba(0,0,0,.46),inset 0 0 80px rgba(124,92,255,.035);
        }
        .learnora-video-remote{
          width:100%;height:100%;display:block;object-fit:cover;background:#03040a;
        }
        .learnora-video-empty{
          position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
          background:
            radial-gradient(circle at 50% 38%,rgba(124,92,255,.12),transparent 24%),
            linear-gradient(180deg,rgba(8,8,18,.15),rgba(3,4,9,.92));
          pointer-events:none;
        }
        .learnora-video-empty-card{text-align:center;padding:30px}
        .learnora-video-empty-avatar{
          width:88px;height:88px;border-radius:28px;margin:0 auto 15px;display:grid;place-items:center;
          background:linear-gradient(145deg,rgba(124,92,255,.28),rgba(255,255,255,.06));
          border:1px solid rgba(167,139,250,.24);font-size:38px;
          box-shadow:0 18px 50px rgba(0,0,0,.32);
        }
        .learnora-video-empty-card strong{display:block;font-size:17px}
        .learnora-video-empty-card span{display:block;margin-top:7px;color:#817b8e;font-size:11px}
        .learnora-video-local{
          position:absolute;right:18px;top:18px;width:min(24vw,280px);aspect-ratio:16/10;
          object-fit:cover;background:#0a0b12;border-radius:18px;
          border:1px solid rgba(255,255,255,.15);
          box-shadow:0 18px 45px rgba(0,0,0,.45);
        }
        .learnora-video-local-label{
          position:absolute;right:29px;top:29px;padding:5px 8px;border-radius:8px;
          background:rgba(0,0,0,.52);backdrop-filter:blur(10px);color:#e7e3ed;
          font-size:8px;font-weight:800;pointer-events:none;
        }
        .learnora-video-session-chip{
          position:absolute;left:18px;top:18px;padding:9px 11px;border-radius:12px;
          background:rgba(8,8,18,.58);backdrop-filter:blur(14px);
          border:1px solid rgba(255,255,255,.09);font-size:9px;color:#c7c1d0;
        }
        .learnora-video-session-chip b{color:#fff}
        .learnora-video-error{
          position:absolute;left:18px;right:18px;bottom:18px;z-index:3;
          padding:11px 13px;border-radius:13px;background:rgba(70,15,25,.78);
          border:1px solid rgba(248,113,113,.24);backdrop-filter:blur(12px);
          color:#fecaca;font-size:10px;line-height:1.55;
        }
        .learnora-video-controls{
          display:flex;align-items:center;justify-content:center;gap:10px;
          padding:16px 0 2px;
        }
        .learnora-video-control{
          min-width:48px;height:46px;padding:0 16px;border-radius:14px;
          border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.055);
          color:#eeeaf3;cursor:pointer;font-size:11px;font-weight:800;
          transition:transform .18s ease,background .18s ease,border-color .18s ease;
          backdrop-filter:blur(12px);
        }
        .learnora-video-control:hover{transform:translateY(-2px);background:rgba(255,255,255,.09);border-color:rgba(167,139,250,.28)}
        .learnora-video-control.off{background:rgba(239,68,68,.11);border-color:rgba(239,68,68,.24);color:#fecaca}
        .learnora-video-end{
          min-width:118px;background:linear-gradient(135deg,#dc3d61,#ef4444);
          border-color:rgba(255,255,255,.08);box-shadow:0 12px 30px rgba(220,61,97,.22);
        }
        .learnora-video-end:hover{background:linear-gradient(135deg,#e14a6b,#f05252)}
        @media(max-width:720px){
          .learnora-video-overlay{padding:10px}
          .learnora-video-topbar{height:58px;margin-bottom:10px}
          .learnora-video-icon{width:40px;height:40px;border-radius:13px;font-size:19px}
          .learnora-video-title strong{font-size:14px}
          .learnora-video-title span{font-size:9px}
          .learnora-video-status{padding:7px 9px}
          .learnora-video-stage{border-radius:18px}
          .learnora-video-local{right:10px;top:10px;width:34vw;border-radius:13px}
          .learnora-video-local-label{right:19px;top:19px}
          .learnora-video-session-chip{left:10px;top:10px}
          .learnora-video-controls{gap:7px;padding-top:11px}
          .learnora-video-control{height:43px;padding:0 11px;font-size:10px}
          .learnora-video-end{min-width:92px}
        }
      `}</style>

      <div className="learnora-video-shell">
        <header className="learnora-video-topbar">
          <div className="learnora-video-identity">
            <div className="learnora-video-icon">🎥</div>
            <div className="learnora-video-title">
              <strong>Private 1-to-1 Video Session</strong>
              <span>{peerName} • {subject} • {role === "student" ? "Student" : "Tutor"}</span>
            </div>
          </div>

          <div className="learnora-video-status">
            <i className={`learnora-video-status-dot${isConnected ? " connected" : ""}`} />
            {status}
          </div>
        </header>

        <section className="learnora-video-stage">
          <video ref={remoteRef} autoPlay playsInline className="learnora-video-remote" />

          {!isConnected && (
            <div className="learnora-video-empty">
              <div className="learnora-video-empty-card">
                <div className="learnora-video-empty-avatar">
                  {role === "student" ? "👨‍🏫" : "🎓"}
                </div>
                <strong>{peerName}</strong>
                <span>{status}</span>
              </div>
            </div>
          )}

          <div className="learnora-video-session-chip">
            <b>LIVE SESSION</b> · {subject}
          </div>

          <video ref={localRef} autoPlay playsInline muted className="learnora-video-local" />
          <div className="learnora-video-local-label">YOU</div>

          {error && <div className="learnora-video-error">⚠ {error}</div>}
        </section>

        <div className="learnora-video-controls">
          <button
            type="button"
            className={`learnora-video-control${micOn ? "" : " off"}`}
            onClick={toggleMic}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
          >
            {micOn ? "🎙️ Mic" : "🔇 Muted"}
          </button>

          <button
            type="button"
            className={`learnora-video-control${cameraOn ? "" : " off"}`}
            onClick={toggleCamera}
            aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
          >
            {cameraOn ? "📹 Camera" : "📷 Camera Off"}
          </button>

          <button
            type="button"
            className="learnora-video-control learnora-video-end"
            onClick={onClose}
          >
            End Session
          </button>
        </div>
      </div>
    </div>
  );
}

function chatIsActiveSession(session) {
  return [
    "Accepted",
    "Confirmed",
    "Tutor Assigned",
    "Offline Session Confirmed & Active",
  ].includes(session?.status);
}

function normalizeChatSession(session, role) {
  if (!session?.id) return null;

  const studentId = session.studentId || "";
  const tutorId = session.tutorId || (role === "tutor" ? auth.currentUser?.uid || "" : "");
  if (!studentId || !tutorId) return null;

  const studentName =
    session.studentName || session.student || "Student";
  const tutorName =
    session.tutorName || session.tutor?.name || "Tutor";

  return {
    ...session,
    id: session.id,
    studentId,
    tutorId,
    studentName,
    tutorName,
    tutor: session.tutor || { name: tutorName, subject: session.subject || "General" },
    subject: session.subject || session.tutor?.subject || "General",
    status: session.status || "Confirmed",
    date: session.date || "",
    time: session.time || "",
  };
}

function ChatPresenceTracker({ sessions = [], role }) {
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;

    const active = sessions
      .filter(chatIsActiveSession)
      .map((session) => normalizeChatSession(session, role))
      .filter(Boolean);

    let stopped = false;

    const writePresence = async (online) => {
      if (stopped) return;
      await Promise.all(
        active.map(async (session) => {
          try {
            await setDoc(
              doc(db, "sessions", session.id, "presence", uid),
              {
                uid,
                online,
                lastSeen: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } catch (error) {
            console.error("Chat presence update error:", error);
          }
        })
      );
    };

    writePresence(true);

    const heartbeat = setInterval(() => {
      writePresence(document.visibilityState !== "hidden");
    }, 30000);

    const handleVisibility = () => {
      writePresence(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopped = true;
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", handleVisibility);
      active.forEach((session) => {
        setDoc(
          doc(db, "sessions", session.id, "presence", uid),
          {
            uid,
            online: false,
            lastSeen: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
      });
    };
  }, [
    role,
    sessions
      .filter(chatIsActiveSession)
      .map((session) => `${session.id}:${session.status}:${session.studentId}:${session.tutorId}`)
      .join("|"),
  ]);

  return null;
}

function ChatInbox({
  sessions = [],
  role,
  selectedSessionId,
  onSelectSession,
  onUnreadChange,
}) {
  const myUid = auth.currentUser?.uid || "";

  const chatSessions = sessions
    .filter(chatIsActiveSession)
    .map((session) => normalizeChatSession(session, role))
    .filter(Boolean)
    .filter((session, index, array) =>
      array.findIndex((item) => item.id === session.id) === index
    );

  const sessionKey = chatSessions
    .map((session) => `${session.id}:${session.status}:${session.studentId}:${session.tutorId}`)
    .join("|");

  const [summaries, setSummaries] = useState({});
  const [peerOnline, setPeerOnline] = useState({});
  const [localSelectedId, setLocalSelectedId] = useState(selectedSessionId || null);

  useEffect(() => {
    if (selectedSessionId !== undefined && selectedSessionId !== null) {
      setLocalSelectedId(selectedSessionId);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    const unsubs = [];
    const nextSummaries = {};

    if (!myUid || !chatSessions.length) {
      setSummaries({});
      onUnreadChange?.(0);
      return undefined;
    }

    chatSessions.forEach((session) => {
      const messagesRef = collection(db, "sessions", session.id, "messages");

      const unsubscribe = onSnapshot(
        messagesRef,
        (snapshot) => {
          const messages = snapshot.docs
            .map((messageDoc) => ({
              id: messageDoc.id,
              ...messageDoc.data(),
            }))
            .sort((a, b) => {
              const aTime = a.createdAt?.toMillis?.() || 0;
              const bTime = b.createdAt?.toMillis?.() || 0;
              return bTime - aTime;
            });

          const latest = messages[0] || null;
          const unread = messages.filter(
            (message) =>
              message.senderId &&
              message.senderId !== myUid &&
              !message.readBy?.[myUid]
          ).length;

          nextSummaries[session.id] = {
            latest,
            unread,
            updatedAtMs: latest?.createdAt?.toMillis?.() || 0,
          };

          setSummaries((previous) => ({
            ...previous,
            [session.id]: nextSummaries[session.id],
          }));
        },
        (error) => {
          console.error("Chat inbox listener error:", error);
        }
      );

      unsubs.push(unsubscribe);
    });

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [myUid, sessionKey]);

  useEffect(() => {
    const unsubs = [];
    if (!myUid) return undefined;

    chatSessions.forEach((session) => {
      const peerUid = role === "student" ? session.tutorId : session.studentId;
      if (!peerUid) return;

      const presenceRef = doc(db, "sessions", session.id, "presence", peerUid);
      const unsubscribe = onSnapshot(
        presenceRef,
        (snapshot) => {
          const data = snapshot.exists() ? snapshot.data() : {};
          setPeerOnline((previous) => ({
            ...previous,
            [session.id]: data.online === true,
          }));
        },
        (error) => {
          console.error("Chat presence listener error:", error);
        }
      );

      unsubs.push(unsubscribe);
    });

    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [myUid, role, sessionKey]);

  const totalUnread = chatSessions.reduce(
    (sum, session) => sum + (summaries[session.id]?.unread || 0),
    0
  );

  useEffect(() => {
    onUnreadChange?.(totalUnread);
  }, [totalUnread, onUnreadChange]);

  useEffect(() => {
    if (!chatSessions.length) {
      if (localSelectedId) setLocalSelectedId(null);
      return;
    }

    const exists = chatSessions.some((session) => session.id === localSelectedId);
    if (!exists) {
      const first = [...chatSessions].sort(
        (a, b) =>
          (summaries[b.id]?.updatedAtMs || 0) -
          (summaries[a.id]?.updatedAtMs || 0)
      )[0];
      setLocalSelectedId(first?.id || null);
      onSelectSession?.(first?.id || null);
    }
  }, [sessionKey, localSelectedId]);

  const selected =
    chatSessions.find((session) => session.id === localSelectedId) || null;

  const selectSession = (id) => {
    setLocalSelectedId(id);
    onSelectSession?.(id);
  };

  return (
    <>
      <style>{CHAT_FEATURE_CSS}</style>
      <div className="learnora-chat-inbox">
      <div className="chat-conversation-list">
        <div className="chat-inbox-heading">
          <div>
            <strong>Your Conversations</strong>
            <span>Only accepted bookings</span>
          </div>
          {totalUnread > 0 && (
            <b>{totalUnread > 99 ? "99+" : totalUnread} unread</b>
          )}
        </div>

        {chatSessions.length === 0 ? (
          <div className="chat-inbox-empty">
            <div>💬</div>
            <strong>No active tutor conversations</strong>
            <span>Book a tutor and get the session accepted to start a private chat.</span>
          </div>
        ) : (
          [...chatSessions]
            .sort(
              (a, b) =>
                (summaries[b.id]?.updatedAtMs || 0) -
                (summaries[a.id]?.updatedAtMs || 0)
            )
            .map((session) => {
              const summary = summaries[session.id] || {};
              const peerName =
                role === "student" ? session.tutorName : session.studentName;
              const peerUid =
                role === "student" ? session.tutorId : session.studentId;
              const unread = summary.unread || 0;
              const preview =
                summary.latest?.text ||
                `${session.subject || "Learning"} session`;
              const online = peerOnline[session.id] === true;

              return (
                <button
                  key={session.id}
                  type="button"
                  className={`chat-conversation-item${selected?.id === session.id ? " active" : ""}`}
                  onClick={() => selectSession(session.id)}
                >
                  <span className="chat-conversation-avatar">
                    {(peerName || "U").charAt(0).toUpperCase()}
                    <i className={online ? "online" : ""} />
                  </span>

                  <span className="chat-conversation-main">
                    <span className="chat-conversation-top">
                      <strong>{peerName}</strong>
                      {summary.latest?.createdAt?.toDate?.() && (
                        <small>
                          {summary.latest.createdAt.toDate().toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      )}
                    </span>
                    <span className="chat-conversation-subject">
                      {session.subject || "General"}
                    </span>
                    <span className="chat-conversation-preview">
                      {preview.length > 58 ? `${preview.slice(0, 58)}…` : preview}
                    </span>
                  </span>

                  {unread > 0 && (
                    <b className="chat-unread-badge">
                      {unread > 99 ? "99+" : unread}
                    </b>
                  )}
                </button>
              );
            })
        )}
      </div>

      <div className="chat-conversation-window">
        {selected ? (
          <LiveChat
            session={selected}
            role={role}
          />
        ) : (
          <div className="chat-select-empty">
            <div>💬</div>
            <strong>Select a conversation</strong>
            <span>Choose an accepted booking to open its private chat.</span>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function LiveChat({ session, role, onClose, overlay = false }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [typingIndicator, setTypingIndicator] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimerRef = useRef(null);
  const typingActiveRef = useRef(false);

  const sessionId = session?.id || "";
  const myUid = auth.currentUser?.uid || "";
  const isStudent = role === "student";
  const peerName = isStudent
    ? session?.tutor?.name || session?.tutorName || "Tutor"
    : session?.studentName || session?.student || "Student";
  const subject = session?.subject || "General";

  useEffect(() => {
    if (!sessionId || !myUid) {
      setMessages([]);
      return undefined;
    }

    setChatError("");
    const messagesRef = collection(db, "sessions", sessionId, "messages");

    const unsubscribe = onSnapshot(
      messagesRef,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((messageDoc) => {
            const data = messageDoc.data();
            return {
              id: messageDoc.id,
              senderId: data.senderId || "",
              text: data.text || "",
              readBy: data.readBy || {},
              readAt: data.readAt || {},
              time: data.createdAt?.toDate?.()
                ? data.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "",
              createdAtMs: data.createdAt?.toMillis?.() || 0,
            };
          })
          .filter((message) => message.text)
          .sort((a, b) => a.createdAtMs - b.createdAtMs);

        setMessages(loaded);
      },
      (error) => {
        console.error("Live chat listener error:", error);
        setChatError(
          error?.code === "permission-denied"
            ? "Chat permission denied. Please publish the updated Firestore Rules."
            : "Could not load the chat. Please try again."
        );
      }
    );

    return () => unsubscribe();
  }, [sessionId, myUid]);

  useEffect(() => {
    if (!sessionId || !myUid) return undefined;

    const peerUid = isStudent ? session?.tutorId : session?.studentId;
    if (!peerUid) return undefined;

    return onSnapshot(
      doc(db, "sessions", sessionId, "presence", peerUid),
      (snapshot) => {
        setPeerOnline(snapshot.exists() && snapshot.data()?.online === true);
      },
      (error) => console.error("Live chat presence error:", error)
    );
  }, [sessionId, myUid, isStudent, session?.tutorId, session?.studentId]);

  useEffect(() => {
    if (!sessionId || !myUid || !messages.length) return;

    const unread = messages.filter(
      (message) => message.senderId && message.senderId !== myUid && !message.readBy?.[myUid]
    );

    if (!unread.length) return;

    Promise.all(
      unread.map((message) =>
        updateDoc(doc(db, "sessions", sessionId, "messages", message.id), {
          [`readBy.${myUid}`]: true,
          [`readAt.${myUid}`]: serverTimestamp(),
        }).catch((error) => {
          console.error("Read receipt update error:", error);
        })
      )
    );
  }, [messages, sessionId, myUid]);

  useEffect(() => {
    if (!sessionId || !myUid) return undefined;

    const peerUid = isStudent ? session?.tutorId : session?.studentId;
    if (!peerUid) return undefined;

    const typingRef = doc(db, "sessions", sessionId, "typing", peerUid);

    const unsubscribe = onSnapshot(
      typingRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        const expiresAt = Number(data.expiresAt || 0);
        setTypingIndicator(data.typing === true && (!expiresAt || expiresAt > Date.now()));
      },
      (error) => console.error("Typing listener error:", error)
    );

    return () => unsubscribe();
  }, [sessionId, myUid, isStudent, session?.tutorId, session?.studentId]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimerRef.current);
      if (sessionId && myUid && typingActiveRef.current) {
        setDoc(
          doc(db, "sessions", sessionId, "typing", myUid),
          { uid: myUid, typing: false, expiresAt: 0, updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {});
      }
    };
  }, [sessionId, myUid]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function setTypingState(typing) {
    if (!sessionId || !myUid) return;

    try {
      await setDoc(
        doc(db, "sessions", sessionId, "typing", myUid),
        {
          uid: myUid,
          typing,
          expiresAt: typing ? Date.now() + 4000 : 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      typingActiveRef.current = typing;
    } catch (error) {
      console.error("Typing state update error:", error);
    }
  }

  function handleMessageInput(event) {
    const value = event.target.value;
    setText(value);

    clearTimeout(typingTimerRef.current);

    if (value.trim()) {
      if (!typingActiveRef.current) setTypingState(true);
      typingTimerRef.current = setTimeout(() => setTypingState(false), 1400);
    } else {
      setTypingState(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const cleanText = text.trim();
    const user = auth.currentUser;

    if (!cleanText || sending) return;
    if (!user) {
      setChatError("Please login again.");
      return;
    }
    if (!sessionId || !session?.studentId || !session?.tutorId) {
      setChatError("This chat is not linked to a valid student-tutor session.");
      return;
    }
    if (!["Accepted", "Confirmed", "Tutor Assigned", "Offline Session Confirmed & Active"].includes(session.status)) {
      setChatError("Chat is available after the tutor accepts the session.");
      return;
    }

    setSending(true);
    setChatError("");

    try {
      await addDoc(collection(db, "sessions", sessionId, "messages"), {
        senderId: user.uid,
        sender: role,
        text: cleanText,
        readBy: { [user.uid]: true },
        readAt: { [user.uid]: serverTimestamp() },
        createdAt: serverTimestamp(),
      });
      setText("");
      clearTimeout(typingTimerRef.current);
      if (typingActiveRef.current) await setTypingState(false);
    } catch (error) {
      console.error("Send chat message error:", error);
      setChatError(
        error?.code === "permission-denied"
          ? "Message permission denied. Please publish the updated Firestore Rules."
          : "Could not send the message. Please try again."
      );
    } finally {
      setSending(false);
    }
  }

  const shell = (
    <div className="tutor-chat-shell">
      <div className="tutor-chat-header">
        <div className="chat-tutor-avatar">{peerName.charAt(0).toUpperCase()}</div>
        <div className="chat-tutor-info">
          <h2>{peerName}</h2>
          <p>{subject}</p>
          <span className="chat-online">
            <i className={peerOnline ? "peer-online" : ""} />
            {peerOnline ? "Online" : "Offline"} • Private Chat
          </span>
          {typingIndicator && (
            <span className="chat-typing-indicator">● typing…</span>
          )}
        </div>
      </div>

      {chatError && (
        <div style={{ margin: "10px 14px 0", padding: "10px 12px", borderRadius: 11, background: "rgba(239,68,68,.12)", color: "#fecaca", fontSize: 11 }}>
          {chatError}
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div style={{ margin: "auto", textAlign: "center", color: "#77738b", fontSize: 11 }}>
            No messages yet. Start the conversation.
          </div>
        ) : (
          messages.map((message) => {
            const mine = message.senderId === myUid;
            return (
              <div key={message.id} className={mine ? "chat-message student" : "chat-message tutor"}>
                <div className="chat-bubble">
                  <p>{message.text}</p>
                  <small>{message.time}</small>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-row" onSubmit={sendMessage}>
        <button type="button" className="chat-attach" onClick={() => alert("Attachment upload will be connected next.")} title="Attach file">📎</button>
        <input value={text} onChange={handleMessageInput} placeholder={isStudent ? "Type a message to your tutor..." : "Type a message to your student..."} aria-label="Message" disabled={sending} />
        <button type="submit" className="chat-send" disabled={sending}>{sending ? "Sending..." : "Send ➤"}</button>
      </form>
    </div>
  );

  if (!overlay) return shell;

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(5,5,15,.82)", display: "grid", placeItems: "center", padding: 20, boxSizing: "border-box" }} onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <div style={{ width: "min(900px,100%)", height: "min(680px,calc(100vh - 40px))" }}>{shell}</div>
    </div>
  );
}

const INSTANT_STUDENT_BOOKING_CSS = `
/* INSTANT HUMAN TUTOR — STUDENT BOOKING UI ONLY
   This style is mounted inside StudentDashboard so it does not depend on
   external CSS loading and does not affect any other page/session. */
.instant-human-page{
  width:100%;
  max-width:1180px;
  margin:0 auto;
  padding:24px 28px 60px;
  color:#f5f7ff;
}
.instant-human-page *{box-sizing:border-box}
.instant-human-page .instant-booking-hero{
  position:relative;
  overflow:hidden;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:34px;
  min-height:238px;
  padding:32px 34px;
  border:1px solid rgba(70,184,255,.28);
  border-radius:26px;
  background:
    radial-gradient(circle at 86% 18%,rgba(38,180,255,.20),transparent 27%),
    radial-gradient(circle at 12% 100%,rgba(116,78,255,.20),transparent 42%),
    linear-gradient(135deg,rgba(13,28,61,.96),rgba(7,12,30,.98));
  box-shadow:0 24px 65px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.07);
}
.instant-human-page .instant-booking-hero:before{
  content:"";
  position:absolute;
  width:260px;height:260px;
  right:-100px;top:-130px;
  border-radius:50%;
  border:1px solid rgba(45,192,255,.12);
  box-shadow:0 0 70px rgba(45,192,255,.08);
  pointer-events:none;
}
.instant-human-page .instant-hero-copy{position:relative;z-index:2;max-width:720px}
.instant-human-page .instant-hero-eyebrow{
  display:flex;align-items:center;gap:9px;
  margin-bottom:12px;
  color:#65caff;font-size:11px;font-weight:800;letter-spacing:1.5px;
}
.instant-human-page .instant-pulse-dot{
  width:9px;height:9px;flex:0 0 9px;border-radius:50%;
  background:#42e58c;box-shadow:0 0 15px rgba(66,229,140,.9);
}
.instant-human-page .instant-booking-hero h1{
  margin:0;color:#fff;font-size:clamp(30px,4vw,46px);line-height:1.08;letter-spacing:-1.5px;font-weight:850;
}
.instant-human-page .instant-booking-hero h1 span{color:#35c8ff;text-shadow:0 0 22px rgba(53,200,255,.35)}
.instant-human-page .instant-booking-hero p{
  max-width:680px;margin:12px 0 0;color:#9caac7;font-size:14px;line-height:1.65;
}
.instant-human-page .instant-hero-features{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.instant-human-page .instant-hero-features span{
  padding:8px 11px;border:1px solid rgba(255,255,255,.09);border-radius:999px;
  background:rgba(255,255,255,.045);color:#cbd7ed;font-size:10px;font-weight:700;
}
.instant-human-page .instant-live-orb{
  position:relative;z-index:2;flex:0 0 168px;width:168px;height:168px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  border:1px solid rgba(48,195,255,.30);border-radius:32px;
  background:radial-gradient(circle at 50% 35%,rgba(38,179,255,.17),transparent 52%),rgba(4,10,27,.72);
  box-shadow:0 0 50px rgba(34,171,255,.10),inset 0 0 38px rgba(74,88,255,.06);
}
.instant-human-page .instant-orb-ring{
  width:68px;height:68px;display:grid;place-items:center;border-radius:50%;
  border:1px solid rgba(76,203,255,.62);background:rgba(41,166,255,.10);
  color:#fff;font-size:28px;box-shadow:0 0 35px rgba(38,179,255,.22);
}
.instant-human-page .instant-live-orb strong{margin-top:11px;color:#78efaa;font-size:11px;letter-spacing:2px}
.instant-human-page .instant-live-orb small{margin-top:4px;color:#7f91b2;font-size:9px}
.instant-human-page .instant-request-banner{
  display:flex;align-items:center;gap:13px;margin:16px 0;padding:14px 16px;
  border:1px solid rgba(101,139,255,.26);border-radius:17px;
  background:linear-gradient(110deg,rgba(60,87,255,.12),rgba(36,204,145,.045));
  box-shadow:0 12px 32px rgba(0,0,0,.16);
}
.instant-human-page .instant-request-orb{
  width:40px;height:40px;flex:0 0 40px;display:grid;place-items:center;border-radius:12px;
  background:rgba(49,165,255,.12);border:1px solid rgba(49,165,255,.22);color:#68ccff;font-weight:900;
}
.instant-human-page .instant-request-banner strong{display:block;color:#fff;font-size:12px}
.instant-human-page .instant-request-banner p{margin:4px 0 0;color:#8998b7;font-size:10px;line-height:1.5}
.instant-human-page .instant-status-pill{
  margin-left:auto;padding:7px 10px;border-radius:999px;font-size:8px;font-weight:900;letter-spacing:.8px;
}
.instant-human-page .instant-status-pill.pending{color:#ffd56a;background:rgba(255,188,47,.09);border:1px solid rgba(255,188,47,.16)}
.instant-human-page .instant-status-pill.accepted{color:#8df2b5;background:rgba(47,224,137,.08);border:1px solid rgba(47,224,137,.16)}
.instant-human-page .instant-human-card{
  overflow:hidden;padding:25px;border:1px solid rgba(90,155,230,.20);border-radius:23px;
  background:linear-gradient(145deg,rgba(14,28,57,.84),rgba(7,14,31,.94));
  box-shadow:0 22px 60px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.045);
}
.instant-human-page .instant-card-head{
  display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:21px;
}
.instant-human-page .instant-section-label{display:flex;align-items:center;gap:7px;color:#65dfa0;font-size:9px;font-weight:900;letter-spacing:1.4px}
.instant-human-page .instant-section-label i{width:6px;height:6px;border-radius:50%;background:#45e28d;box-shadow:0 0 11px rgba(69,226,141,.8)}
.instant-human-page .instant-card-head h2{margin:7px 0 6px;color:#fff;font-size:23px;letter-spacing:-.4px}
.instant-human-page .instant-card-head p{margin:0;color:#8290ad;font-size:11px;line-height:1.6}
.instant-human-page .instant-count-card{
  min-width:105px;padding:12px 15px;text-align:center;border:1px solid rgba(44,193,255,.24);border-radius:15px;
  background:linear-gradient(145deg,rgba(32,144,220,.12),rgba(67,71,255,.06));
}
.instant-human-page .instant-count-card strong{display:block;color:#4ac8ff;font-size:27px;line-height:1;font-weight:850}
.instant-human-page .instant-count-card span{display:block;margin-top:5px;color:#8fa0c0;font-size:8px;font-weight:800;letter-spacing:1px}
.instant-human-page .instant-tutor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.instant-human-page .instant-tutor-card{
  position:relative;overflow:hidden;min-height:315px;padding:20px;
  border:1px solid rgba(108,165,232,.19);border-radius:19px;
  background:radial-gradient(circle at 100% 0%,rgba(37,172,255,.10),transparent 32%),linear-gradient(145deg,rgba(19,35,67,.88),rgba(9,16,34,.96));
  transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease;
}
.instant-human-page .instant-tutor-card:hover{
  transform:translateY(-4px);border-color:rgba(67,197,255,.45);
  box-shadow:0 18px 45px rgba(0,0,0,.28),0 0 32px rgba(40,174,255,.08);
}
.instant-human-page .instant-tutor-card-glow{position:absolute;width:150px;height:150px;right:-80px;top:-80px;border-radius:50%;background:rgba(77,88,255,.13);filter:blur(10px);pointer-events:none}
.instant-human-page .instant-tutor-top{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;margin-bottom:17px}
.instant-human-page .instant-tutor-avatar-wrap{position:relative;width:58px;height:58px}
.instant-human-page .instant-tutor-avatar{
  width:58px;height:58px;display:grid;place-items:center;border-radius:17px;
  background:linear-gradient(145deg,#267fff,#714cff);border:1px solid rgba(115,208,255,.28);
  color:#fff;font-size:22px;font-weight:850;box-shadow:0 10px 28px rgba(44,112,255,.25);
}
.instant-human-page .instant-avatar-online{position:absolute;right:-3px;bottom:-3px;width:16px;height:16px;display:grid;place-items:center;border-radius:50%;background:#0a1328;border:2px solid #0a1328}
.instant-human-page .instant-avatar-online i{width:8px;height:8px;border-radius:50%;background:#42e58c;box-shadow:0 0 10px rgba(66,229,140,.9)}
.instant-human-page .instant-ready-pill{display:flex;align-items:center;gap:6px;padding:7px 10px;border:1px solid rgba(58,229,140,.22);border-radius:999px;background:rgba(58,229,140,.07);color:#9af4bd;font-size:8px;font-weight:850}
.instant-human-page .instant-ready-pill i{width:6px;height:6px;border-radius:50%;background:#45e28d;box-shadow:0 0 9px rgba(69,226,141,.9)}
.instant-human-page .instant-tutor-identity{position:relative;z-index:1}
.instant-human-page .instant-tutor-identity h3{margin:0;color:#fff;font-size:18px;font-weight:850}
.instant-human-page .instant-tutor-identity span{display:flex;align-items:center;gap:6px;margin-top:5px;color:#8fa0bc;font-size:9px}
.instant-human-page .instant-tutor-identity span b{color:#43c6ff;font-size:11px}
.instant-human-page .instant-tutor-subject{display:flex;align-items:center;gap:7px;margin:14px 0 10px;color:#8b9ab5;font-size:10px}
.instant-human-page .instant-tutor-subject strong{color:#d8e2f4;font-size:12px}
.instant-human-page .instant-tutor-meta{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
.instant-human-page .instant-tutor-meta span{padding:7px 9px;border:1px solid rgba(255,255,255,.065);border-radius:9px;background:rgba(255,255,255,.035);color:#a5b2c8;font-size:9px}
.instant-human-page .instant-connect-options{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:16px}
.instant-human-page .instant-connect-options span{padding:9px 5px;text-align:center;border:1px solid rgba(70,150,255,.12);border-radius:10px;background:rgba(38,123,220,.07);color:#b8d2f2;font-size:9px;font-weight:700}
.instant-human-page .instant-request-button{
  position:relative;z-index:2;width:100%;min-height:45px;display:flex!important;align-items:center;justify-content:center;gap:8px;
  border:0!important;border-radius:12px!important;padding:12px 14px!important;
  background:linear-gradient(100deg,#247dff,#704dff 55%,#19c9ff)!important;
  color:#fff!important;font-size:11px!important;font-weight:850!important;cursor:pointer;
  box-shadow:0 12px 28px rgba(44,112,255,.24);transition:transform .18s ease,box-shadow .18s ease,opacity .18s ease;
}
.instant-human-page .instant-request-button:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 16px 36px rgba(44,112,255,.34),0 0 24px rgba(31,190,255,.10)}
.instant-human-page .instant-request-button:disabled{opacity:.58;cursor:not-allowed}
.instant-human-page .instant-request-button b{font-size:15px}
.instant-human-page .instant-empty-state{min-height:210px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;border:1px dashed rgba(80,160,240,.18);border-radius:16px;background:rgba(255,255,255,.015)}
.instant-human-page .instant-empty-icon{width:52px;height:52px;display:grid;place-items:center;margin-bottom:11px;border-radius:16px;background:rgba(53,155,255,.08);border:1px solid rgba(53,155,255,.14);color:#55c8ff;font-size:23px}
.instant-human-page .instant-empty-state h3{margin:0 0 6px;color:#e9effc;font-size:14px}
.instant-human-page .instant-empty-state p{margin:0;color:#7e8ca7;font-size:10px;line-height:1.6}
.instant-human-page .instant-loading-line{width:170px;height:4px;margin-top:16px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}
.instant-human-page .instant-loading-line i{display:block;width:45%;height:100%;border-radius:inherit;background:linear-gradient(90deg,transparent,#42c5ff,transparent);animation:instantStudentLoading 1.15s linear infinite}
.instant-human-page .instant-bypass-note{display:flex;align-items:center;gap:10px;margin-top:14px;padding:13px 15px;border:1px solid rgba(255,155,81,.14);border-radius:14px;background:rgba(255,155,81,.035)}
.instant-human-page .instant-bypass-note>span:first-child{color:#ffb178;font-size:14px}
.instant-human-page .instant-bypass-note strong{display:block;color:#dbe5f7;font-size:9px}
.instant-human-page .instant-bypass-note p{margin:3px 0 0;color:#77849c;font-size:8px;line-height:1.55}
.instant-human-page .instant-secure-label{margin-left:auto;color:#8a98ae;font-size:7px;font-weight:850;white-space:nowrap}
@keyframes instantStudentLoading{from{transform:translateX(-120%)}to{transform:translateX(310%)}}
@media(max-width:900px){
  .instant-human-page{padding:20px 18px 45px}
  .instant-human-page .instant-booking-hero{padding:27px;gap:20px}
  .instant-human-page .instant-live-orb{flex-basis:130px;width:130px;height:130px}
  .instant-human-page .instant-orb-ring{width:58px;height:58px;font-size:24px}
  .instant-human-page .instant-tutor-grid{grid-template-columns:1fr}
}
@media(max-width:620px){
  .instant-human-page{padding:14px 12px 35px}
  .instant-human-page .instant-booking-hero{min-height:auto;flex-direction:column;align-items:flex-start;padding:23px}
  .instant-human-page .instant-live-orb{align-self:center}
  .instant-human-page .instant-card-head{align-items:flex-start;flex-direction:column}
  .instant-human-page .instant-count-card{align-self:flex-start}
  .instant-human-page .instant-human-card{padding:17px}
  .instant-human-page .instant-request-banner{align-items:flex-start;flex-wrap:wrap}
  .instant-human-page .instant-status-pill{margin-left:53px}
  .instant-human-page .instant-secure-label{display:none}
}
`;

function StudentDashboard({
  onLogout,
}) {

  const [activePage, setActivePage] =
    useState("home");

  // Tutor Chat state. No demo messages are seeded; messages are created by real user actions.
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [assignments, setAssignments] = useState([]);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [activeAssignment, setActiveAssignment] = useState(null);
  const [assignmentAnswer, setAssignmentAnswer] = useState("");
  const [notifications, setNotifications] = useState([]);

  const [subscription, setSubscription] =
    useState(null);

  const [walletTopupOpen, setWalletTopupOpen] = useState(false);
  const [walletTopupAmount, setWalletTopupAmount] = useState(500);
  const [walletPaymentMethod, setWalletPaymentMethod] = useState("online");
  const [walletBalance, setWalletBalance] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);

  const openWalletTopup = () => {
    setWalletTopupAmount(500);
    setWalletPaymentMethod("online");
    setWalletTopupOpen(true);
  };

  async function getPaymentAuthHeaders() {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) throw new Error("Please login again.");
    const token = await firebaseUser.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function createBackendPaymentOrder(type, extra = {}) {
    const response = await fetch(
      `${LATHSO_API_BASE}/api/payments/create-order`,
      {
        method: "POST",
        headers: await getPaymentAuthHeaders(),
        body: JSON.stringify({ type, ...extra }),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Could not create the payment order.");
    }
    return data;
  }

  async function verifyBackendPayment(paymentResponse) {
    const response = await fetch(
      `${LATHSO_API_BASE}/api/payments/verify`,
      {
        method: "POST",
        headers: await getPaymentAuthHeaders(),
        body: JSON.stringify(paymentResponse),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.message || "Payment verification failed.");
    }
    return data;
  }

  async function refreshWalletBalance() {
    try {
      const response = await fetch(
        `${LATHSO_API_BASE}/api/payments/wallet`,
        {
          method: "GET",
          headers: await getPaymentAuthHeaders(),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not load wallet balance.");
      }
      setWalletBalance(Number(data.balance || 0));
    } catch (error) {
      console.error("Wallet balance error:", error);
    }
  }

  useEffect(() => {
    if (auth.currentUser) refreshWalletBalance();
    return undefined;
  }, [auth.currentUser?.uid]);

  const saveSubscriptionPlan = async (plan) => {
    const firebaseUser = auth.currentUser;

    if (!firebaseUser) {
      alert("Please login again to select a subscription.");
      return;
    }

    // Free Trial remains the existing no-payment flow.
    if (plan.id === "free_trial") {
      try {
        await setDoc(
          doc(db, "subscriptions", firebaseUser.uid),
          {
            userId: firebaseUser.uid,
            planId: plan.id,
            planName: plan.name,
            price: plan.price,
            period: plan.period,
            description: plan.description,
            features: plan.features,
            active: true,
            paymentStatus: "free",
            selectedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        setSubscription({
          type: plan.id,
          planId: plan.id,
          planName: plan.name,
          price: plan.price,
          period: plan.period,
        });

        alert(`${plan.name} selected successfully.`);
      } catch (error) {
        console.error("Free subscription save error:", error);
        alert(
          error?.code === "permission-denied"
            ? "Subscription permission denied. Please publish the Firestore Rules."
            : "Could not save the subscription. Please try again."
        );
      }
      return;
    }

    if (paymentLoading) return;

    try {
      setPaymentLoading(true);
      await loadRazorpayCheckout();

      const order = await createBackendPaymentOrder(
        "subscription",
        { planId: plan.id }
      );

      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const checkout = new window.Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency || "INR",
          name: "Lathso",
          description: plan.description,
          order_id: order.orderId,
          prefill: {
            name: firebaseUser.displayName || "",
            email: firebaseUser.email || "",
          },
          theme: { color: "#ff7a3d" },

          handler: async (paymentResponse) => {
            try {
              await verifyBackendPayment({
                razorpay_payment_id: paymentResponse.razorpay_payment_id,
                razorpay_order_id: paymentResponse.razorpay_order_id,
                razorpay_signature: paymentResponse.razorpay_signature,
              });

              setSubscription({
                type: plan.id,
                planId: plan.id,
                planName: plan.name,
                price: plan.price,
                period: plan.period,
              });

              finish(resolve);
              alert(`${plan.name} payment successful.`);
            } catch (error) {
              finish(() => reject(error));
            }
          },

          modal: {
            ondismiss: () =>
              finish(() => reject(new Error("Payment was cancelled."))),
          },
        });

        checkout.on("payment.failed", (response) =>
          finish(() =>
            reject(
              new Error(
                response?.error?.description ||
                  "Payment failed. Please try again."
              )
            )
          )
        );

        checkout.open();
      });
    } catch (error) {
      console.error("Subscription payment error:", error);
      alert(error?.message || "Payment could not be completed.");
    } finally {
      setPaymentLoading(false);
    }
  };

  const continueWalletPayment = async () => {
    if (paymentLoading) return;

    if (walletPaymentMethod !== "online") {
      alert("Please choose Pay Online to recharge your Lathso wallet.");
      return;
    }

    try {
      setPaymentLoading(true);
      await loadRazorpayCheckout();

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("Please login again.");

      const order = await createBackendPaymentOrder(
        "wallet_topup",
        { amount: walletTopupAmount }
      );

      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn) => {
          if (settled) return;
          settled = true;
          fn();
        };

        const checkout = new window.Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency || "INR",
          name: "Lathso",
          description: `Lathso Wallet Recharge • ₹${walletTopupAmount}`,
          order_id: order.orderId,
          prefill: {
            name: firebaseUser.displayName || "",
            email: firebaseUser.email || "",
          },
          theme: { color: "#ff7a3d" },

          handler: async (paymentResponse) => {
            try {
              await verifyBackendPayment({
                razorpay_payment_id: paymentResponse.razorpay_payment_id,
                razorpay_order_id: paymentResponse.razorpay_order_id,
                razorpay_signature: paymentResponse.razorpay_signature,
              });

              await refreshWalletBalance();
              setWalletTopupOpen(false);

              finish(resolve);
              alert(
                `₹${walletTopupAmount} added to your Lathso wallet successfully.`
              );
            } catch (error) {
              finish(() => reject(error));
            }
          },

          modal: {
            ondismiss: () =>
              finish(() => reject(new Error("Payment was cancelled."))),
          },
        });

        checkout.on("payment.failed", (response) =>
          finish(() =>
            reject(
              new Error(
                response?.error?.description ||
                  "Payment failed. Please try again."
              )
            )
          )
        );

        checkout.open();
      });
    } catch (error) {
      console.error("Wallet payment error:", error);
      alert(
        error?.message ||
          "Wallet recharge could not be completed."
      );
    } finally {
      setPaymentLoading(false);
    }
  };

  const [questionImage, setQuestionImage] =
    useState(null);

  const [questionImageFile, setQuestionImageFile] =
    useState(null);

  const [questionText, setQuestionText] =
    useState("");

  const [aiAnswer, setAiAnswer] =
    useState("");

  const [aiError, setAiError] =
    useState("");

  const [aiLoading, setAiLoading] =
    useState(false);

  const [aiSolved, setAiSolved] =
    useState(false);

  const [bookingTutor, setBookingTutor] =
    useState(null);

  const [sessionFilter, setSessionFilter] = useState("Upcoming");
  const [sessionNoteOpen, setSessionNoteOpen] = useState(false);
  const [sessionNote, setSessionNote] = useState("");
  const [selectedSession, setSelectedSession] = useState(null);
  const [videoSession, setVideoSession] = useState(null);
  const [selectedChatSessionId, setSelectedChatSessionId] = useState(null);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState("");

  const activeChatSession =
    sessions.find((session) => ["Accepted", "Confirmed", "Offline Session Confirmed & Active"].includes(session.status)) ||
    null;

  const chatTutor = activeChatSession?.tutor || {
    name: "No Tutor Assigned",
    subject: "—",
    rating: "—",
    experience: "—",
  };

  // Load this student's sessions from Firestore in real time.
  // The existing Sessions UI is unchanged; only the data source is live.
  useEffect(() => {
    let cancelled = false;

    const firebaseUser = auth.currentUser;

    if (!firebaseUser) {
      setSessions([]);
      setSessionsError("Please login again to load your sessions.");
      setSessionsLoading(false);
      return undefined;
    }

    setSessionsLoading(true);
    setSessionsError("");

    const sessionsQuery = query(
      collection(db, "sessions"),
      where("studentId", "==", firebaseUser.uid)
    );

    const unsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        if (cancelled) return;

        const loadedSessions = snapshot.docs
          .map((sessionDoc) => {
            const data = sessionDoc.data();

            return {
              id: sessionDoc.id,
              studentId: data.studentId || "",
              tutorId: data.tutorId || "",
              studentName: data.studentName || "Student",
              tutor: {
                name: data.tutorName || "Tutor",
                subject: data.subject || "General",
                education: data.tutorEducation || "Verified Tutor",
                rating: data.tutorRating || "New",
                experience: data.tutorExperience || "Verified",
                distance: data.tutorDistance || data.distance || "Nearby",
                location: data.tutorLocation || data.location || "Nearby",
                mode: data.tutorMode || data.mode || "Online",
                type: data.tutorType || "Personal Tutor",
              },
              date: data.date || "",
              time: data.time || "",
              mode: data.mode || "Online",
              sessionType: data.sessionType || "",
              note: data.note || "",
              status: data.status || "Confirmed",
              createdAt: data.createdAt || null,
            };
          })
          .sort((a, b) => {
            const aTime =
              a.createdAt?.toMillis?.() ||
              (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
            const bTime =
              b.createdAt?.toMillis?.() ||
              (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);

            return bTime - aTime;
          });

        setSessions(loadedSessions);
        setSessionsLoading(false);
        setSessionsError("");
      },
      (error) => {
        console.error("Load sessions error:", error);

        if (!cancelled) {
          setSessionsError(
            error?.code === "permission-denied"
              ? "Sessions permission denied. Please publish the Firestore Rules."
              : "Could not load your sessions. Please try again."
          );
          setSessionsLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const [demoRequest, setDemoRequest] =
    useState(null);

  const [demoOpen, setDemoOpen] =
    useState(false);

  const [studentProfile, setStudentProfile] = useState({
    name: "Student",
    email: "",
    phone: "",
    classLevel: "Class 10",
    subjects: ["Mathematics"],
    location: "",
    address: "",
    parentEmail: "",
  });

  const [profileSaved, setProfileSaved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  // Load the logged-in student's profile from Firestore.
  useEffect(() => {
    let cancelled = false;

    async function loadStudentProfile() {
      try {
        const firebaseUser = auth.currentUser;

        if (!firebaseUser) {
          if (!cancelled) {
            setProfileMessage("Please login again to load your profile.");
            setProfileLoading(false);
          }
          return;
        }

        const profileSnap = await getDoc(doc(db, "users", firebaseUser.uid));

        if (cancelled) return;

        if (profileSnap.exists()) {
          const data = profileSnap.data();

          setStudentProfile({
            name: data.fullName || firebaseUser.displayName || "Student",
            email: data.email || firebaseUser.email || "",
            phone: data.phone || "",
            classLevel: data.classLevel || "Class 10",
            subjects:
              Array.isArray(data.subjects) && data.subjects.length > 0
                ? data.subjects
                : ["Mathematics"],
            location: data.location || "",
            address: data.address || "",
            parentEmail: data.parentEmail || "",
          });

          const hasSavedProfile =
            Boolean(data.phone) ||
            Boolean(data.location) ||
            Boolean(data.address) ||
            Boolean(data.classLevel) ||
            (Array.isArray(data.subjects) && data.subjects.length > 0);

          setProfileSaved(hasSavedProfile);
        } else {
          setStudentProfile((previous) => ({
            ...previous,
            name: firebaseUser.displayName || previous.name,
            email: firebaseUser.email || previous.email,
          }));
        }
      } catch (error) {
        console.error("Load student profile error:", error);
        if (!cancelled) {
          setProfileMessage(
            error?.code === "permission-denied"
              ? "Profile permission denied. Please check Firestore Rules."
              : "Could not load your profile. Please try again."
          );
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    loadStudentProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveStudentProfile() {
    setProfileMessage("");

    const firebaseUser = auth.currentUser;

    if (!firebaseUser) {
      setProfileMessage("Your login session expired. Please login again.");
      return;
    }

    const cleanName = studentProfile.name.trim();
    const cleanEmail = studentProfile.email.trim().toLowerCase();
    const cleanPhone = studentProfile.phone.trim();
    const cleanLocation = studentProfile.location.trim();
    const cleanAddress = studentProfile.address.trim();
    const cleanParentEmail = studentProfile.parentEmail.trim().toLowerCase();

    if (!cleanName) {
      setProfileMessage("Please enter your full name.");
      return;
    }

    if (!cleanEmail) {
      setProfileMessage("Please enter your email address.");
      return;
    }

    if (cleanPhone && !/^[0-9+() -]{7,20}$/.test(cleanPhone)) {
      setProfileMessage("Please enter a valid phone number.");
      return;
    }

    const subjects =
      Array.isArray(studentProfile.subjects) && studentProfile.subjects.length > 0
        ? studentProfile.subjects
        : ["Mathematics"];

    setProfileSaving(true);

    try {
      await setDoc(
        doc(db, "users", firebaseUser.uid),
        {
          fullName: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          classLevel: studentProfile.classLevel || "Class 10",
          subjects,
          location: cleanLocation,
          address: cleanAddress,
          parentEmail: cleanParentEmail,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setStudentProfile((previous) => ({
        ...previous,
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        subjects,
        location: cleanLocation,
        address: cleanAddress,
        parentEmail: cleanParentEmail,
      }));

      setProfileSaved(true);
      setProfileMessage("Profile saved successfully.");
    } catch (error) {
      console.error("Save student profile error:", error);

      if (error?.code === "permission-denied") {
        setProfileMessage(
          "Profile permission denied. Please publish the Firestore Rules from your Firebase Console."
        );
      } else {
        setProfileMessage(
          error?.message || "Could not save your profile. Please try again."
        );
      }
    } finally {
      setProfileSaving(false);
    }
  }

  const [demoForm, setDemoForm] =
    useState({
      subject: "Mathematics",
      classLevel: "Class 10",
      location: "",
      address: "",
    });

  const [onlineSubject, setOnlineSubject] =
    useState("All Subjects");

  // These states are required by the existing live Firestore tutor query.
  // They were referenced without declarations, which caused StudentDashboard
  // to crash immediately after login. No UI markup or styling is changed.
  const [verifiedTutors, setVerifiedTutors] = useState([]);
  const [tutorsLoading, setTutorsLoading] = useState(true);
  const [studentLocation, setStudentLocation] = useState(null);
  const [studentLocationError, setStudentLocationError] = useState("");
  const [learningMode, setLearningMode] = useState("");

  // INSTANT HUMAN TUTOR — payment bypassed for now.
  // The request is created directly in Firestore with status "pending".
  const [instantTutorRequest, setInstantTutorRequest] = useState(null);
  const instantSessionOpenedRef = useRef("");
  const instantRequestCreatedThisLoginRef = useRef(new Set());

  // Real-time student-side status for the instant request.
  // IMPORTANT: historical accepted requests must never auto-open VideoSession.
  // VideoSession opens only when an Instant request becomes accepted during
  // the current login, or when this login created the request and it was
  // accepted before the listener received its first snapshot.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setInstantTutorRequest(null);
      instantRequestCreatedThisLoginRef.current = new Set();
      return undefined;
    }

    let initialSnapshot = true;
    let previousStatuses = new Map();

    const instantQuery = query(
      collection(db, "instant_requests"),
      where("studentId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      instantQuery,
      (snapshot) => {
        const now = Date.now();
        const items = snapshot.docs
          .map((requestDoc) => ({ id: requestDoc.id, ...requestDoc.data() }))
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });

        // Only pending requests and accepted requests whose 6-minute window
        // is still active are shown as the current Instant Tutor request.
        const activeItems = items.filter((request) => {
          if (request.status === "pending") {
            const expiresAt = Number(request.expiresAt || 0);
            return !expiresAt || expiresAt > now;
          }
          if (request.status === "accepted") {
            const expiresAt = Number(request.expiresAt || 0);
            return expiresAt > now;
          }
          return false;
        });

        const latest = activeItems[0] || null;
        setInstantTutorRequest(latest);

        // Baseline only: old Firestore data must not trigger a video call.
        if (initialSnapshot) {
          previousStatuses = new Map(
            items.map((request) => [request.id, request.status])
          );
          initialSnapshot = false;
          return;
        }

        for (const request of items) {
          const previousStatus = previousStatuses.get(request.id);
          const createdDuringThisLogin = instantRequestCreatedThisLoginRef.current.has(
            request.id
          );

          const newlyAccepted =
            request.status === "accepted" &&
            request.sessionId &&
            request.studentId &&
            request.tutorId &&
            (previousStatus === "pending" || createdDuringThisLogin) &&
            instantSessionOpenedRef.current !== request.sessionId;

          if (!newlyAccepted) continue;

          instantSessionOpenedRef.current = request.sessionId;
          instantRequestCreatedThisLoginRef.current.delete(request.id);

          getDoc(doc(db, "sessions", request.sessionId))
            .then((sessionSnap) => {
              if (!sessionSnap.exists()) {
                console.warn(
                  "Accepted Instant Tutor request received before session was readable:",
                  request.sessionId
                );
                instantSessionOpenedRef.current = "";
                return;
              }

              const savedSession = sessionSnap.data() || {};
              const studentId = savedSession.studentId || request.studentId;
              const tutorId = savedSession.tutorId || request.tutorId;

              if (!studentId || !tutorId) {
                console.error(
                  "Instant session is missing studentId/tutorId:",
                  request.sessionId,
                  savedSession
                );
                instantSessionOpenedRef.current = "";
                return;
              }

              setVideoSession({
                id: request.sessionId,
                studentId,
                tutorId,
                studentName: savedSession.studentName || request.studentName || "Student",
                tutorName: savedSession.tutorName || request.tutorName || "Tutor",
                tutor: {
                  id: tutorId,
                  name: savedSession.tutorName || request.tutorName || "Tutor",
                  subject: savedSession.subject || request.subject || "General",
                  education: savedSession.tutorEducation || request.tutorEducation || "Verified Tutor",
                  rating: savedSession.tutorRating || request.tutorRating || "New",
                  experience: savedSession.tutorExperience || request.tutorExperience || "Verified",
                  mode: "Online",
                },
                subject: savedSession.subject || request.subject || "General",
                mode: savedSession.mode || "Online",
                sessionType: savedSession.sessionType || "Instant Human Tutor",
                status: savedSession.status || "Accepted",
                instantRequestId: request.id,
                expiresAt: savedSession.expiresAt || request.expiresAt || Date.now() + 360000,
              });

              setNotifications((previous) => [
                {
                  id: Date.now(),
                  title: "Tutor accepted your request",
                  text: `${request.tutorName || "Your tutor"} accepted. Connecting you now.`,
                  time: "Just now",
                  read: false,
                },
                ...previous,
              ]);
            })
            .catch((error) => {
              console.error("Could not load accepted Instant Tutor session:", error);
              instantSessionOpenedRef.current = "";
            });
        }

        previousStatuses = new Map(
          items.map((request) => [request.id, request.status])
        );
      },
      (error) => {
        console.error("Instant tutor request listener error:", error);
      }
    );

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  // INSTANT HUMAN TUTOR — expire a pending request after 6 minutes.
  // This only affects instant_requests and does not touch normal sessions.
  useEffect(() => {
    if (instantTutorRequest?.status !== "pending" || !instantTutorRequest?.id) {
      return undefined;
    }

    const expiresAt = Number(instantTutorRequest.expiresAt || 0);
    if (!expiresAt) return undefined;

    const expireRequest = async () => {
      if (Date.now() < expiresAt) return;
      try {
        await updateDoc(doc(db, "instant_requests", instantTutorRequest.id), {
          status: "expired",
          expiredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.error("Could not expire Instant Tutor request:", error);
      }
    };

    const delay = Math.max(0, expiresAt - Date.now());
    const timer = window.setTimeout(expireRequest, delay + 100);
    return () => window.clearTimeout(timer);
  }, [instantTutorRequest?.id, instantTutorRequest?.status, instantTutorRequest?.expiresAt]);

  async function requestInstantTutor(tutor) {
    const firebaseUser = auth.currentUser;

    if (!firebaseUser) {
      alert("Please login again.");
      return;
    }

    if (!tutor?.id) {
      alert("Please select a valid online tutor.");
      return;
    }

    if (!tutor.verified || !tutor.available) {
      alert("This tutor is not currently available.");
      return;
    }

    // Payment is intentionally bypassed at this stage.
    try {
      // Query only by studentId so this feature does not require a
      // composite Firestore index. Status/expiry are checked locally.
      const existingSnap = await getDocs(
        query(
          collection(db, "instant_requests"),
          where("studentId", "==", firebaseUser.uid)
        )
      );

      const now = Date.now();
      const activeRequests = existingSnap.docs.filter((requestDoc) => {
        const data = requestDoc.data() || {};
        if (data.status === "accepted") {
          const expiresAt = Number(data.expiresAt || 0);
          // Accepted Instant sessions are active only inside the current
          // 6-minute session window. Legacy accepted records without an
          // expiry are treated as historical so they cannot block a new request.
          return expiresAt > now;
        }
        const expiresAt = Number(data.expiresAt || 0);
        return data.status === "pending" && (!expiresAt || expiresAt > now);
      });

      if (activeRequests.length > 0) {
        alert("You already have an active Instant Human Tutor request.");
        return;
      }

      // Expire stale pending requests in the background. This never touches
      // normal sessions.
      const staleRequests = existingSnap.docs.filter((requestDoc) => {
        const data = requestDoc.data() || {};
        const expiresAt = Number(data.expiresAt || 0);
        return data.status === "pending" && expiresAt > 0 && expiresAt <= now;
      });

      await Promise.all(
        staleRequests.map((requestDoc) =>
          updateDoc(doc(db, "instant_requests", requestDoc.id), {
            status: "expired",
            expiredAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
      );

      const requestData = {
        studentId: firebaseUser.uid,
        studentEmail: firebaseUser.email || "",
        studentName: studentProfile.name || firebaseUser.displayName || "Student",
        tutorId: tutor.id,
        tutorEmail: tutor.email || "",
        tutorName: tutor.name || "Verified Tutor",
        tutorEducation: tutor.education || "Qualified Tutor",
        tutorRating: tutor.rating || "New",
        tutorExperience: tutor.experience || "Verified",
        subject: tutor.subject || onlineSubject || "General",
        classLevel: studentProfile.classLevel || "",
        questionText: questionText.trim(),
        hasQuestionImage: Boolean(questionImageFile),
        mode: "Online",
        sessionType: "Instant Human Tutor",
        status: "pending",
        createdAt: serverTimestamp(),
        // Instant requests are valid for 6 minutes while waiting for a tutor.
        expiresAt: Date.now() + 360000,
      };

      const requestRef = await addDoc(
        collection(db, "instant_requests"),
        requestData
      );

      // If the tutor accepts before the realtime listener receives the new
      // request, this ID is still allowed to trigger the current-login video.
      instantRequestCreatedThisLoginRef.current.add(requestRef.id);

      setInstantTutorRequest({
        id: requestRef.id,
        ...requestData,
        createdAt: null,
      });

      setNotifications((previous) => [
        {
          id: Date.now(),
          title: "Instant tutor request sent",
          text: `Your request was sent to ${tutor.name || "the selected tutor"}.`,
          time: "Just now",
          read: false,
        },
        ...previous,
      ]);

      setActivePage("instant-tutor");
    } catch (error) {
      console.error("Instant tutor request error:", error);
      alert(
        error?.code === "permission-denied"
          ? "Instant tutor request permission denied. Please publish the updated Firestore Rules."
          : "Could not send the instant tutor request. Please try again."
      );
    }
  }

  // Verified + available tutors are loaded live from Firestore.
  useEffect(() => {
    let cancelled = false;

    const tutorsQuery = query(
      collection(db, "users"),
      where("role", "==", "tutor"),
      where("verified", "==", true),
      where("available", "==", true)
    );

    setTutorsLoading(true);

    const unsubscribe = onSnapshot(
      tutorsQuery,
      (snapshot) => {
        if (cancelled) return;

        const tutors = snapshot.docs
          .map((tutorDoc) => {
            const data = tutorDoc.data();
            return {
              id: tutorDoc.id,
              name: data.fullName || "Verified Tutor",
              subject: data.subject || "General",
              education: data.education || "Qualified Tutor",
              experience: data.experience || "Verified",
              rating: data.rating || "New",
              distance: data.distance || "Nearby",
              location: data.location || "Nearby",
              mode: data.mode || "Online",
              email: data.email || "",
              latitude: Number(data.latitude),
              longitude: Number(data.longitude),
              locationActive: data.locationActive === true,
              available: data.available === true,
              verified: data.verified === true,
            };
          })
          .filter((tutor) => tutor.verified && tutor.available);

        setVerifiedTutors(tutors);
        setTutorsLoading(false);
      },
      (error) => {
        console.error("Load verified tutors error:", error);
        if (!cancelled) {
          setVerifiedTutors([]);
          setTutorsLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Get the student's real GPS location after login.
  useEffect(() => {
    let cancelled = false;
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return undefined;
    getBrowserLocation()
      .then(async (coords) => {
        if (cancelled) return;
        setStudentLocation(coords);
        setStudentLocationError("");
        try {
          await setDoc(doc(db, "users", firebaseUser.uid), {
            latitude: coords.latitude, longitude: coords.longitude, locationActive: true, locationUpdatedAt: serverTimestamp(),
          }, { merge: true });
        } catch (error) { console.error("Save student GPS error:", error); }
      })
      .catch((error) => {
        if (!cancelled) { setStudentLocation(null); setStudentLocationError(error?.message || "Could not access your location."); }
      });
    return () => { cancelled = true; };
  }, []);

  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (questionImage) URL.revokeObjectURL(questionImage);
    };
  }, [questionImage]);

  /* -----------------------------------------------
     IMAGE PICKER / QUESTION PHOTO
  ------------------------------------------------ */

  function handleImage(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("Please choose an image smaller than 10 MB.");
      return;
    }

    const imageURL = URL.createObjectURL(file);

    setQuestionImage((previousURL) => {
      if (previousURL) URL.revokeObjectURL(previousURL);
      return imageURL;
    });
    setQuestionImageFile(file);
    setAiSolved(false);
    setAiAnswer("");
    setAiError("");
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    handleImage(file);
  }

  function removeImage() {
    setQuestionImage((previousURL) => {
      if (previousURL) URL.revokeObjectURL(previousURL);
      return null;
    });

    setQuestionImageFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    setAiSolved(false);
    setAiAnswer("");
    setAiError("");
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* -----------------------------------------------
     REAL GEMINI AI TUTOR
     Uses @google/generative-ai with VITE_GEMINI_API_KEY.
  ------------------------------------------------ */

  async function solveProblem() {
    const cleanQuestion = questionText.trim();

    if (!questionImageFile && !cleanQuestion) {
      alert("Please upload a question photo or type a question first.");
      return;
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

    if (!apiKey) {
      setAiError(
        "Gemini API key is missing. Add VITE_GEMINI_API_KEY to your .env file and restart the app."
      );
      return;
    }

    setAiLoading(true);
    setAiSolved(false);
    setAiAnswer("");
    setAiError("");

    try {
      const genAI = new GoogleGenerativeAI(apiKey);

      const prompt = `You are Lathso AI Tutor, an expert academic tutor for school and college students.

Solve the student's question accurately and teach the student, not just give the final answer.

Requirements:
1. Identify what the question is asking.
2. Explain the required concept briefly in simple language.
3. Solve it step by step.
4. Show formulas, substitutions and calculations when relevant.
5. Give a clearly marked final answer.
6. If the question is ambiguous or the image is unclear, say exactly what is unclear instead of inventing information.
7. Keep the explanation student-friendly and exam-useful.
8. If an image is provided, carefully read the question from the image before solving it.
9. Write like a professional human teacher: clear, calm, structured, and easy for a student to study.
10. Do NOT use Markdown headings (#), bold markers (**), dollar-sign LaTeX, or LaTeX commands such as \\lambda, \\begin{pmatrix}, \\frac, \\mathbf, etc.
11. Use normal readable notation instead: λ, ×, ≤, ≥, ≠, ⇒ and plain-text matrices such as [ 4  -2 ; 3  -1 ].
12. Organize the response as: What the question asks → Concept → Step-by-step solution → Final answer.
13. Do not add unnecessary separators such as "---".

Student's typed question:
${cleanQuestion || "No typed question. Read the uploaded image."}`;

      const parts = [prompt];

      if (questionImageFile) {
        const base64Data = await fileToBase64(questionImageFile);
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: questionImageFile.type,
          },
        });
      }

      /*
       * Gemini 3.7 Flash can temporarily return HTTP 503 when its
       * serving capacity is busy. Do not show that temporary server
       * failure to the student immediately.
       *
       * Try the primary model twice, then automatically fall back to
       * stable Flash models. This does not change the UI or any
       * student/tutor/session functionality.
       */
      const models = [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
      ];

      let answer = "";
      let lastError = null;

      for (const modelName of models) {
        const model = genAI.getGenerativeModel({
          model: modelName,
        });

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const result = await model.generateContent(parts);
            const response = await result.response;
            const candidateAnswer = response.text()?.trim();

            if (!candidateAnswer) {
              throw new Error("Gemini returned an empty answer.");
            }

            answer = candidateAnswer;
            break;
          } catch (error) {
            lastError = error;

            const status = error?.status || error?.code;
            const errorText = String(error?.message || "").toLowerCase();
            const isTemporary =
              status === 503 ||
              status === 429 ||
              errorText.includes("high demand") ||
              errorText.includes("temporarily") ||
              errorText.includes("unavailable");

            if (!isTemporary) {
              throw error;
            }

            if (attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
          }
        }

        if (answer) break;
      }

      if (!answer) {
        throw lastError || new Error("Gemini is temporarily unavailable.");
      }

      setAiAnswer(answer);
      setAiSolved(true);
    } catch (error) {
      console.error("Gemini AI error:", error);

      const code = error?.status || error?.code;
      let message = "Could not solve the question right now. Please try again.";

      if (code === 400 || code === 401 || code === 403) {
        message = "Gemini API key is invalid or does not have access to the selected Gemini model.";
      } else if (code === 429) {
        message = "Gemini request limit reached. Please wait a moment and try again.";
      } else if (
        code === 503 ||
        error?.message?.toLowerCase?.().includes("high demand") ||
        error?.message?.toLowerCase?.().includes("unavailable")
      ) {
        message = "Gemini is temporarily busy. Please try again in a moment.";
      } else if (error?.message?.toLowerCase?.().includes("network")) {
        message = "Network error. Please check your internet connection and try again.";
      } else if (error?.message) {
        message = error.message;
      }

      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  }

  async function submitHomeDemo(event) {
    event.preventDefault();
    if (!demoForm.location.trim() || !demoForm.address.trim()) { alert("Please enter your location and home address."); return; }
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) { alert("Please login again."); return; }

    let currentLocation = studentLocation;
    if (!currentLocation) {
      try {
        currentLocation = await getBrowserLocation({ maximumAge: 0 });
        setStudentLocation(currentLocation); setStudentLocationError("");
        await setDoc(doc(db, "users", firebaseUser.uid), { latitude: currentLocation.latitude, longitude: currentLocation.longitude, locationActive: true, locationUpdatedAt: serverTimestamp() }, { merge: true });
      } catch (error) {
        setStudentLocationError(error?.message || "Location permission is required for offline tutor matching.");
        alert("Please allow location access. Lathso uses your GPS to find an offline tutor within 10 km."); return;
      }
    }

    const tutor = verifiedTutors
      .map((item) => ({ ...item, distanceKm: calculateDistanceKm(currentLocation.latitude, currentLocation.longitude, item.latitude, item.longitude) }))
      .filter((item) => item.verified === true && item.available === true && item.locationActive === true && Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && Number.isFinite(item.distanceKm) && item.distanceKm <= 10 && (item.subject === demoForm.subject || !item.subject))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];

    if (!tutor) { alert("No verified offline tutor with an active location was found within 10 km for this subject."); return; }

    try {
      const distanceText = `${tutor.distanceKm.toFixed(1)} km`;
      const sessionData = {
        studentId: firebaseUser.uid, studentEmail: firebaseUser.email || "", studentName: studentProfile.name || "Student", classLevel: studentProfile.classLevel || demoForm.classLevel || "",
        tutorId: tutor.id, tutorEmail: tutor.email || "", tutorName: tutor.name || "Home Tutor", subject: tutor.subject || demoForm.subject || "General",
        tutorEducation: tutor.education || "Verified Tutor", tutorRating: tutor.rating || "New", tutorExperience: tutor.experience || "Verified",
        tutorDistance: distanceText, tutorLocation: tutor.location || demoForm.location.trim(), tutorLatitude: tutor.latitude, tutorLongitude: tutor.longitude, tutorMode: "Offline", tutorType: "Personal Tutor",
        studentLatitude: currentLocation.latitude, studentLongitude: currentLocation.longitude, studentLocation: demoForm.location.trim(), homeAddress: demoForm.address.trim(), distanceKm: tutor.distanceKm,
        date: "Free Demo", time: "To be scheduled", mode: "Home Demo", sessionType: "Offline Home Demo", note: `${demoForm.subject} • ${demoForm.classLevel}`,
        status: "Demo Requested", createdAt: serverTimestamp(),
      };
      const sessionRef = await addDoc(collection(db, "sessions"), sessionData);
      const demoSession = {
        id: sessionRef.id, studentId: firebaseUser.uid, tutorId: tutor.id, studentName: studentProfile.name || "Student", sessionType: "Offline Home Demo",
        tutor: { id: tutor.id, email: tutor.email || "", name: tutor.name || "Home Tutor", subject: tutor.subject || demoForm.subject || "General", education: tutor.education || "Verified Tutor", rating: tutor.rating || "New", experience: tutor.experience || "Verified", distance: distanceText, location: tutor.location || demoForm.location.trim(), mode: "Offline", type: "Personal Tutor" },
        date: "Free Demo", time: "To be scheduled", mode: "Home Demo", note: `${demoForm.subject} • ${demoForm.classLevel}`, status: "Demo Requested",
      };
      setSessions((previous) => [demoSession, ...previous.filter((item) => item.id !== sessionRef.id)]);
      setDemoRequest(demoSession); setDemoOpen(false); setActivePage("sessions");
      setNotifications((previous) => [{ id: Date.now(), title: "Free home demo requested", text: `${tutor.name || "A verified tutor"} received your demo request (${distanceText} away).`, time: "Just now", read: false }, ...previous]);
    } catch (error) {
      console.error("Home tutor booking error:", error);
      alert(error?.code === "permission-denied" ? "Booking permission denied. Please publish the Firestore Rules." : "Could not create the home demo booking. Please try again.");
    }
  }

  async function findAnotherHomeTutor() {
    const currentSession = activeOfflineDemoSession;
    if (!currentSession || currentSession.status !== "Demo Requested") return;
    if (!auth.currentUser) { alert("Please login again."); return; }
    if (!studentLocation) { alert("Student location is required to find another tutor within 10 km."); return; }
    const nextTutor = verifiedTutors
      .map((item) => ({ ...item, distanceKm: calculateDistanceKm(studentLocation.latitude, studentLocation.longitude, item.latitude, item.longitude) }))
      .filter((item) => item.id !== currentSession.tutorId && item.verified === true && item.available === true && item.locationActive === true && Number.isFinite(item.latitude) && Number.isFinite(item.longitude) && Number.isFinite(item.distanceKm) && item.distanceKm <= 10 && (item.subject === currentSession.tutor?.subject || !item.subject))
      .sort((a, b) => a.distanceKm - b.distanceKm)[0];
    if (!nextTutor) { alert("No other verified offline tutor is currently available within 10 km."); return; }
    try {
      const distanceText = `${nextTutor.distanceKm.toFixed(1)} km`;
      await updateDoc(doc(db, "sessions", currentSession.id), { tutorId: nextTutor.id, tutorEmail: nextTutor.email || "", tutorName: nextTutor.name || "Home Tutor", tutorEducation: nextTutor.education || "Verified Tutor", tutorRating: nextTutor.rating || "New", tutorExperience: nextTutor.experience || "Verified", tutorDistance: distanceText, tutorLocation: nextTutor.location || demoForm.location.trim(), tutorLatitude: nextTutor.latitude, tutorLongitude: nextTutor.longitude, distanceKm: nextTutor.distanceKm, updatedAt: serverTimestamp() });
    } catch (error) { console.error("Find another tutor error:", error); alert("Could not change the tutor. Please try again."); }
  }

  async function updateSessionStatus(sessionId, status) {
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) return;

    try {
      const firebaseUser = auth.currentUser;

      if (!firebaseUser) {
        alert("Please login again.");
        return;
      }

      await updateDoc(doc(db, "sessions", sessionId), {
        status,
        updatedAt: serverTimestamp(),
      });

      setSessions((previous) =>
        previous.map((item) =>
          item.id === sessionId
            ? { ...item, status }
            : item
        )
      );

      const title =
        status === "Cancelled"
          ? "Session cancelled"
          : status === "Completed"
          ? "Session completed"
          : "Session updated";

      setNotifications((previous) => [
        {
          id: Date.now(),
          title,
          text: `Your ${status.toLowerCase()} session has been updated.`,
          time: "Just now",
          read: false,
        },
        ...previous,
      ]);
    } catch (error) {
      console.error("Update session status error:", error);

      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to update this session."
          : "Could not update the session. Please try again."
      );
    }
  }

  async function rescheduleSession(sessionId) {
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) return;

    const newDate = window.prompt(
      "Enter new date (example: 2026-09-05):",
      session.date
    );

    if (!newDate) return;

    const newTime = window.prompt(
      "Enter new time (example: 06:00 PM):",
      session.time
    );

    if (!newTime) return;

    try {
      const firebaseUser = auth.currentUser;

      if (!firebaseUser) {
        alert("Please login again.");
        return;
      }

      await updateDoc(doc(db, "sessions", sessionId), {
        date: newDate.trim(),
        time: newTime.trim(),
        status: "Rescheduled",
        updatedAt: serverTimestamp(),
      });

      setSessions((previous) =>
        previous.map((item) =>
          item.id === sessionId
            ? {
                ...item,
                date: newDate.trim(),
                time: newTime.trim(),
                status: "Rescheduled",
              }
            : item
        )
      );

      setNotifications((previous) => [
        {
          id: Date.now(),
          title: "Session rescheduled",
          text: `${session.tutor.name} session moved to ${newDate} at ${newTime}.`,
          time: "Just now",
          read: false,
        },
        ...previous,
      ]);
    } catch (error) {
      console.error("Reschedule session error:", error);

      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to reschedule this session."
          : "Could not reschedule the session. Please try again."
      );
    }
  }

  function openSessionNotes(session) {
    setSelectedSession(session);
    setSessionNote(session.note || "");
    setSessionNoteOpen(true);
  }

  async function saveSessionNote(event) {
    event.preventDefault();

    if (!selectedSession) return;

    const cleanNote = sessionNote.trim();

    try {
      const firebaseUser = auth.currentUser;

      if (!firebaseUser) {
        alert("Please login again.");
        return;
      }

      await updateDoc(
        doc(db, "sessions", selectedSession.id),
        {
          note: cleanNote,
          updatedAt: serverTimestamp(),
        }
      );

      setSessions((previous) =>
        previous.map((item) =>
          item.id === selectedSession.id
            ? { ...item, note: cleanNote }
            : item
        )
      );

      setSessionNoteOpen(false);
      setSelectedSession(null);
      setSessionNote("");

      setNotifications((previous) => [
        {
          id: Date.now(),
          title: "Session notes saved",
          text: "Your session notes were saved successfully.",
          time: "Just now",
          read: false,
        },
        ...previous,
      ]);
    } catch (error) {
      console.error("Save session note error:", error);

      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to update this session."
          : "Could not save the session notes. Please try again."
      );
    }
  }

  async function confirmBooking(booking) {
    if (!bookingTutor || !booking) return;

    const firebaseUser = auth.currentUser;

    if (!firebaseUser) {
      alert("Please login again.");
      return;
    }

    try {
      const tutor = bookingTutor;

      const sessionData = {
        studentId: firebaseUser.uid,
        studentEmail: firebaseUser.email || "",
        studentName: studentProfile.name || "Student",
        classLevel: studentProfile.classLevel || "",

        tutorId: tutor.id || "",
        tutorEmail: tutor.email || "",
        tutorName: tutor.name || "Tutor",
        subject: tutor.subject || "General",
        tutorEducation: tutor.education || tutor.qualification || "Verified Tutor",
        tutorRating: tutor.rating || "New",
        tutorExperience: tutor.experience || "Verified",
        tutorDistance: tutor.distance || "",
        tutorLocation: tutor.location || "",
        tutorMode: tutor.mode || booking.mode || "Online",
        tutorType: "Personal Tutor",

        date: booking.date || "",
        time: booking.time || "",
        mode: booking.mode || "Online",
        sessionType: "Online Session",
        note: booking.note || "",
        status: "Pending",

        createdAt: serverTimestamp(),
      };

      const sessionRef = await addDoc(
        collection(db, "sessions"),
        sessionData
      );

      const newSession = {
        id: sessionRef.id,
        tutor: {
          ...tutor,
          type: "Personal Tutor",
        },
        date: booking.date || "",
        time: booking.time || "",
        mode: booking.mode || "Online",
        sessionType: "Online Session",
        note: booking.note || "",
        status: "Pending",
      };

      setSessions((previous) => [
        newSession,
        ...previous,
      ]);

      setBookingTutor(null);

      setNotifications((items) => [
        {
          id: Date.now(),
          title: "Online session booked",
          text: `${tutor.name || "Tutor"} is booked for ${tutor.subject || "your subject"}.`,
          time: "Just now",
          read: false,
        },
        ...items,
      ]);

      setActivePage("sessions");
    } catch (error) {
      console.error("Online tutor booking error:", error);

      alert(
        error?.code === "permission-denied"
          ? "Booking permission denied. Please publish the Firestore Rules."
          : "Could not save the booking. Please try again."
      );
    }
  }

  function openAssignment(assignment) {
    setActiveAssignment(assignment);
    setAssignmentAnswer("");
    setAssignmentOpen(true);
  }

  function submitAssignment(event) {
    event.preventDefault();

    if (!activeAssignment || !assignmentAnswer.trim()) {
      alert("Please enter your answer before submitting.");
      return;
    }

    const marks =
      activeAssignment.questions > 0
        ? Math.min(
            activeAssignment.questions,
            Math.max(0, Math.round(activeAssignment.questions * 0.8))
          )
        : 0;

    setAssignments((previous) =>
      previous.map((item) =>
        item.id === activeAssignment.id
          ? {
              ...item,
              status: "Submitted",
              marks,
            }
          : item
      )
    );

    setNotifications((previous) => [
      {
        id: Date.now(),
        title: "Assignment submitted",
        text: `${activeAssignment.title} was submitted successfully.`,
        time: "Just now",
        read: false,
      },
      ...previous,
    ]);

    setAssignmentOpen(false);
    setActiveAssignment(null);
    setAssignmentAnswer("");
    alert("Assignment submitted successfully!");
  }

  function submitReview(event) {
    event.preventDefault();

    const comment = reviewText.trim();

    if (!comment) {
      alert("Please write a short review.");
      return;
    }

    setReviews((previous) => [
      {
        id: Date.now(),
        tutor: chatTutor.name || "No Tutor Assigned",
        subject: chatTutor.subject || "General",
        rating: reviewRating,
        comment,
        date: "Just now",
      },
      ...previous,
    ]);

    setReviewText("");
    setReviewRating(5);
    setReviewOpen(false);

    setNotifications((previous) => [
      {
        id: Date.now() + 5,
        title: "Review submitted",
        text: "Your tutor rating and review were submitted successfully.",
        time: "Just now",
        read: false,
      },
      ...previous,
    ]);
  }

  function markAllNotificationsRead() {
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
  }

  function clearNotifications() {
    setNotifications([]);
    setNotificationsOpen(false);
  }

  function sendChatMessage(event) {
    event.preventDefault();
  }

  const offlineTutors = verifiedTutors
    .map((tutor) => ({ ...tutor, distanceKm: studentLocation ? calculateDistanceKm(studentLocation.latitude, studentLocation.longitude, tutor.latitude, tutor.longitude) : Infinity }))
    .filter((tutor) => tutor.verified === true && tutor.available === true && tutor.locationActive === true && Number.isFinite(tutor.latitude) && Number.isFinite(tutor.longitude) && Number.isFinite(tutor.distanceKm) && tutor.distanceKm <= 10)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const onlineTutors = verifiedTutors.filter((tutor) => {
    const mode = String(tutor.mode || "").trim().toLowerCase();
    return tutor.verified === true && tutor.available === true && (
      mode === "online" || mode === "online tutor" || mode.includes("online")
    );
  });
  const displayedTutors = learningMode === "Home Tutor" ? offlineTutors : learningMode === "Online Tutor" ? onlineTutors : verifiedTutors;
  const activeOfflineDemoSession = sessions.find((session) => session.sessionType === "Offline Home Demo" && !["Cancelled", "Completed"].includes(session.status)) || null;

  async function confirmOfflineTutor(session) {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || session?.studentId !== firebaseUser.uid) { alert("Please login again."); return; }
    if (session.status !== "Demo Completed") return;
    try {
      await updateDoc(doc(db, "sessions", session.id), { status: "Offline Session Confirmed & Active", confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setNotifications((previous) => [{ id: Date.now(), title: "Tutor confirmed", text: `${session.tutor?.name || "Your tutor"} is now confirmed for offline tuition.`, time: "Just now", read: false }, ...previous]);
    } catch (error) { console.error("Confirm offline tutor error:", error); alert(error?.code === "permission-denied" ? "You do not have permission to confirm this tutor." : "Could not confirm the tutor. Please try again."); }
  }

  // Instant Tutor only: closing the existing video window ends the current
  // instant session and releases the student's/tutor's request for the next
  // Instant Doubt booking. Normal sessions use their existing close flow.
  async function finishInstantTutorSession(nextStatus = "Completed") {
    const current = videoSession;
    setVideoSession(null);

    if (!current?.id || current?.sessionType !== "Instant Human Tutor") return;

    const user = auth.currentUser;
    if (!user) return;

    const requestId = current.instantRequestId || current.id.replace(/^instant-/, "");

    try {
      await runTransaction(db, async (transaction) => {
        const sessionRef = doc(db, "sessions", current.id);
        const requestRef = requestId ? doc(db, "instant_requests", requestId) : null;
        const requestSnap = requestRef ? await transaction.get(requestRef) : null;

        transaction.update(sessionRef, {
          status: nextStatus,
          endedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (requestRef && requestSnap?.exists()) {
          transaction.update(requestRef, {
            status: nextStatus.toLowerCase(),
            endedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });

      setInstantTutorRequest(null);
      instantSessionOpenedRef.current = "";
    } catch (error) {
      console.error("Finish Instant Tutor session error:", error);
      // The video UI is already closed. The next realtime snapshot will
      // reconcile the request if Firestore temporarily rejects the write.
    }
  }

  return (
    <>
      <style>{INSTANT_STUDENT_BOOKING_CSS}</style>
      <ChatPresenceTracker sessions={sessions} role="student" />
      {videoSession && <VideoSession session={videoSession} role="student" onClose={() => {
        if (videoSession?.sessionType === "Instant Human Tutor") {
          finishInstantTutorSession("Completed");
        } else if (videoSession?.id) {
          endNormalSession(videoSession.id);
        } else {
          setVideoSession(null);
        }
      }} />}
      <style>{TUTOR_CHAT_CSS}</style>
      <style>{LOGIN_CSS}</style>
      <SubscriptionStyles />
      <style>{PROFILE_CSS}</style>
      <div className="dashboard-layout">

      {/* =================================================
          SIDEBAR
      ================================================= */}

      <aside className="sidebar">

        <Logo />

        <div className="student-account">

          <span>🎓</span>

          <div>
            <strong>
              Student Account
            </strong>

            <small>
              Lathso V1.0
            </small>
          </div>

        </div>

        <nav className="sidebar-nav">

          <button
            className={
              activePage === "home"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage("home")
            }
          >
            <span>⌂</span>
            Home
          </button>

          <button
            className={
              activePage === "ai"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage("ai")
            }
          >
            <span>🤖</span>
            AI Problem Solver
          </button>

          <button
            className={
              activePage === "tutors"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage("tutors")
            }
          >
            <span>👨‍🏫</span>
            Find Tutor
          </button>

          <button
            className={
              activePage === "subscription"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage("subscription")
            }
          >
            <span>💎</span>
            Subscription
          </button>

          <button
            className={
              activePage === "sessions"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage("sessions")
            }
          >
            <span>📅</span>
            My Sessions
          </button>

          <button
            className={
              activePage === "profile"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage("profile")
            }
          >
            <span>👤</span>
            Profile
          </button>

          <button
            className={
              activePage === "chat"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setActivePage("chat")}
          >
            <span>💬</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              Tutor Chat
              {chatUnreadCount > 0 && (
                <b style={{
                  minWidth: 17,
                  height: 17,
                  padding: "0 5px",
                  borderRadius: 999,
                  display: "inline-grid",
                  placeItems: "center",
                  background: "#ef4444",
                  color: "#fff",
                  fontSize: 8,
                  lineHeight: 1
                }}>
                  {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                </b>
              )}
            </span>
          </button>

          <button
            className={
              activePage === "reviews"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setActivePage("reviews")}
          >
            <span>⭐</span>
            Ratings & Reviews
          </button>

          <button
            className={
              activePage === "assignments"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setActivePage("assignments")}
          >
            <span>📝</span>
            My Assignments
          </button>

          <button
            className={
              activePage === "personalTutor"
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() => setActivePage("personalTutor")}
          >
            <span>👨‍🏫</span>
            Personal Tutor
          </button>

        </nav>

        <div className="sidebar-bottom">

          <div className="help-box">

            <strong>
              Need more clarity?
            </strong>

            <p>
              Connect with a verified human tutor.
            </p>

          </div>

          <button
            className="logout-button"
            onClick={onLogout}
          >
            ↪ Logout
          </button>

        </div>

      </aside>

      {/* =================================================
          MAIN AREA
      ================================================= */}

      <main className="dashboard-main">

        {/* =================================================
            HOME
        ================================================= */}

        {activePage === "home" && (

          <>

            <div className="dashboard-header">

              <div>
                <h1>
                  Good afternoon, Student 👋
                </h1>

                <p>
                  What would you like to learn today?
                </p>
              </div>

              <div className="notification-wrap">
              <button
                className="notification-button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label="Notifications"
              >
                🔔
                {notifications.some((item) => !item.read) && (
                  <span className="notification-dot" />
                )}
              </button>

              {notificationsOpen && (
                <div className="notification-panel">
                  <div className="notification-panel-header">
                    <div>
                      <strong>Notifications</strong>
                      <span>{notifications.filter((item) => !item.read).length} unread</span>
                    </div>
                    <button className="notification-read" onClick={markAllNotificationsRead}>
                      Mark all read
                    </button>
                  </div>

                  <div className="notification-list">
                    {notifications.length === 0 ? (
                      <div className="notification-empty">
                        <div>🔔</div>
                        <p>No notifications</p>
                      </div>
                    ) : (
                      notifications.map((item) => (
                        <div
                          key={item.id}
                          className={item.read ? "notification-item" : "notification-item unread"}
                        >
                          <div className="notification-icon">🔔</div>
                          <div className="notification-content">
                            <strong>{item.title}</strong>
                            <p>{item.text}</p>
                            <small>{item.time}</small>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {notifications.length > 0 && (
                    <button className="notification-clear" onClick={clearNotifications}>
                      Clear all notifications
                    </button>
                  )}
                </div>
              )}
            </div>

            </div>

            {/* STATS */}

            <div className="stats-grid">

              <div className="stat-card">
                <strong>0</strong>
                <span>Problems Solved</span>
              </div>

              <div className="stat-card">
                <strong>0</strong>
                <span>Tutor Sessions</span>
              </div>

              <div className="stat-card">
                <strong>0%</strong>
                <span>Learning Progress</span>
              </div>

              <div className="stat-card">
                <strong>0</strong>
                <span>Study Streak</span>
              </div>

            </div>

            {/* FEATURES */}

            <div className="feature-grid">

              <div className="feature-card ai-feature">

                <div className="feature-icon">
                  🤖
                </div>

                <h3>
                  AI Problem Solver
                </h3>

                <p>
                  Upload a question photo or
                  ask Lathso AI directly.
                </p>

                <button
                  className="primary-button"
                  onClick={() =>
                    setActivePage("ai")
                  }
                >
                  Ask Lathso AI →
                </button>

              </div>

              <div className="feature-card">

                <div className="feature-icon">
                  🏠
                </div>

                <h3>
                  Find Local Tutor
                </h3>

                <p>
                  Discover verified tutors
                  near your location.
                </p>

                <button
                  className="secondary-button"
                  onClick={() =>
                    setActivePage("tutors")
                  }
                >
                  Find Tutor →
                </button>

              </div>

              <div className="feature-card">

                <div className="feature-icon">
                  🎥
                </div>

                <h3>
                  Online Session
                </h3>

                <p>
                  Book a 1-to-1 online
                  learning session.
                </p>

                <button
                  className="secondary-button"
                  onClick={() =>
                    setActivePage("tutors")
                  }
                >
                  Book Session →
                </button>

              </div>

            </div>

            {/* HUMAN ESCALATION */}

            <div className="human-banner">

              <div className="human-banner-icon">
                👨‍🏫
              </div>

              <div>

                <strong>
                  Still confused after AI?
                </strong>

                <p>
                  Get clarity from a real human tutor.
                </p>

              </div>

              <button
                className="primary-button small"
                onClick={() => setActivePage("instant-tutor")}>
                Get Human Tutor →
              </button>

            </div>

          </>
        )}

        {/* =================================================
            AI PAGE
        ================================================= */}

        {activePage === "ai" && (

          <section className="ai-page">

            <div className="page-heading">

              <div className="page-heading-icon">
                🤖
              </div>

              <div>

                <h1>
                  Lathso AI
                </h1>

                <p>
                  Upload a question photo or type
                  your question to get step-by-step help.
                </p>

              </div>

            </div>

            {/* AI INPUT */}

            <div className="ai-card">

              <div className="ai-card-top">

                <div>

                  <strong>
                    Ask your question
                  </strong>

                  <p>
                    Maths • Physics • Chemistry •
                    Biology • General Academics
                  </p>

                </div>

                <span className="ai-badge">
                  ✦ AI
                </span>

              </div>

              {/* UPLOAD */}

              {!questionImage ? (

                <label
                  className="upload-area"
                  onDragOver={(event) =>
                    event.preventDefault()
                  }
                  onDrop={(event) => {

                    event.preventDefault();

                    const file =
                      event.dataTransfer.files?.[0];

                    handleImage(file);

                  }}
                >

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    hidden
                  />

                  <div className="upload-big-icon">
                    📷
                  </div>

                  <strong>
                    Upload your question
                  </strong>

                  <p>
                    Click to choose an image
                    or drag & drop here
                  </p>

                  <small>
                    JPG • PNG • WEBP
                  </small>

                </label>

              ) : (

                <div className="image-preview">

                  <img
                    src={questionImage}
                    alt="Uploaded question"
                  />

                  <button
                    className="remove-image"
                    onClick={removeImage}
                    title="Remove image"
                  >
                    ×
                  </button>

                  <div className="image-success">
                    ✓ Question photo added
                  </div>

                </div>

              )}

              {/* TEXT */}

              <div className="question-input-wrapper">

                <textarea
                  value={questionText}
                  onChange={(event) =>
                    setQuestionText(
                      event.target.value
                    )
                  }
                  placeholder={
                    questionImage
                      ? "Add extra information about this question (optional)..."
                      : "Or type your question here..."
                  }
                />

              </div>

              {/* BUTTONS */}

              <div className="ai-actions">

                <label className="add-photo-button">

                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    hidden
                  />

                  📷 Add Photo

                </label>

                <button
                  className="primary-button solve-button"
                  onClick={solveProblem}
                  disabled={aiLoading}
                >

                  {aiLoading
                    ? "🤖 Reading question..."
                    : "✦ Solve with AI →"}

                </button>

              </div>

            </div>

            {/* =================================================
                AI RESULT
            ================================================= */}
            <div className="ai-result">
              {aiLoading ? (
                <div className="ai-loading">
                  <div className="loading-orb">🤖</div>
                  <h3>Lathso AI is solving your question...</h3>
                  <p>Reading the question and preparing a step-by-step explanation.</p>
                  <div className="loading-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : aiError ? (
                <div className="empty-ai">
                  <div className="empty-ai-icon">⚠️</div>
                  <h3>AI Tutor could not solve this</h3>
                  <p>{aiError}</p>
                  <button
                    className="secondary-button small"
                    type="button"
                    onClick={solveProblem}
                  >
                    Try Again →
                  </button>
                </div>
              ) : aiSolved ? (
                <div className="solution-result">
                  <div className="solution-header">
                    <div className="solution-icon">✓</div>
                    <div>
                      <h3>Solution Ready</h3>
                      <p>Explained step by step by your Lathso AI Tutor.</p>
                    </div>
                  </div>

                  <div className="solution-content">
                    <div className="solution-label">STEP-BY-STEP SOLUTION</div>
                    <div
                      style={{
                        overflowWrap: "anywhere",
                        fontSize: 13,
                        color: "inherit",
                      }}
                    >
                      {renderAIAnswer(aiAnswer)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-ai">
                  <div className="empty-ai-icon">✦</div>
                  <h3>Your AI solution will appear here</h3>
                  <p>Upload a question photo or type a question to get started.</p>
                </div>
              )}
            </div>

            {/* =================================================
                HUMAN TUTOR — PROMINENT LIVE ESCALATION
            ================================================= */}
            <div
              style={{
                marginTop: 18,
                padding: 18,
                borderRadius: 20,
                background: "linear-gradient(135deg, rgba(255,145,77,.12), rgba(124,92,255,.10))",
                border: "1px solid rgba(255,145,77,.28)",
                boxShadow: "0 18px 50px rgba(0,0,0,.18)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 15,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(255,145,77,.16)",
                    border: "1px solid rgba(255,145,77,.25)",
                    fontSize: 24,
                    flexShrink: 0,
                  }}
                >
                  👨‍🏫
                </div>
                <div style={{ flex: 1, minWidth: 210 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: ".12em", color: "#ffb27a", marginBottom: 5 }}>
                    NEED MORE CLARITY?
                  </div>
                  <strong style={{ display: "block", color: "#fff", fontSize: 15, marginBottom: 4 }}>
                    Talk to a real tutor instantly.
                  </strong>
                  <span style={{ color: "#aaa4b8", fontSize: 11, lineHeight: 1.5 }}>
                    Continue with a verified human tutor for personal, 1-to-1 guidance.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePage(activeChatSession ? "chat" : "instant-tutor")}
                  style={{
                    border: 0,
                    borderRadius: 13,
                    padding: "12px 16px",
                    background: "linear-gradient(135deg,#ff8a4c,#ff6b35)",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: "pointer",
                    boxShadow: "0 10px 28px rgba(255,107,53,.25)",
                    whiteSpace: "nowrap",
                  }}
                >
                  🔴 Talk to Instant Human Tutor (Live) →
                </button>
              </div>
            </div>

            {/* HUMAN TUTOR */}

            <div className="human-escalation">

              <div className="human-icon">
                👨‍🏫
              </div>

              <div>

                <strong>
                  Still confused?
                </strong>

                <p>
                  AI couldn't replace a human teacher.
                  Get personal help from a verified tutor.
                </p>

              </div>

              <button
                className="secondary-button small"
                onClick={() => setActivePage("instant-tutor")}>
                Get Human Tutor →
              </button>

            </div>

          </section>
        )}

        {/* =================================================
            INSTANT HUMAN TUTOR
        ================================================= */}
        {activePage === "instant-tutor" && (
          <section className="instant-human-page">
            <div className="instant-booking-hero">
              <div
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  zIndex: 2,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "linear-gradient(135deg,#ff8a4c,#ff6b35)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 900,
                  letterSpacing: ".08em",
                  boxShadow: "0 8px 24px rgba(255,107,53,.25)",
                  whiteSpace: "nowrap",
                }}
              >
                🎁 LAUNCH OFFER • 1 MONTH FREE
              </div>
              <div className="instant-hero-copy">
                <div className="instant-hero-eyebrow">
                  <span className="instant-pulse-dot" /> HUMAN HELP • LIVE MATCHING
                </div>
                <h1>Instant Human Tutor <span>⚡</span></h1>
                <p>Get one-to-one help from a verified tutor who is available right now.</p>
                <div
                  style={{
                    marginTop: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    borderRadius: 12,
                    background: "rgba(255,145,77,.12)",
                    border: "1px solid rgba(255,145,77,.25)",
                    color: "#ffb27a",
                    fontSize: 11,
                    fontWeight: 900,
                  }}
                >
                  🚀 Lathso Launch Offer: Instant Human Tutor Support — FREE for 1 Month
                </div>
                <div className="instant-hero-features">
                  <span>🎥 Video</span>
                  <span>🎙️ Audio</span>
                  <span>💬 Chat</span>
                  <span>✓ Verified tutors</span>
                </div>
              </div>
              <div className="instant-live-orb">
                <div className="instant-orb-ring">
                  <span>⚡</span>
                </div>
                <strong>LIVE</strong>
                <small>Matching now</small>
              </div>
            </div>

            {instantTutorRequest && ["pending", "accepted"].includes(instantTutorRequest.status) && (
              <div className="instant-request-banner">
                <div className="instant-request-orb">{instantTutorRequest.status === "accepted" ? "✓" : "⚡"}</div>
                <div>
                  <strong>
                    {instantTutorRequest.status === "accepted"
                      ? "Tutor accepted — connecting you now"
                      : "Instant request sent"}
                  </strong>
                  <p>
                    {instantTutorRequest.status === "accepted"
                      ? `${instantTutorRequest.tutorName || "Your tutor"} is ready. Your live session will open automatically.`
                      : `Waiting for ${instantTutorRequest.tutorName || "the selected tutor"} to accept your request.`}
                  </p>
                </div>
                <span className={`instant-status-pill ${instantTutorRequest.status}`}>
                  {instantTutorRequest.status.toUpperCase()}
                </span>
              </div>
            )}

            <div className="instant-human-card">
              <div className="instant-card-head">
                <div>
                  <div className="instant-section-label"><i /> AVAILABLE RIGHT NOW</div>
                  <h2>Choose your Human Tutor</h2>
                  <p>Verified tutors who are online and available can receive your instant doubt request.</p>
                </div>
                <div className="instant-count-card">
                  <strong>{onlineTutors.length}</strong>
                  <span>ONLINE NOW</span>
                </div>
              </div>

              {tutorsLoading ? (
                <div className="instant-empty-state">
                  <div className="instant-empty-icon">⌁</div>
                  <h3>Finding your best available tutors</h3>
                  <p>Checking verified tutor availability in real time...</p>
                  <div className="instant-loading-line"><i /></div>
                </div>
              ) : onlineTutors.length === 0 ? (
                <div className="instant-empty-state">
                  <div className="instant-empty-icon">🧑‍🏫</div>
                  <h3>No tutor is online right now</h3>
                  <p>Try again when a verified Lathso tutor becomes available.</p>
                </div>
              ) : (
                <div className="instant-tutor-grid">
                  {onlineTutors.map((tutor) => {
                    const requestPending = instantTutorRequest?.tutorId === tutor.id &&
                      instantTutorRequest?.status === "pending";
                    const requestAccepted = instantTutorRequest?.tutorId === tutor.id &&
                      instantTutorRequest?.status === "accepted";

                    return (
                      <article className="instant-tutor-card" key={tutor.id}>
                        <div className="instant-tutor-card-glow" />
                        <div className="instant-tutor-top">
                          <div className="instant-tutor-avatar-wrap">
                            <div className="instant-tutor-avatar">
                              {(tutor.name || "T").charAt(0).toUpperCase()}
                            </div>
                            <span className="instant-avatar-online"><i /></span>
                          </div>
                          <span className="instant-ready-pill"><i /> READY NOW</span>
                        </div>

                        <div className="instant-tutor-identity">
                          <h3>{tutor.name || "Verified Tutor"}</h3>
                          <span><b>✓</b> Verified Lathso Tutor</span>
                        </div>

                        <div className="instant-tutor-subject">
                          <strong>{tutor.subject || "General"}</strong>
                          <span>•</span>
                          <span>{tutor.experience || "Experienced Tutor"}</span>
                        </div>

                        <div className="instant-tutor-meta">
                          <span>⭐ {tutor.rating || "New"}</span>
                          <span>🎓 {tutor.education || "Qualified"}</span>
                        </div>

                        <div className="instant-connect-options">
                          <span>🎥 Video</span>
                          <span>🎙️ Audio</span>
                          <span>💬 Chat</span>
                        </div>

                        <button
                          className="primary-button instant-request-button"
                          type="button"
                          disabled={
                            Boolean(instantTutorRequest) &&
                            ["pending", "accepted"].includes(instantTutorRequest.status)
                          }
                          onClick={() => requestInstantTutor(tutor)}
                        >
                          <span>
                            {requestPending
                              ? "Request Pending..."
                              : requestAccepted
                              ? "Tutor Accepted ✓"
                              : "Request Tutor"}
                          </span>
                          {!requestPending && !requestAccepted && <b>→</b>}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="instant-bypass-note">
              <span>ⓘ</span>
              <div>
                <strong>Payment bypass is active for this phase</strong>
                <p>Instant tutor requests are sent directly. Payment gateway integration will be connected later without changing this tutor/session flow.</p>
              </div>
              <span className="instant-secure-label">🔒 SECURE REQUEST</span>
            </div>
          </section>
        )}

        {/* =================================================
            TUTOR SEARCH
        ================================================= */}

        {activePage === "tutors" && (
          <section>

            <div className="dashboard-header">
              <div>
                <h1>Find a Tutor 👨‍🏫</h1>
                <p>Find verified online and local tutors.</p>
              </div>
            </div>

            <div className="online-tutor-section">

              <div className="online-section-heading">
                <div>
                  <span className="demo-kicker">💻 ONLINE TUTOR</span>
                  <h2>Learn from verified online tutors</h2>
                  <p>
                    Online Tutor access requires an active Lathso subscription.
                  </p>
                </div>

                {subscription?.type && subscription.type !== "none" ? (
                  <span className="access-badge">✓ Access Active</span>
                ) : (
                  <span className="locked-badge">🔒 Subscription Required</span>
                )}
              </div>

              {!subscription?.type || subscription.type === "none" ? (
                <div className="online-locked-card">
                  <div className="locked-icon">🔒</div>
                  <div>
                    <h3>Online Tutor is locked</h3>
                    <p>
                      Subscribe to Online Tutor or Lathso Complete to access
                      verified online tutors and book sessions.
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setActivePage("subscription")}
                  >
                    View Plans →
                  </button>
                </div>
              ) : (
                <>
                  <div className="online-filters">
                    <select
                      value={onlineSubject}
                      onChange={(event) =>
                        setOnlineSubject(event.target.value)
                      }
                    >
                      <option>All Subjects</option>
                      <option>Mathematics</option>
                      <option>Physics</option>
                      <option>Chemistry</option>
                      <option>Biology</option>
                    </select>
                  </div>

                  <div className="online-tutor-grid">
                    {verifiedTutors
                      .filter(
                        (tutor) =>
                          onlineSubject === "All Subjects" ||
                          tutor.subject === onlineSubject
                      )
                      .map((tutor) => (
                        <OnlineTutorCard
                          key={tutor.id}
                          tutor={tutor}
                          onBook={() =>
                            setBookingTutor({
                              name: tutor.name,
                              subject: tutor.subject,
                              location: "Online",
                              mode: "Online",
                            })
                          }
                        />
                      ))}
                  </div>
                </>
              )}

            </div>

            <div className="home-demo-banner">
              <div className="home-demo-icon">🏠</div>

              <div className="home-demo-copy">
                <span className="demo-kicker">FREE HOME DEMO</span>
                <h2>Need a tutor at home?</h2>
                <p>
                  Lathso finds a suitable verified tutor within
                  <strong> 10 km</strong> based on your subject and location.
                </p>
              </div>

              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  setDemoForm((previous) => ({
                    ...previous,
                    subject: studentProfile.subjects?.[0] || previous.subject,
                    classLevel: studentProfile.classLevel || previous.classLevel,
                    location: studentProfile.location || previous.location,
                    address: studentProfile.address || previous.address,
                  }));
                  setDemoOpen(true);
                }}
              >
                Book Free Home Demo →
              </button>
            </div>

            {activeOfflineDemoSession && (
              <div className="assigned-demo-banner">
                <div>
                  <span className="demo-kicker">FREE HOME DEMO</span>
                  <h3>{activeOfflineDemoSession.tutor.name}</h3>
                  <p>{activeOfflineDemoSession.tutor.subject} • {activeOfflineDemoSession.tutor.distance} away • Verified</p>
                </div>
                <div className="assigned-demo-actions">
                  {activeOfflineDemoSession.status === "Demo Requested" && (
                    <button className="secondary-button" type="button" onClick={findAnotherHomeTutor}>🔄 Find Another</button>
                  )}
                  {activeOfflineDemoSession.status === "Demo Completed" ? (
                    <button className="primary-button" type="button" onClick={() => confirmOfflineTutor(activeOfflineDemoSession)}>✓ Confirm Tutor / Start Tuition</button>
                  ) : (
                    <span className="session-confirmed">{activeOfflineDemoSession.status}</span>
                  )}
                </div>
              </div>
            )}

            <div className="search-panel">
              <select defaultValue="">
                <option value="">Select Class</option>
                <option>Class 8</option>
                <option>Class 9</option>
                <option>Class 10</option>
                <option>Class 11</option>
                <option>Class 12</option>
                <option>JEE</option>
                <option>NEET</option>
              </select>

              <select defaultValue="">
                <option value="">Select Subject</option>
                <option>Mathematics</option>
                <option>Physics</option>
                <option>Chemistry</option>
                <option>Biology</option>
              </select>

              <select value={learningMode} onChange={(event) => setLearningMode(event.target.value)}>
                <option value="">Learning Mode</option>
                <option>Home Tutor</option>
                <option>Online Tutor</option>
              </select>

              <button className="primary-button" type="button" onClick={() => {
                if (learningMode === "Home Tutor" && !studentLocation) {
                  getBrowserLocation({ maximumAge: 0 }).then((coords) => { setStudentLocation(coords); setStudentLocationError(""); }).catch((error) => { setStudentLocationError(error?.message || "Could not access your location."); alert("Please allow location access to search offline tutors within 10 km."); });
                }
              }}>
                Search
              </button>
            </div>

            <div className="verified-tutor-section">
              <div className="verified-tutor-heading">
                <div>
                  <span className="demo-kicker">✓ ADMIN VERIFIED</span>
                  <h2>Verified Tutors</h2>
                  <p>Only tutors approved by Lathso Admin appear here.</p>
                </div>
                <span className="verified-count">{displayedTutors.length} Verified</span>
              </div>

              {tutorsLoading ? (
                <div className="verified-empty">
                  <div>⏳</div>
                  <h3>Loading verified tutors...</h3>
                  <p>Checking available tutors from Lathso backend.</p>
                </div>
              ) : displayedTutors.length === 0 ? (
                <div className="verified-empty">
                  <div>{learningMode === "Home Tutor" ? "📍" : "👨‍🏫"}</div>
                  <h3>{learningMode === "Home Tutor" ? "No offline tutors within 10 km" : "No newly approved tutors yet"}</h3>
                  <p>{learningMode === "Home Tutor" ? (studentLocationError || "Only verified tutors with an active location inside your 10 km radius are shown.") : "Once Admin approves a tutor, that tutor will automatically appear here."}</p>
                </div>
              ) : (
                <div className="tutor-grid">
                  {displayedTutors.map((tutor) => (
                    <VerifiedTutorCard
                      key={tutor.id}
                      tutor={tutor}
                      onBook={() =>
                        setBookingTutor({
                          id: tutor.id,
                          email: tutor.email || "",
                          name: tutor.name || "Verified Tutor",
                          subject: tutor.subject || "General",
                          location: tutor.location || "Nearby",
                          mode: learningMode === "Home Tutor" ? "Home Tutor" : (tutor.mode || "Online"),
                          distance: Number.isFinite(tutor.distanceKm) ? `${tutor.distanceKm.toFixed(1)} km` : (tutor.distance || "Nearby"),
                          rating: tutor.rating || "New",
                          experience: tutor.experience || "Verified",
                          verified: true,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            {demoOpen && (
              <HomeDemoModal
                form={demoForm}
                setForm={setDemoForm}
                onClose={() => setDemoOpen(false)}
                onSubmit={submitHomeDemo}
              />
            )}

          </section>
        )}

        {/* =================================================
            SUBSCRIPTION
        ================================================= */}

        {activePage === "subscription" && (
          <section className="subscription-page">

            <div className="dashboard-header">
              <div>
                <h1>Subscription Plans 💎</h1>
                <p>Choose the learning plan that fits your needs.</p>
              </div>
            </div>

            <div className="subscription-intro">
              <div className="subscription-intro-icon">✦</div>
              <div>
                <strong>Simple, flexible learning</strong>
                <p>Choose a plan for quick doubts or dedicated tutor sessions.</p>
              </div>
            </div>

            <div className="subscription-grid">

              <div className="subscription-card free-trial-card">
                <div className="plan-top">
                  <div className="plan-icon green-icon">🎁</div>
                  <span className="plan-badge free">FREE TRIAL</span>
                </div>
                <h2>Free Trial</h2>
                <p className="plan-description">Start learning free with 5 AI doubts and no payment.</p>
                <div className="plan-price"><strong>FREE</strong><span>5 Free Doubts Credits</span></div>
                <div className="plan-credit-box"><span className="credit-number">5</span><span>Free Doubts Credits</span></div>
                <div className="plan-divider" />
                <ul className="plan-features">
                  <li>✓ 5 Free Doubts Credits</li>
                  <li>✓ Text doubt support</li>
                  <li>✓ Image doubt support</li>
                  <li>✓ No monthly payment</li>
                </ul>
                <button
                  className="primary-button plan-button green-button"
                  type="button"
                  onClick={() => saveSubscriptionPlan({
                    id: "free_trial", name: "Free Trial", price: "₹0", period: "trial",
                    description: "5 Free Doubts Credits",
                    features: ["5 Free Doubts Credits", "Text doubt support", "Image doubt support", "No monthly payment"],
                  })}
                >
                  {subscription?.type === "free_trial" ? "Selected ✓" : "Start Free Trial →"}
                </button>
                <small className="plan-note">No payment required.</small>
              </div>

              <div className="subscription-card orange-card">
                <div className="plan-top">
                  <div className="plan-icon orange-icon">⚡</div>
                  <span className="plan-badge orange-badge">UNLIMITED</span>
                </div>
                <h2>Unlimited Doubts</h2>
                <p className="plan-description">Solve unlimited AI doubts throughout the month with no per-doubt charges.</p>
                <div className="plan-price"><strong>₹299</strong><span>/ month</span></div>
                <div className="plan-credit-box orange-credit-box"><span className="credit-number">∞</span><span>Unlimited Doubts</span></div>
                <div className="plan-divider" />
                <ul className="plan-features">
                  <li>✓ Unlimited AI doubts</li>
                  <li>✓ Text doubt support</li>
                  <li>✓ Image doubt support</li>
                  <li>✓ No per-doubt charges</li>
                </ul>
                <button
                  className="primary-button plan-button orange-button"
                  type="button"
                  onClick={() => saveSubscriptionPlan({
                    id: "pay_per_doubt", name: "Unlimited Doubts", price: "₹299", period: "/ month",
                    description: "Unlimited AI doubts for ₹299 per month",
                    features: ["Unlimited AI doubts", "Text doubt support", "Image doubt support", "No per-doubt charges"],
                  })}
                >
                  {subscription?.type === "pay_per_doubt" ? "Selected ✓" : "Select Plan →"}
                </button>
                <small className="plan-note">Unlimited doubts for one month.</small>
              </div>

              <div className="subscription-card orange-card">
                <div className="plan-top">
                  <div className="plan-icon orange-icon">👨‍🏫</div>
                  <span className="plan-badge orange-badge">DEDICATED</span>
                </div>
                <h2>Single Tutor Plan</h2>
                <p className="plan-description">Get one dedicated tutor for consistent learning, guidance and regular support.</p>
                <div className="plan-price"><strong>₹499</strong><span>/ month</span></div>
                <div className="plan-credit-box orange-credit-box"><span className="credit-number">1</span><span>Dedicated Tutor</span></div>
                <div className="plan-divider" />
                <ul className="plan-features">
                  <li>✓ 1 Dedicated Tutor</li>
                  <li>✓ 1 Hour Daily Session</li>
                  <li>✓ Regular tutor support</li>
                  <li>✓ Monthly learning plan</li>
                </ul>
                <button
                  className="primary-button plan-button orange-button"
                  type="button"
                  onClick={() => saveSubscriptionPlan({
                    id: "single_tutor", name: "Single Tutor Plan", price: "₹499", period: "/ month",
                    description: "1 Dedicated Tutor - 1 Hour Daily Session",
                    features: ["1 Dedicated Tutor", "1 Hour Daily Session", "Regular tutor support", "Monthly learning plan"],
                  })}
                >
                  {subscription?.type === "single_tutor" ? "Selected ✓" : "Select Plan →"}
                </button>
                <small className="plan-note">Dedicated tutor learning.</small>
              </div>

              <div className="subscription-card featured green-featured-card">
                <div className="popular-label green-popular-label">MOST POPULAR</div>
                <div className="plan-top">
                  <div className="plan-icon green-icon">👥</div>
                  <span className="plan-badge green-plan-badge">MULTI-SUBJECT</span>
                </div>
                <h2>Multi-Subject Plan</h2>
                <p className="plan-description">Learn multiple subjects with a team of dedicated tutors.</p>
                <div className="plan-price"><strong>₹999</strong><span>/ month</span></div>
                <div className="plan-credit-box green-credit-box"><span className="credit-number">3</span><span>Tutors • 45 Mins Daily</span></div>
                <div className="plan-divider" />
                <ul className="plan-features">
                  <li>✓ 3 Tutors</li>
                  <li>✓ 45 Mins Daily Sessions</li>
                  <li>✓ Multi-subject learning</li>
                  <li>✓ Regular tutor support</li>
                </ul>
                <button
                  className="primary-button plan-button green-button"
                  type="button"
                  onClick={() => saveSubscriptionPlan({
                    id: "multi_subject", name: "Multi-Subject Plan", price: "₹999", period: "/ month",
                    description: "3 Tutors - 45 Mins Daily Sessions",
                    features: ["3 Tutors", "45 Mins Daily Sessions", "Multi-subject learning", "Regular tutor support"],
                  })}
                >
                  {subscription?.type === "multi_subject" ? "Selected ✓" : "Select Plan →"}
                </button>
                <small className="plan-note">Best value for multi-subject learning.</small>
              </div>

            </div>

            <div className="subscription-footer">
              <span>🔒 Secure access</span>
              <span>✓ Flexible plans</span>
              <span>👨‍🏫 Dedicated tutors</span>
              <span>⚡ Quick doubt help</span>
            </div>

          </section>
        )}

        {/* =================================================
            SESSIONS
        ================================================= */}

        {activePage === "sessions" && (
          <section className="sessions-page">
            <div className="dashboard-header">
              <div>
                <h1>My Sessions 📅</h1>
                <p>Manage your upcoming, completed and cancelled tutor sessions.</p>
              </div>
            </div>

            {sessionsLoading && (
              <div className="session-empty">
                <div>⏳</div>
                <h2>Loading sessions...</h2>
                <p>Fetching your sessions from Firebase.</p>
              </div>
            )}

            {!sessionsLoading && sessionsError && (
              <div className="session-empty">
                <div>⚠️</div>
                <h2>Could not load sessions</h2>
                <p>{sessionsError}</p>
              </div>
            )}

            <div className="session-tabs">
              {["Upcoming", "Completed", "Cancelled"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={sessionFilter === tab ? "active" : ""}
                  onClick={() => setSessionFilter(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>

            {!sessionsLoading && !sessionsError && (
              <div className="session-management-list">
                {sessions.filter((session) => {
                if (sessionFilter === "Completed") return session.status === "Completed";
                if (sessionFilter === "Cancelled") return session.status === "Cancelled";
                return session.status !== "Completed" && session.status !== "Cancelled";
              }).length === 0 ? (
                <div className="session-empty">
                  <div>📅</div>
                  <h2>No {sessionFilter.toLowerCase()} sessions</h2>
                  <p>
                    {sessionFilter === "Upcoming"
                      ? "Book or confirm a tutor to create your next session."
                      : `Your ${sessionFilter.toLowerCase()} sessions will appear here.`}
                  </p>
                </div>
              ) : (
                sessions
                  .filter((session) => {
                    if (sessionFilter === "Completed") return session.status === "Completed";
                    if (sessionFilter === "Cancelled") return session.status === "Cancelled";
                    return session.status !== "Completed" && session.status !== "Cancelled";
                  })
                  .map((session) => (
                    <div className="managed-session-card" key={session.id}>
                      <div className="session-tutor-avatar">
                        {session.tutor.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="managed-session-body">
                        <div className="managed-session-title">
                          <div>
                            <h3>{session.tutor.name}</h3>
                            <p>
                              {session.tutor.subject} • {session.mode}
                            </p>
                          </div>

                          <span
                            className={
                              session.status === "Cancelled"
                                ? "badge red"
                                : session.status === "Completed" || session.status === "Offline Session Confirmed & Active"
                                ? "badge green"
                                : "badge yellow"
                            }
                          >
                            {session.status}
                          </span>
                        </div>

                        <div className="managed-session-meta">
                          <span>📅 {session.date}</span>
                          <span>⏰ {session.time}</span>
                          <span>✓ Verified Tutor</span>
                        </div>

                        <div className="managed-session-actions">
                          {session.sessionType === "Offline Home Demo" ? (
                            <>
                              {session.status === "Demo Completed" && (
                                <button type="button" className="primary-button" onClick={() => confirmOfflineTutor(session)}>✓ Confirm Tutor / Start Tuition</button>
                              )}
                              {session.status === "Offline Session Confirmed & Active" && (
                                <span className="session-confirmed">Offline Session Confirmed & Active</span>
                              )}
                            </>
                          ) : session.status !== "Completed" && session.status !== "Cancelled" && (
                              <>
                                <button
                                  type="button"
                                  className="primary-button"
                                  onClick={() => setVideoSession(session)}
                                >
                                  🎥 Join Session
                                </button>

                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() =>
                                    rescheduleSession(session.id)
                                  }
                                >
                                  🔄 Reschedule
                                </button>

                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() =>
                                    updateSessionStatus(
                                      session.id,
                                      "Cancelled"
                                    )
                                  }
                                >
                                  ❌ Cancel
                                </button>
                              </>
                            )}

                          {session.status !== "Cancelled" && (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => openSessionNotes(session)}
                            >
                              📝 Session Notes
                            </button>
                          )}

                          {session.status !== "Completed" &&
                            session.status !== "Cancelled" && (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  updateSessionStatus(
                                    session.id,
                                    "Completed"
                                  )
                                }
                              >
                                ✓ Mark Completed
                              </button>
                            )}
                        </div>
                      </div>
                    </div>
                  ))
              )}
              </div>
            )}
          </section>
        )}

        {/* =================================================
            PROFILE
        ================================================= */}

        {activePage === "profile" && (
          <section className="student-profile-page">
            <div className="dashboard-header">
              <div>
                <h1>My Profile 👤</h1>
                <p>Manage your learning details and tutor-matching information.</p>
              </div>
            </div>

            <div className="learnora-wallet-card">
              <div className="wallet-card-top">
                <div>
                  <span className="wallet-kicker">LATHSO WALLET</span>
                  <h2>Secure Wallet</h2>
                  <p>Recharge your Lathso wallet for future payments.</p>
                </div>
                <div className="wallet-icon">💳</div>
              </div>

              <div className="wallet-balance-row">
                <div>
                  <span>Current Balance</span>
                  <strong>{walletBalance === null ? "₹—" : `₹${walletBalance.toFixed(2)}`}</strong>
                    <small>{walletBalance === null ? "Loading secure wallet balance..." : "Live wallet balance"}</small>
                </div>
                <button type="button" className="wallet-add-button" onClick={openWalletTopup}>
                  + Add Money
                </button>
              </div>

              <div className="wallet-history-preview">
                <div className="wallet-history-heading">
                  <strong>Recent Transactions</strong>
                  <span>Secure ledger</span>
                </div>
                <div className="wallet-empty-state">
                  <span>🧾</span>
                  <p>No wallet transactions yet.</p>
                </div>
              </div>
            </div>

            <div className="profile-layout">
              <div className="profile-card profile-overview">
                <div className="profile-avatar">
                  {(studentProfile.name || "S").charAt(0).toUpperCase()}
                </div>
                <h2>{studentProfile.name || "Student"}</h2>
                <p>{studentProfile.classLevel}</p>
                <div className="profile-status">
                  {profileSaved ? "✓ Profile saved" : "• Complete your profile"}
                </div>

                <div className="profile-mini-info">
                  <div>
                    <span>📚 Subjects</span>
                    <strong>{studentProfile.subjects.length}</strong>
                  </div>
                  <div>
                    <span>📍 Location</span>
                    <strong>{studentProfile.location || "Not added"}</strong>
                  </div>
                  <div>
                    <span>🏠 Address</span>
                    <strong>{studentProfile.address ? "Added" : "Not added"}</strong>
                  </div>
                </div>
              </div>

              <div className="profile-card profile-form-card">
                <div className="profile-form-heading">
                  <h2>Learning Profile</h2>
                  <p>These details help Lathso match you with suitable tutors.</p>
                </div>

                <div className="profile-form">
                  <label>
                    Full Name
                    <input
                      value={studentProfile.name}
                      onChange={(event) =>
                        setStudentProfile({ ...studentProfile, name: event.target.value })
                      }
                      placeholder="Enter your full name"
                    />
                  </label>

                  <div className="profile-two-col">
                    <label>
                      Email
                      <input
                        type="email"
                        value={studentProfile.email}
                        onChange={(event) =>
                          setStudentProfile({ ...studentProfile, email: event.target.value })
                        }
                        placeholder="you@example.com"
                      />
                    </label>

                    <label>
                      Phone
                      <input
                        value={studentProfile.phone}
                        onChange={(event) =>
                          setStudentProfile({ ...studentProfile, phone: event.target.value })
                        }
                        placeholder="10-digit mobile number"
                      />
                    </label>
                  </div>

                  <label>
                    Class
                    <select
                      value={studentProfile.classLevel}
                      onChange={(event) =>
                        setStudentProfile({ ...studentProfile, classLevel: event.target.value })
                      }
                    >
                      <option>Class 8</option>
                      <option>Class 9</option>
                      <option>Class 10</option>
                      <option>Class 11</option>
                      <option>Class 12</option>
                      <option>JEE</option>
                      <option>NEET</option>
                    </select>
                  </label>

                  <div className="profile-field">
                    <span>Subjects</span>
                    <div className="subject-picker">
                      {["Mathematics", "Physics", "Chemistry", "Biology"].map((subject) => {
                        const selected = studentProfile.subjects.includes(subject);
                        return (
                          <button
                            key={subject}
                            type="button"
                            className={selected ? "subject-chip selected" : "subject-chip"}
                            onClick={() => {
                              if (selected && studentProfile.subjects.length === 1) return;
                              setStudentProfile({
                                ...studentProfile,
                                subjects: selected
                                  ? studentProfile.subjects.filter((item) => item !== subject)
                                  : [...studentProfile.subjects, subject],
                              });
                            }}
                          >
                            {selected ? "✓ " : ""}
                            {subject}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label>
                    Area / Location
                    <input
                      value={studentProfile.location}
                      onChange={(event) =>
                        setStudentProfile({ ...studentProfile, location: event.target.value })
                      }
                      placeholder="Example: Nellore / RK Valley"
                    />
                  </label>

                  <label>
                    Home Address
                    <textarea
                      rows="3"
                      value={studentProfile.address}
                      onChange={(event) =>
                        setStudentProfile({ ...studentProfile, address: event.target.value })
                      }
                      placeholder="Enter your complete home address"
                    />
                  </label>

                  <label className="parent-link-field">
                    Parent / Guardian Email
                    <input
                      type="email"
                      value={studentProfile.parentEmail}
                      onChange={(event) =>
                        setStudentProfile({ ...studentProfile, parentEmail: event.target.value })
                      }
                      placeholder="Enter the email used by your Parent account"
                    />
                    <small className="parent-link-help">Use the same email as your Parent Lathso account. After saving, the Parent Dashboard will connect to this student automatically.</small>
                  </label>

                  <div className="profile-match-box">
                    <strong>📍 10 KM HOME TUTOR MATCHING</strong>
                    <p>
                      Your location and learning requirements can be used to find
                      suitable approved tutors nearby.
                    </p>
                  </div>

                  <div className="profile-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={saveStudentProfile}
                      disabled={profileLoading || profileSaving}
                    >
                      {profileSaving
                        ? "Saving..."
                        : profileLoading
                        ? "Loading..."
                        : "Save Profile ✓"}
                    </button>

                    {profileMessage && (
                      <div className="profile-save-message" role="status">
                        {profileMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {walletTopupOpen && (
          <div className="payment-modal-overlay" role="dialog" aria-modal="true">
            <div className="payment-modal-card">
              <button
                type="button"
                className="payment-modal-close"
                onClick={() => setWalletTopupOpen(false)}
                aria-label="Close payment dialog"
              >
                ×
              </button>

              <span className="wallet-kicker">WALLET RECHARGE</span>
              <h2>Add Money</h2>
              <p className="payment-modal-subtitle">Choose an amount and payment method.</p>

              <div className="wallet-amount-grid">
                {[100, 250, 500, 1000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={walletTopupAmount === amount ? "wallet-amount active" : "wallet-amount"}
                    onClick={() => setWalletTopupAmount(amount)}
                  >
                    ₹{amount}
                  </button>
                ))}
              </div>

              <div className="payment-method-list">
                <button
                  type="button"
                  className={walletPaymentMethod === "online" ? "payment-method active" : "payment-method"}
                  onClick={() => setWalletPaymentMethod("online")}
                >
                  <span>💳</span>
                  <div><strong>Pay Online</strong><small>UPI • Cards • Net Banking</small></div>
                  <b>{walletPaymentMethod === "online" ? "✓" : ""}</b>
                </button>

                <button
                  type="button"
                  className={walletPaymentMethod === "wallet" ? "payment-method active" : "payment-method"}
                  onClick={() => setWalletPaymentMethod("wallet")}
                >
                  <span>👛</span>
                  <div><strong>Wallet</strong><small>For future internal wallet payments</small></div>
                  <b>{walletPaymentMethod === "wallet" ? "✓" : ""}</b>
                </button>
              </div>

              <button type="button" className="payment-continue-button" onClick={continueWalletPayment} disabled={paymentLoading}>
                {paymentLoading ? "Processing secure payment..." : `Continue • ₹${walletTopupAmount} →`}
              </button>

              <small className="payment-security-note">🔒 Payment success is verified by the secure backend, not by the browser.</small>
            </div>
          </div>
        )}

        {/* =================================================
            PERSONAL TUTOR
        ================================================= */}
        {activePage === "personalTutor" && (
          <section className="personal-tutor-page">
            <div className="dashboard-header">
              <div>
                <h1>Personal Tutor 👨‍🏫</h1>
                <p>Your confirmed and assigned tutors, slots, assignments and learning support.</p>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="personal-empty">
                <div className="personal-empty-icon">👨‍🏫</div>
                <h2>No Personal Tutor Yet</h2>
                <p>
                  Book a tutor or confirm a home demo. Once confirmed, that tutor
                  will automatically appear in this section.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setActivePage("tutors")}
                >
                  Find & Book Tutor →
                </button>
              </div>
            ) : (
              <>
                <div className="personal-tutor-grid">
                  {Array.from(
                    new Map(
                      sessions.map((session) => [
                        session.tutor.name,
                        session.tutor,
                      ])
                    ).values()
                  ).map((tutor) => {
                    const tutorSessions = sessions.filter(
                      (session) => session.tutor.name === tutor.name
                    );

                    const tutorAssignments = assignments.filter(
                      (assignment) => assignment.tutor === tutor.name
                    );

                    const tutorReviews = reviews.filter(
                      (review) => review.tutor === tutor.name
                    );

                    const averageRating =
                      tutorReviews.length > 0
                        ? (
                            tutorReviews.reduce(
                              (total, review) => total + Number(review.rating || 0),
                              0
                            ) / tutorReviews.length
                          ).toFixed(1)
                        : tutor.rating || "New";

                    const latestSession = tutorSessions[0];

                    return (
                      <div className="personal-tutor-card" key={tutor.name}>
                        <div className="personal-tutor-top">
                          <div className="personal-tutor-avatar">
                            {tutor.name.charAt(0).toUpperCase()}
                          </div>

                          <div className="personal-tutor-info">
                            <div className="personal-tutor-name-row">
                              <h2>{tutor.name}</h2>
                              <span className="verified-mini">✓ Verified</span>
                            </div>

                            <p>
                              {tutor.subject || "General"} •{" "}
                              {tutor.qualification || "Verified Tutor"}
                            </p>

                            <div className="personal-tutor-rating">
                              ⭐ {averageRating} • Personal Tutor
                            </div>
                          </div>
                        </div>

                        <div className="personal-tutor-status">
                          <span>✓ {latestSession?.status || "Confirmed"}</span>
                          <span>{latestSession?.mode || "Tutor Session"}</span>
                        </div>

                        <div className="personal-tutor-stats">
                          <div>
                            <span>Sessions</span>
                            <strong>{tutorSessions.length}</strong>
                          </div>
                          <div>
                            <span>Assignments</span>
                            <strong>{tutorAssignments.length}</strong>
                          </div>
                          <div>
                            <span>Reviews</span>
                            <strong>{tutorReviews.length}</strong>
                          </div>
                        </div>

                        <div className="personal-tutor-slot">
                          <span>Next / Latest Slot</span>
                          <strong>
                            📅 {latestSession?.date || "Not scheduled"}
                            {"  "}⏰ {latestSession?.time || "Not scheduled"}
                          </strong>
                        </div>

                        <div className="personal-tutor-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setActivePage("chat")}
                          >
                            💬 Chat
                          </button>

                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setActivePage("assignments")}
                          >
                            📝 Assignments
                          </button>

                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => setActivePage("sessions")}
                          >
                            📅 Sessions
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="personal-tutor-note">
                  <div>✦</div>
                  <div>
                    <strong>Your Personal Tutor is connected</strong>
                    <p>
                      Every confirmed booking or confirmed home-demo tutor is
                      automatically added here. Their booked slots, assignments,
                      chat and reviews can be accessed from this space.
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>
        )}

        {/* =================================================
            ASSIGNMENTS
        ================================================= */}
        {activePage === "assignments" && (
          <section className="assignments-page">
            <div className="dashboard-header">
              <div>
                <h1>My Assignments 📝</h1>
                <p>Complete assignments shared by your tutor and track your progress.</p>
              </div>
            </div>

            <div className="assignment-stats">
              <div className="assignment-stat">
                <span>Total</span>
                <strong>{assignments.length}</strong>
              </div>
              <div className="assignment-stat">
                <span>Pending</span>
                <strong>{assignments.filter((item) => item.status === "Pending").length}</strong>
              </div>
              <div className="assignment-stat">
                <span>Submitted</span>
                <strong>{assignments.filter((item) => item.status === "Submitted").length}</strong>
              </div>
            </div>

            <div className="assignments-panel">
              <div className="assignments-heading">
                <div>
                  <h2>Assignments</h2>
                  <p>Your tutor's learning tasks.</p>
                </div>
              </div>

              <div className="assignment-list">
                {assignments.map((assignment) => (
                  <div className="assignment-card" key={assignment.id}>
                    <div className="assignment-icon">📝</div>

                    <div className="assignment-body">
                      <div className="assignment-title-row">
                        <div>
                          <h3>{assignment.title}</h3>
                          <p>
                            {assignment.subject} • {assignment.topic}
                          </p>
                        </div>

                        <span
                          className={
                            assignment.status === "Submitted"
                              ? "badge green"
                              : "badge yellow"
                          }
                        >
                          {assignment.status === "Submitted"
                            ? "✓ Submitted"
                            : "⏳ Pending"}
                        </span>
                      </div>

                      <div className="assignment-meta">
                        <span>👨‍🏫 {assignment.tutor}</span>
                        <span>❓ {assignment.questions} Questions</span>
                        <span>📅 Due {assignment.dueDate}</span>
                        {assignment.marks !== null && (
                          <span>🏆 {assignment.marks}/{assignment.questions}</span>
                        )}
                      </div>

                      <button
                        className={
                          assignment.status === "Submitted"
                            ? "secondary"
                            : "primary"
                        }
                        onClick={() => openAssignment(assignment)}
                      >
                        {assignment.status === "Submitted"
                          ? "View Submission"
                          : "Open Assignment →"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* =================================================
            RATINGS & REVIEWS
        ================================================= */}
        {activePage === "reviews" && (
          <section className="ratings-page">
            <div className="dashboard-header">
              <div>
                <h1>Ratings & Reviews ⭐</h1>
                <p>Rate your tutor and share your learning experience.</p>
              </div>
            </div>

            <div className="rating-overview">
              <div className="rating-score">
                <strong>{reviews.length ? "—" : "—"}</strong>
                <div className="rating-stars">☆☆☆☆☆</div>
                <span>{reviews.length} reviews</span>
              </div>

              <div className="rating-tutor">
                <div className="review-avatar">{(chatTutor.name || "T").charAt(0).toUpperCase()}</div>
                <div>
                  <strong>{chatTutor.name}</strong>
                  <p>{chatTutor.subject || "—"} • {chatTutor.experience || "—"} • {sessions.length ? "Verified Tutor" : "No active tutor"}</p>
                </div>
              </div>

              <button
                className="primary"
                onClick={() => setReviewOpen(true)}
              >
                ⭐ Rate Tutor
              </button>
            </div>

            <div className="reviews-panel">
              <div className="reviews-heading">
                <div>
                  <h2>Student Reviews</h2>
                  <p>Recent feedback for your tutor.</p>
                </div>
              </div>

              {reviews.length === 0 ? (
                <div className="reviews-empty">
                  <div>⭐</div>
                  <h3>No reviews yet</h3>
                  <p>Be the first to rate your tutor.</p>
                </div>
              ) : (
                <div className="review-list">
                  {reviews.map((review) => (
                    <div className="review-card" key={review.id}>
                      <div className="review-avatar">
                        {review.tutor.charAt(0)}
                      </div>
                      <div className="review-body">
                        <div className="review-top">
                          <div>
                            <strong>{review.tutor}</strong>
                            <span>{review.subject}</span>
                          </div>
                          <small>{review.date}</small>
                        </div>
                        <div className="review-stars">
                          {"★".repeat(review.rating)}
                          <span>{"★".repeat(5 - review.rating)}</span>
                        </div>
                        <p>{review.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* =================================================
            TUTOR CHAT
        ================================================= */}
        {activePage === "chat" && (
          <section className="tutor-chat-page">
            <div className="dashboard-header">
              <div>
                <h1>Tutor Chat 💬</h1>
                <p>Chat with your assigned tutor for personal guidance.</p>
              </div>
            </div>

            <ChatInbox
              sessions={sessions}
              role="student"
              selectedSessionId={selectedChatSessionId}
              onSelectSession={setSelectedChatSessionId}
              onUnreadChange={setChatUnreadCount}
            />
          </section>
        )}

      {assignmentOpen && activeAssignment && (
        <div
          className="overlay"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setAssignmentOpen(false)
          }
        >
          <div className="modal assignment-modal">
            <button
              className="close"
              onClick={() => setAssignmentOpen(false)}
            >
              ×
            </button>

            <span className="eyebrow">ASSIGNMENT</span>
            <h2>{activeAssignment.title}</h2>
            <p className="muted">
              {activeAssignment.subject} • {activeAssignment.topic}
            </p>

            <div className="assignment-modal-info">
              <span>👨‍🏫 {activeAssignment.tutor}</span>
              <span>❓ {activeAssignment.questions} Questions</span>
              <span>📅 Due {activeAssignment.dueDate}</span>
            </div>

            {activeAssignment.status === "Submitted" ? (
              <div className="submission-result">
                <div className="submission-check">✓</div>
                <h3>Assignment Submitted</h3>
                <strong>
                  Score: {activeAssignment.marks}/{activeAssignment.questions}
                </strong>
                <p>Your tutor can review your submission and provide feedback.</p>
                <div className="actions end">
                  <button
                    className="primary"
                    onClick={() => setAssignmentOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={submitAssignment}>
                <div className="assignment-question">
                  <span>Question Set</span>
                  <strong>
                    Complete all {activeAssignment.questions} questions.
                  </strong>
                  <p>
                    Write your solution, explanation or answers below. This
                    frontend version records your submission locally.
                  </p>
                </div>

                <label>
                  Your Answer / Solution
                  <textarea
                    rows="8"
                    value={assignmentAnswer}
                    onChange={(event) =>
                      setAssignmentAnswer(event.target.value)
                    }
                    placeholder="Type your answers here..."
                  />
                </label>

                <div className="actions end">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setAssignmentOpen(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="primary">
                    Submit Assignment ✓
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {reviewOpen && (
        <div
          className="overlay"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setReviewOpen(false)
          }
        >
          <div className="modal review-modal">
            <button
              className="close"
              onClick={() => setReviewOpen(false)}
            >
              ×
            </button>

            <span className="eyebrow">TUTOR REVIEW</span>
            <h2>Rate Your Tutor ⭐</h2>
            <p className="muted">
              How was your tutor learning experience?
            </p>

            <form onSubmit={submitReview}>
              <div className="star-picker" aria-label="Choose rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={star <= reviewRating ? "selected" : ""}
                    onClick={() => setReviewRating(star)}
                    aria-label={`${star} star rating`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="selected-rating">
                {reviewRating}/5 —{" "}
                {reviewRating === 5
                  ? "Excellent"
                  : reviewRating === 4
                  ? "Very Good"
                  : reviewRating === 3
                  ? "Good"
                  : reviewRating === 2
                  ? "Needs Improvement"
                  : "Poor"}
              </div>

              <label>
                Your Review
                <textarea
                  rows="5"
                  value={reviewText}
                  onChange={(event) => setReviewText(event.target.value)}
                  placeholder="Tell us about your tutor..."
                />
              </label>

              <div className="actions end">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setReviewOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Submit Review ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {sessionNoteOpen && selectedSession && (
        <div
          className="overlay"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setSessionNoteOpen(false)
          }
        >
          <div className="modal session-note-modal">
            <button
              className="close"
              type="button"
              onClick={() => setSessionNoteOpen(false)}
            >
              ×
            </button>

            <span className="eyebrow">SESSION NOTES</span>
            <h2>{selectedSession.tutor.name}</h2>
            <p className="muted">
              {selectedSession.tutor.subject} • {selectedSession.date} •{" "}
              {selectedSession.time}
            </p>

            <form onSubmit={saveSessionNote}>
              <label>
                Notes
                <textarea
                  rows="7"
                  value={sessionNote}
                  onChange={(event) => setSessionNote(event.target.value)}
                  placeholder="Add questions, topics covered, homework or anything you want to remember..."
                />
              </label>

              <div className="actions end">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSessionNoteOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button">
                  Save Notes ✓
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bookingTutor && (
        <BookingModal
          tutor={bookingTutor}
          onClose={() => setBookingTutor(null)}
          onConfirm={confirmBooking}
        />
      )}

      </main>
    </div>
    </>
  );
}




const TUTOR_CHAT_CSS = `
.tutor-chat-page{padding-bottom:40px}
.tutor-chat-shell{
  max-width:900px;
  height:min(680px,calc(100vh - 210px));
  min-height:520px;
  display:flex;
  flex-direction:column;
  overflow:hidden;
  border:1px solid rgba(124,92,255,.18);
  border-radius:22px;
  background:linear-gradient(180deg,#17152a,#111021);
  box-shadow:0 18px 45px rgba(0,0,0,.18)
}
.tutor-chat-header{
  display:flex;
  align-items:center;
  gap:14px;
  padding:18px 20px;
  border-bottom:1px solid rgba(255,255,255,.08)
}
.chat-tutor-avatar{
  width:50px;
  height:50px;
  display:grid;
  place-items:center;
  flex:none;
  border-radius:16px;
  background:linear-gradient(135deg,#6d3df0,#8b5cf6);
  color:#fff;
  font-size:19px;
  font-weight:900
}
.chat-tutor-info h2{margin:0 0 4px;font-size:17px}
.chat-tutor-info p{margin:0 0 6px;font-size:11px;opacity:.62}
.chat-online{
  display:inline-flex;
  align-items:center;
  gap:5px;
  font-size:10px;
  color:#86efac;
  font-weight:800
}
.chat-online i{
  width:7px;
  height:7px;
  border-radius:50%;
  background:#22c55e;
  display:block
}
.chat-messages{
  flex:1;
  overflow-y:auto;
  padding:24px;
  display:flex;
  flex-direction:column;
  gap:12px
}
.chat-message{display:flex}
.chat-message.student{justify-content:flex-end}
.chat-message.tutor{justify-content:flex-start}
.chat-bubble{
  max-width:min(70%,520px);
  padding:11px 14px;
  border-radius:16px;
  background:rgba(255,255,255,.055);
  border:1px solid rgba(255,255,255,.08)
}
.chat-message.student .chat-bubble{
  background:rgba(124,92,255,.22);
  border-color:rgba(139,92,246,.28);
  border-bottom-right-radius:5px
}
.chat-message.tutor .chat-bubble{border-bottom-left-radius:5px}
.chat-bubble p{margin:0;line-height:1.5;font-size:13px}
.chat-bubble small{
  display:block;
  margin-top:5px;
  font-size:9px;
  opacity:.48;
  text-align:right
}
.chat-input-row{
  display:flex;
  align-items:center;
  gap:9px;
  padding:14px;
  border-top:1px solid rgba(255,255,255,.08);
  background:rgba(0,0,0,.12)
}
.chat-input-row input{
  flex:1;
  min-width:0;
  padding:12px 14px;
  border:1px solid rgba(255,255,255,.1);
  border-radius:12px;
  background:#0d0c1d;
  color:#fff;
  outline:none;
  font:inherit
}
.chat-input-row input::placeholder{opacity:.42}
.chat-attach,.chat-send{
  border:0;
  border-radius:12px;
  cursor:pointer;
  font:inherit;
  font-weight:800
}
.chat-attach{
  width:43px;
  height:43px;
  background:rgba(255,255,255,.06);
  color:#fff
}
.chat-send{
  padding:12px 17px;
  background:#7651ff;
  color:#fff
}





.sessions-page{padding-bottom:40px}
.session-tabs{
  display:flex;
  gap:5px;
  width:max-content;
  max-width:100%;
  margin-bottom:18px;
  padding:4px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:13px;
  background:#111021
}
.session-tabs button{
  border:0;
  padding:9px 13px;
  border-radius:9px;
  background:transparent;
  color:#817d90;
  font-size:10px;
  font-weight:800;
  cursor:pointer
}
.session-tabs button.active{
  color:#fff;
  background:#6d3df0
}
.session-management-list{display:grid;gap:12px}
.managed-session-card{
  display:flex;
  gap:14px;
  padding:18px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:18px;
  background:rgba(255,255,255,.035)
}
.session-tutor-avatar{
  width:48px;height:48px;
  display:grid;place-items:center;
  flex:none;
  border-radius:14px;
  background:linear-gradient(135deg,#6d3df0,#8b5cf6);
  color:#fff;font-size:18px;font-weight:900
}
.managed-session-body{flex:1;min-width:0}
.managed-session-title{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:12px
}
.managed-session-title h3{margin:0 0 4px;font-size:14px}
.managed-session-title p{margin:0;color:#817d90;font-size:10px}
.managed-session-meta{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  margin:12px 0
}
.managed-session-meta span{
  padding:6px 8px;
  border-radius:999px;
  background:rgba(255,255,255,.05);
  color:#9995a7;
  font-size:9px
}
.managed-session-actions{
  display:flex;
  flex-wrap:wrap;
  gap:7px
}
.managed-session-actions button{font-size:10px}
.session-empty{
  padding:65px 20px;
  text-align:center;
  border:1px dashed rgba(255,255,255,.12);
  border-radius:20px
}
.session-empty div{font-size:34px}
.session-empty h2{margin:10px 0 5px;font-size:17px}
.session-empty p{margin:0;color:#817d90;font-size:10px}
@media(max-width:650px){
  .session-tabs{width:100%;overflow:auto}
  .session-tabs button{flex:1;white-space:nowrap}
  .managed-session-card{align-items:flex-start}
  .managed-session-title{flex-direction:column}
  .managed-session-actions{display:grid;grid-template-columns:1fr}
  .managed-session-actions button{width:100%}
}

.personal-tutor-page{padding-bottom:40px}
.personal-tutor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.personal-tutor-card{
  padding:20px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:19px;
  background:rgba(255,255,255,.035)
}
.personal-tutor-top{display:flex;align-items:center;gap:13px}
.personal-tutor-avatar{
  width:52px;height:52px;display:grid;place-items:center;flex:none;
  border-radius:16px;
  background:linear-gradient(135deg,#6d3df0,#8b5cf6);
  color:#fff;font-size:20px;font-weight:900
}
.personal-tutor-info{min-width:0;flex:1}
.personal-tutor-name-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.personal-tutor-name-row h2{margin:0;font-size:17px}
.personal-tutor-info p{margin:4px 0;color:#817d90;font-size:10px}
.verified-mini{
  padding:4px 7px;border-radius:999px;
  background:rgba(34,197,94,.09);color:#86efac;
  font-size:8px;font-weight:800
}
.personal-tutor-rating{color:#aaa6b7;font-size:10px}
.personal-tutor-status{
  display:flex;gap:7px;flex-wrap:wrap;margin-top:12px
}
.personal-tutor-status span{
  padding:6px 9px;border-radius:999px;
  background:rgba(34,197,94,.08);
  color:#9ae6b4;font-size:8px;font-weight:800
}
.personal-tutor-slot{
  margin:13px 0;
  padding:11px 12px;
  border:1px solid rgba(255,255,255,.06);
  border-radius:12px;
  background:rgba(255,255,255,.025)
}
.personal-tutor-slot span{
  display:block;color:#817d90;font-size:8px
}
.personal-tutor-slot strong{
  display:block;margin-top:5px;font-size:10px;line-height:1.5
}

.personal-tutor-stats{
  display:grid;grid-template-columns:repeat(3,1fr);gap:8px;
  margin:17px 0
}
.personal-tutor-stats div{
  padding:11px;border-radius:12px;background:rgba(255,255,255,.035)
}
.personal-tutor-stats span{display:block;color:#817d90;font-size:8px}
.personal-tutor-stats strong{display:block;margin-top:5px;font-size:18px}
.personal-tutor-actions{display:flex;gap:8px;flex-wrap:wrap}
.personal-tutor-actions button{flex:1;min-width:110px}
.personal-tutor-details{
  display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px
}
.personal-tutor-details div{
  padding:10px;border:1px solid rgba(255,255,255,.06);border-radius:11px
}
.personal-tutor-details span{display:block;color:#817d90;font-size:8px}
.personal-tutor-details strong{display:block;margin-top:4px;font-size:10px}
.personal-empty{
  padding:65px 20px;text-align:center;
  border:1px dashed rgba(255,255,255,.12);border-radius:20px
}
.personal-empty-icon{font-size:38px}
.personal-empty h2{margin:10px 0 6px;font-size:18px}
.personal-empty p{
  max-width:450px;margin:0 auto 18px;color:#817d90;font-size:11px;line-height:1.6
}
.personal-tutor-note{
  display:flex;gap:12px;align-items:flex-start;
  margin-top:17px;padding:16px;
  border:1px solid rgba(124,92,255,.17);border-radius:15px;
  background:rgba(124,92,255,.05)
}
.personal-tutor-note>div:first-child{font-size:18px}
.personal-tutor-note strong{font-size:11px}
.personal-tutor-note p{margin:5px 0 0;color:#817d90;font-size:10px;line-height:1.5}
@media(max-width:800px){
  .personal-tutor-grid{grid-template-columns:1fr}
}
@media(max-width:650px){
  .personal-tutor-actions{display:grid;grid-template-columns:1fr}
  .personal-tutor-actions button{width:100%}
  .personal-tutor-details{grid-template-columns:1fr}
}

.assignments-page{padding-bottom:40px}
.assignment-stats{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:14px;
  margin-bottom:18px
}
.assignment-stat{
  padding:17px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:17px;
  background:rgba(255,255,255,.035)
}
.assignment-stat span{
  display:block;
  color:#817d90;
  font-size:10px
}
.assignment-stat strong{
  display:block;
  margin-top:7px;
  font-size:24px
}
.assignments-panel{
  padding:20px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:19px;
  background:rgba(255,255,255,.035)
}
.assignments-heading h2{margin:0 0 4px;font-size:18px}
.assignments-heading p{margin:0 0 16px;color:#817d90;font-size:10px}
.assignment-list{display:grid;gap:12px}
.assignment-card{
  display:flex;
  gap:14px;
  padding:17px;
  border:1px solid rgba(255,255,255,.07);
  border-radius:16px;
  background:rgba(255,255,255,.025)
}
.assignment-icon{
  width:44px;
  height:44px;
  display:grid;
  place-items:center;
  flex:none;
  border-radius:13px;
  background:rgba(124,92,255,.1);
  font-size:20px
}
.assignment-body{flex:1;min-width:0}
.assignment-title-row{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:12px
}
.assignment-title-row h3{margin:0 0 4px;font-size:14px}
.assignment-title-row p{margin:0;color:#817d90;font-size:10px}
.assignment-meta{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  margin:12px 0
}
.assignment-meta span{
  padding:6px 8px;
  border-radius:999px;
  background:rgba(255,255,255,.05);
  color:#9995a7;
  font-size:9px
}
.assignment-modal-info{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  margin:18px 0;
  padding:12px;
  border-radius:13px;
  background:rgba(124,92,255,.06);
  color:#9d99aa;
  font-size:10px
}
.assignment-question{
  padding:14px;
  margin-bottom:16px;
  border:1px solid rgba(124,92,255,.16);
  border-radius:13px;
  background:rgba(124,92,255,.06)
}
.assignment-question span{
  display:block;
  color:#a78bfa;
  font-size:9px;
  font-weight:800;
  letter-spacing:.1em
}
.assignment-question strong{
  display:block;
  margin-top:7px;
  font-size:12px
}
.assignment-question p{
  margin:7px 0 0;
  color:#817d90;
  font-size:10px;
  line-height:1.5
}
.submission-result{text-align:center;padding:20px 0 5px}
.submission-check{
  width:52px;
  height:52px;
  display:grid;
  place-items:center;
  margin:0 auto 12px;
  border-radius:50%;
  background:rgba(34,197,94,.1);
  color:#86efac;
  font-size:25px
}
.submission-result h3{margin:0 0 8px;font-size:16px}
.submission-result strong{font-size:24px}
.submission-result p{color:#817d90;font-size:10px;line-height:1.5}
@media(max-width:650px){
  .assignment-stats{grid-template-columns:1fr}
  .assignment-card{align-items:flex-start}
  .assignment-title-row{flex-direction:column}
  .assignment-body .primary,.assignment-body .secondary{width:100%}
}

.ratings-page{padding-bottom:40px}
.rating-overview{
  display:flex;
  align-items:center;
  gap:20px;
  padding:20px;
  margin-bottom:18px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:19px;
  background:rgba(255,255,255,.035)
}
.rating-score{
  min-width:115px;
  text-align:center;
  padding-right:20px;
  border-right:1px solid rgba(255,255,255,.08)
}
.rating-score strong{display:block;font-size:38px;line-height:1}
.rating-stars,.review-stars{color:#fbbf24;letter-spacing:2px;margin-top:7px}
.rating-score span{display:block;margin-top:5px;color:#817d90;font-size:9px}
.rating-tutor{display:flex;align-items:center;gap:12px;flex:1}
.review-avatar{
  width:43px;
  height:43px;
  display:grid;
  place-items:center;
  flex:none;
  border-radius:13px;
  background:linear-gradient(135deg,#6d3df0,#8b5cf6);
  color:#fff;
  font-weight:900
}
.rating-tutor strong{font-size:14px}
.rating-tutor p{margin:4px 0 0;color:#817d90;font-size:10px}
.reviews-panel{
  padding:20px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:19px;
  background:rgba(255,255,255,.035)
}
.reviews-heading h2{margin:0 0 4px;font-size:18px}
.reviews-heading p{margin:0 0 16px;color:#817d90;font-size:10px}
.review-list{display:grid;gap:11px}
.review-card{
  display:flex;
  gap:12px;
  padding:15px;
  border:1px solid rgba(255,255,255,.07);
  border-radius:15px;
  background:rgba(255,255,255,.025)
}
.review-body{flex:1;min-width:0}
.review-top{display:flex;justify-content:space-between;gap:10px}
.review-top strong{display:block;font-size:12px}
.review-top span{display:block;margin-top:3px;color:#817d90;font-size:9px}
.review-top small{color:#656173;font-size:8px}
.review-stars{font-size:11px;margin-top:7px}
.review-stars span{color:#4b4758;letter-spacing:2px}
.review-body p{margin:7px 0 0;color:#aaa6b7;font-size:11px;line-height:1.5}
.reviews-empty{text-align:center;padding:40px;color:#817d90}
.reviews-empty div{font-size:30px}
.reviews-empty h3{color:#d9d5e5;font-size:14px}
.reviews-empty p{font-size:10px}
.star-picker{
  display:flex;
  justify-content:center;
  gap:6px;
  margin:22px 0 5px
}
.star-picker button{
  border:0;
  background:transparent;
  color:#4b4758;
  font-size:35px;
  line-height:1;
  padding:2px;
  cursor:pointer
}
.star-picker button.selected{color:#fbbf24}
.selected-rating{text-align:center;color:#aaa6b7;font-size:11px;margin-bottom:20px}
@media(max-width:650px){
  .rating-overview{align-items:flex-start;flex-direction:column}
  .rating-score{width:100%;padding:0 0 14px;border-right:0;border-bottom:1px solid rgba(255,255,255,.08)}
  .rating-tutor{width:100%}
  .rating-overview .primary{width:100%}
}

.notification-wrap{position:relative}
.notification-button{position:relative}
.notification-dot{position:absolute;top:7px;right:7px;width:7px;height:7px;border-radius:50%;background:#a78bfa;border:2px solid #111021}
.notification-panel{position:absolute;top:52px;right:0;width:360px;max-width:calc(100vw - 36px);overflow:hidden;z-index:50;border:1px solid rgba(139,92,246,.24);border-radius:17px;background:#111021;box-shadow:0 24px 65px rgba(0,0,0,.48)}
.notification-panel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;border-bottom:1px solid rgba(255,255,255,.07)}
.notification-panel-header strong{display:block;font-size:13px}
.notification-panel-header span{display:block;margin-top:3px;color:#77738b;font-size:9px}
.notification-read,.notification-clear{border:0;background:transparent;color:#a78bfa;cursor:pointer;font-size:9px;font-weight:750}
.notification-list{max-height:350px;overflow:auto}
.notification-item{display:flex;gap:11px;padding:13px 15px;border-bottom:1px solid rgba(255,255,255,.05)}
.notification-item.unread{background:rgba(124,92,255,.065)}
.notification-icon{width:32px;height:32px;display:grid;place-items:center;flex:none;border-radius:10px;background:rgba(124,92,255,.1);font-size:14px}
.notification-content{min-width:0}
.notification-content strong{display:block;font-size:11px}
.notification-content p{margin:4px 0;color:#898595;font-size:10px;line-height:1.45}
.notification-content small{color:#656173;font-size:8px}
.notification-empty{padding:35px 15px;text-align:center;color:#77738b}
.notification-empty div{font-size:24px}
.notification-empty p{font-size:10px}
.notification-clear{width:100%;padding:11px;border-top:1px solid rgba(255,255,255,.07)}

@media(max-width:650px){
  .tutor-chat-shell{
    height:calc(100vh - 190px);
    min-height:430px
  }
  .chat-bubble{max-width:82%}
  .chat-input-row{padding:10px}
  .chat-send{padding:12px}
}
`;

const PROFILE_CSS = `
.profile-save-message{margin-top:10px;padding:10px 12px;border-radius:11px;background:rgba(124,92,255,.08);border:1px solid rgba(167,139,250,.18);color:#c5bdd4;font-size:11px;line-height:1.5}
.profile-actions .primary-button:disabled{opacity:.6;cursor:not-allowed}

.student-profile-page{padding-bottom:40px}

/* PAYMENT FRONTEND ONLY - isolated styles; existing app styles untouched */
.learnora-wallet-card{margin:0 0 20px;padding:22px;border:1px solid rgba(40,150,255,.20);border-radius:22px;background:linear-gradient(145deg,rgba(25,64,110,.30),rgba(7,18,39,.70));backdrop-filter:blur(18px);box-shadow:0 18px 50px rgba(0,0,0,.24)}
.wallet-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.wallet-kicker{display:block;font-size:9px;font-weight:900;letter-spacing:.14em;color:#ffad5c}.learnora-wallet-card h2{margin:6px 0 5px;font-size:22px}.wallet-card-top p{margin:0;color:#aaa4b8;font-size:11px}.wallet-icon{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;background:rgba(255,145,77,.12);border:1px solid rgba(255,145,77,.24);font-size:22px}.wallet-balance-row{margin-top:18px;padding:16px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;gap:16px}.wallet-balance-row span,.wallet-balance-row small{display:block;color:#817d90;font-size:9px}.wallet-balance-row strong{display:block;margin:5px 0;font-size:28px}.wallet-add-button{border:0;border-radius:12px;padding:12px 16px;background:linear-gradient(135deg,#ff8a4c,#ff6b35);color:#fff;font-weight:900;font-size:11px;white-space:nowrap;box-shadow:0 10px 26px rgba(255,107,53,.20)}.wallet-history-preview{margin-top:16px}.wallet-history-heading{display:flex;justify-content:space-between;gap:12px;align-items:center}.wallet-history-heading strong{font-size:12px}.wallet-history-heading span{font-size:9px;color:#69d99a}.wallet-empty-state{margin-top:9px;padding:14px;border:1px dashed rgba(255,255,255,.10);border-radius:14px;text-align:center;color:#817d90}.wallet-empty-state span{font-size:18px}.wallet-empty-state p{margin:5px 0 0;font-size:10px}.payment-modal-overlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(3,7,18,.78);backdrop-filter:blur(7px)}.payment-modal-card{position:relative;width:min(480px,100%);padding:26px;border:1px solid rgba(70,170,255,.24);border-radius:24px;background:linear-gradient(145deg,rgba(20,48,86,.98),rgba(7,15,32,.99));box-shadow:0 30px 90px rgba(0,0,0,.48)}.payment-modal-close{position:absolute;right:16px;top:13px;width:34px;height:34px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.04);color:#fff;font-size:20px}.payment-modal-card h2{margin:7px 0 4px;font-size:24px}.payment-modal-subtitle{margin:0 0 18px;color:#aaa4b8;font-size:11px}.wallet-amount-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.wallet-amount{padding:12px 8px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(255,255,255,.035);color:#fff;font-weight:800;font-size:11px}.wallet-amount.active{border-color:rgba(255,138,0,.55);background:rgba(255,138,0,.10);color:#ffb46e}.payment-method-list{display:grid;gap:9px;margin-top:18px}.payment-method{display:grid;grid-template-columns:34px 1fr 20px;align-items:center;gap:10px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.035);color:#fff;text-align:left}.payment-method.active{border-color:rgba(255,138,0,.48);background:rgba(255,138,0,.08)}.payment-method>span{font-size:18px}.payment-method strong,.payment-method small{display:block}.payment-method strong{font-size:11px}.payment-method small{margin-top:3px;color:#817d90;font-size:9px}.payment-method b{color:#6ee7a0}.payment-continue-button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:13px;background:linear-gradient(135deg,#ff8a4c,#ff6b35);color:#fff;font-weight:900;font-size:12px;box-shadow:0 12px 30px rgba(255,107,53,.20)}.payment-security-note{display:block;margin-top:11px;text-align:center;color:#77738b;font-size:8px;line-height:1.5}@media(max-width:560px){.wallet-balance-row{align-items:stretch;flex-direction:column}.wallet-add-button{width:100%}.wallet-amount-grid{grid-template-columns:repeat(2,1fr)}}
.profile-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px;align-items:start}
.profile-card{border:1px solid rgba(124,92,255,.18);border-radius:22px;background:linear-gradient(180deg,#17152a,#111021);box-shadow:0 18px 45px rgba(0,0,0,.18)}
.profile-overview{padding:26px;text-align:center;position:sticky;top:24px}
.profile-avatar{width:78px;height:78px;display:grid;place-items:center;margin:0 auto 13px;border-radius:23px;background:linear-gradient(135deg,#6d3df0,#8b5cf6);color:#fff;font-size:31px;font-weight:900}
.profile-overview h2{margin:0 0 5px;font-size:21px}
.profile-overview>p{margin:0 0 12px;opacity:.62;font-size:12px}
.profile-status{display:inline-block;padding:7px 10px;border-radius:999px;background:rgba(34,197,94,.09);color:#86efac;font-size:10px;font-weight:800}
.profile-mini-info{display:grid;gap:8px;margin-top:22px;text-align:left}
.profile-mini-info div{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px;border-radius:12px;background:rgba(255,255,255,.035)}
.profile-mini-info span{font-size:10px;opacity:.62}
.profile-mini-info strong{max-width:125px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.profile-form-card{padding:25px}
.profile-form-heading{margin-bottom:20px}
.profile-form-heading h2{margin:0 0 5px;font-size:20px}
.profile-form-heading p{margin:0;font-size:12px;opacity:.62}
.profile-form{display:grid;gap:16px}
.profile-form label,.profile-field{display:grid;gap:7px;font-size:11px;font-weight:700}
.profile-form input,.profile-form select,.profile-form textarea{width:100%;box-sizing:border-box;padding:12px 13px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:#0d0c1d;color:#fff;outline:none;font:inherit;font-weight:400}
.profile-form textarea{resize:vertical}
.profile-two-col{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.subject-picker{display:flex;flex-wrap:wrap;gap:8px}
.subject-chip{padding:8px 11px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background:#0d0c1d;color:#9b97aa;font-size:10px;font-weight:700;cursor:pointer}
.subject-chip.selected{border-color:rgba(139,92,246,.6);background:rgba(124,92,255,.14);color:#fff}
.profile-match-box{padding:14px;border:1px solid rgba(124,92,255,.2);border-radius:14px;background:rgba(124,92,255,.07)}
.profile-match-box strong{display:block;color:#cfc5ff;font-size:10px}
.profile-match-box p{margin:5px 0 0;line-height:1.5;font-size:11px;opacity:.65}
.profile-actions{display:flex;justify-content:flex-end}
@media(max-width:850px){.profile-layout{grid-template-columns:1fr}.profile-overview{position:static}.profile-two-col{grid-template-columns:1fr}}
`;

function SubscriptionStyles() {
  return (
    <style>{`
      .subscription-page { padding-bottom: 36px; }
      .subscription-intro { display:flex; align-items:center; gap:14px; margin-bottom:24px; padding:18px 20px; border:1px solid rgba(40,150,255,.22); border-radius:18px; background:rgba(20,90,180,.10); backdrop-filter:blur(14px); box-shadow:0 12px 35px rgba(0,0,0,.16); }
      .subscription-intro-icon { width:44px; height:44px; display:grid; place-items:center; border-radius:14px; background:rgba(255,138,0,.12); color:#ff9d24; font-size:20px; }
      .subscription-intro p { margin:4px 0 0; opacity:.7; }
      .subscription-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:18px; align-items:stretch; }
      .subscription-card { position:relative; display:flex; flex-direction:column; min-height:560px; padding:24px; border:1px solid rgba(74,170,255,.20); border-radius:24px; background:linear-gradient(145deg,rgba(25,64,110,.34),rgba(7,18,39,.72)); backdrop-filter:blur(18px); box-shadow:0 18px 50px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.05); overflow:visible; transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease; }
      .subscription-card:hover { transform:translateY(-4px); border-color:rgba(70,170,255,.42); box-shadow:0 22px 60px rgba(0,0,0,.34); }
      .subscription-card.orange-card { border-color:rgba(255,138,0,.22); }
      .subscription-card.orange-card:hover { border-color:rgba(255,138,0,.50); }
      .subscription-card.featured { border:1px solid rgba(34,197,94,.55); }
      .subscription-card.green-featured-card { box-shadow:0 20px 60px rgba(34,197,94,.12),inset 0 1px 0 rgba(255,255,255,.05); }
      .popular-label { position:absolute; top:-13px; left:50%; transform:translateX(-50%); padding:7px 14px; border-radius:999px; color:#fff; font-size:10px; font-weight:900; white-space:nowrap; letter-spacing:.5px; }
      .green-popular-label { background:linear-gradient(90deg,#16a34a,#22c55e); box-shadow:0 8px 24px rgba(34,197,94,.28); }
      .plan-top { display:flex; justify-content:space-between; align-items:center; gap:10px; }
      .plan-icon { width:52px; height:52px; display:grid; place-items:center; border-radius:16px; font-size:25px; border:1px solid rgba(255,255,255,.08); }
      .green-icon { background:rgba(34,197,94,.12); box-shadow:0 0 25px rgba(34,197,94,.08); }
      .orange-icon { background:rgba(255,138,0,.12); box-shadow:0 0 25px rgba(255,138,0,.08); }
      .plan-badge { padding:6px 9px; border-radius:999px; background:rgba(255,255,255,.07); color:#c9d8ef; font-size:9px; font-weight:900; letter-spacing:.4px; }
      .plan-badge.free,.green-plan-badge { color:#72f4a0; background:rgba(34,197,94,.11); }
      .orange-badge { color:#ffb35a; background:rgba(255,138,0,.11); }
      .subscription-card h2 { margin:20px 0 8px; font-size:20px; }
      .plan-description { min-height:66px; opacity:.72; line-height:1.5; }
      .plan-price { display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-height:64px; margin-top:8px; }
      .plan-price strong { font-size:28px; line-height:1; }
      .plan-price span { opacity:.62; font-size:11px; }
      .plan-credit-box { display:flex; align-items:center; gap:10px; margin-top:12px; padding:11px 12px; border-radius:14px; background:rgba(34,197,94,.07); border:1px solid rgba(34,197,94,.16); color:#bfe8cf; font-size:11px; font-weight:700; }
      .orange-credit-box { background:rgba(255,138,0,.07); border-color:rgba(255,138,0,.16); color:#f4d0a8; }
      .green-credit-box { background:rgba(34,197,94,.10); border-color:rgba(34,197,94,.24); color:#bff5d0; }
      .credit-number { font-size:17px; font-weight:900; color:#fff; }
      .plan-divider { height:1px; margin:17px 0 18px; background:rgba(255,255,255,.09); }
      .plan-features { flex:1; display:grid; gap:12px; list-style:none; padding:0; margin:0; }
      .plan-features li { font-size:13px; line-height:1.4; color:#d0daeb; }
      .plan-button { width:100%; margin-top:22px; border-radius:13px !important; }
      .green-button { background:linear-gradient(135deg,#22c55e,#16a34a) !important; color:#03120a !important; box-shadow:0 0 24px rgba(34,197,94,.20); }
      .orange-button { background:linear-gradient(135deg,#ff9d24,#ff7a00) !important; color:#160b01 !important; box-shadow:0 0 24px rgba(255,138,0,.20); }
      .plan-note { margin-top:11px; text-align:center; opacity:.5; line-height:1.35; }
      .subscription-footer { display:flex; flex-wrap:wrap; justify-content:center; gap:18px; margin-top:22px; padding:14px; border-radius:15px; background:rgba(255,255,255,.03); font-size:12px; opacity:.7; border:1px solid rgba(255,255,255,.05); }
      @media (max-width:1250px) { .subscription-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
      @media (max-width:720px) { .subscription-grid { grid-template-columns:1fr; } .subscription-card { min-height:auto; } }
      .home-demo-banner {
        display:flex;
        align-items:center;
        gap:18px;
        margin:0 0 22px;
        padding:20px;
        border:1px solid rgba(124,92,255,.28);
        border-radius:22px;
        background:linear-gradient(110deg,rgba(124,92,255,.13),rgba(70,45,140,.06));
      }

      .home-demo-icon {
        width:58px;
        height:58px;
        display:grid;
        place-items:center;
        flex:none;
        border-radius:17px;
        background:rgba(124,92,255,.16);
        font-size:28px;
      }

      .home-demo-copy {
        flex:1;
      }

      .demo-kicker {
        font-size:10px;
        font-weight:800;
        letter-spacing:.12em;
        color:#a78bfa;
      }

      .home-demo-copy h2 {
        margin:5px 0;
        font-size:20px;
      }

      .home-demo-copy p {
        margin:0;
        opacity:.7;
        line-height:1.45;
      }

      .assigned-demo-banner {
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
        margin:0 0 22px;
        padding:18px 20px;
        border:1px solid rgba(34,197,94,.22);
        border-radius:18px;
        background:rgba(34,197,94,.06);
      }

      .assigned-demo-banner h3 {
        margin:5px 0 3px;
      }

      .assigned-demo-banner p {
        margin:0;
        opacity:.65;
      }

      .assigned-demo-actions {
        display:flex;
        gap:10px;
      }

      .radius-box {
        display:grid;
        gap:4px;
        margin:4px 0 20px;
        padding:14px;
        border-radius:14px;
        background:rgba(124,92,255,.08);
        border:1px solid rgba(124,92,255,.16);
      }

      .radius-box strong {
        color:#cfc5ff;
        font-size:12px;
      }

      .radius-box span {
        font-size:12px;
        opacity:.65;
      }

      .demo-modal {
        max-width:650px;
      }

      .online-tutor-section {
        margin: 0 0 24px;
      }

      .online-section-heading {
        display:flex;
        align-items:flex-end;
        justify-content:space-between;
        gap:18px;
        margin-bottom:15px;
      }

      .online-section-heading h2 {
        margin:5px 0;
        font-size:21px;
      }

      .online-section-heading p {
        margin:0;
        opacity:.62;
        font-size:13px;
      }

      .access-badge,
      .locked-badge {
        white-space:nowrap;
        padding:8px 11px;
        border-radius:999px;
        font-size:11px;
        font-weight:800;
      }

      .access-badge {
        color:#86efac;
        background:rgba(34,197,94,.1);
      }

      .locked-badge {
        color:#fbbf24;
        background:rgba(245,158,11,.1);
      }

      .online-locked-card {
        display:flex;
        align-items:center;
        gap:16px;
        padding:20px;
        border:1px dashed rgba(245,158,11,.3);
        border-radius:18px;
        background:rgba(245,158,11,.045);
      }

      .locked-icon {
        width:48px;
        height:48px;
        display:grid;
        place-items:center;
        flex:none;
        border-radius:14px;
        background:rgba(245,158,11,.1);
        font-size:22px;
      }

      .online-locked-card h3 {
        margin:0 0 4px;
      }

      .online-locked-card p {
        margin:0;
        opacity:.62;
        line-height:1.45;
        font-size:13px;
      }

      .online-filters {
        margin-bottom:14px;
      }

      .online-filters select {
        min-width:190px;
        padding:11px 13px;
        border:1px solid rgba(255,255,255,.09);
        border-radius:12px;
        background:#111024;
        color:white;
        outline:none;
      }

      .online-tutor-grid {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:15px;
      }

      .online-tutor-card {
        padding:19px;
        border:1px solid rgba(124,92,255,.18);
        border-radius:18px;
        background:rgba(255,255,255,.035);
      }

      .online-tutor-top {
        display:flex;
        align-items:center;
        gap:12px;
      }

      .online-tutor-avatar {
        width:48px;
        height:48px;
        display:grid;
        place-items:center;
        flex:none;
        border-radius:14px;
        background:linear-gradient(135deg,#6d3df0,#8b5cf6);
        color:white;
        font-weight:800;
        font-size:19px;
      }

      .online-tutor-top h3 {
        margin:0 0 3px;
      }

      .online-tutor-top p {
        margin:0;
        opacity:.6;
        font-size:12px;
      }

      .online-tutor-top .verified {
        margin-left:auto;
      }

      .online-tutor-meta {
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        margin:15px 0;
      }

      .online-tutor-meta span {
        padding:6px 9px;
        border-radius:999px;
        background:rgba(255,255,255,.05);
        font-size:11px;
        opacity:.75;
      }

      .online-tutor-card .primary-button {
        width:100%;
      }

      .booking-overlay { position:fixed; inset:0; z-index:1000; display:grid; place-items:center; padding:20px; background:rgba(4,4,15,.75); backdrop-filter:blur(8px); }
      .booking-modal { width:min(620px,100%); max-height:92vh; overflow:auto; padding:28px; border:1px solid rgba(124,92,255,.4); border-radius:24px; background:#121126; color:#f7f5ff; box-shadow:0 30px 100px rgba(0,0,0,.5); }
      .booking-header { display:flex; justify-content:space-between; gap:20px; margin-bottom:24px; }
      .booking-kicker { font-size:10px; font-weight:800; letter-spacing:.12em; color:#a78bfa; }
      .booking-header h2 { margin:7px 0 5px; }
      .booking-header p { margin:0; opacity:.65; }
      .booking-close { width:38px; height:38px; border:0; border-radius:12px; background:rgba(255,255,255,.07); color:white; font-size:25px; cursor:pointer; }
      .booking-grid { display:grid; grid-template-columns:1fr 1fr; gap:15px; }
      .booking-modal label { display:grid; gap:8px; margin-bottom:16px; font-size:13px; }
      .booking-modal label span { font-weight:700; }
      .booking-modal input, .booking-modal select, .booking-modal textarea { width:100%; box-sizing:border-box; padding:12px 13px; border:1px solid rgba(255,255,255,.1); border-radius:12px; outline:none; background:#0d0c1d; color:white; font:inherit; }
      .booking-modal textarea { resize:vertical; }
      .booking-summary { display:flex; flex-wrap:wrap; gap:10px; margin:4px 0 20px; font-size:12px; opacity:.72; }
      .booking-summary span { padding:7px 10px; border-radius:999px; background:rgba(255,255,255,.06); }
      .booking-actions { display:flex; justify-content:flex-end; gap:12px; }
      .session-list { display:grid; gap:15px; }
      .session-card { display:flex; align-items:center; justify-content:space-between; gap:18px; padding:20px; border:1px solid rgba(124,92,255,.18); border-radius:18px; background:rgba(255,255,255,.035); }
      .session-card-main { display:flex; align-items:center; gap:15px; }
      .session-avatar { width:48px; height:48px; display:grid; place-items:center; border-radius:14px; background:linear-gradient(135deg,#6d3df0,#8b5cf6); color:white; font-weight:800; font-size:20px; }
      .session-card h3 { margin:0 0 4px; }
      .session-card p { margin:3px 0; opacity:.7; }
      .session-card small { opacity:.55; }
      .session-confirmed { white-space:nowrap; padding:8px 11px; border-radius:999px; background:rgba(34,197,94,.1); color:#86efac; font-size:12px; font-weight:700; }
      @media (max-width:760px) {
        .online-tutor-grid {
          grid-template-columns:1fr;
        }

        .online-locked-card {
          align-items:flex-start;
          flex-direction:column;
        }

      @media (max-width:760px) {
        .home-demo-banner,
        .assigned-demo-banner {
          align-items:flex-start;
          flex-direction:column;
        }

        .assigned-demo-actions {
          width:100%;
        }

        .assigned-demo-actions button {
          flex:1;
        }
      }

      @media (max-width:1000px) { .subscription-grid { grid-template-columns:1fr; } .subscription-card { min-height:auto; } }
    `}</style>
  );
}

/* =====================================================
   TUTOR CARD
===================================================== */

function OnlineTutorCard({
  tutor,
  onBook,
}) {
  return (
    <div className="online-tutor-card">

      <div className="online-tutor-top">
        <div className="online-tutor-avatar">
          {tutor.name.charAt(0)}
        </div>

        <div>
          <h3>{tutor.name}</h3>
          <p>{tutor.subject} • {tutor.experience} experience</p>
        </div>

        <span className="verified">✓</span>
      </div>

      <div className="online-tutor-meta">
        <span>⭐ {tutor.rating}</span>
        <span>💻 Live Online</span>
        <span>✓ Verified</span>
      </div>

      <button
        className="primary-button"
        type="button"
        onClick={onBook}
      >
        View & Book →
      </button>

    </div>
  );
}

function HomeDemoModal({
  form,
  setForm,
  onClose,
  onSubmit,
}) {
  return (
    <div
      className="booking-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="booking-modal demo-modal">

        <div className="booking-header">
          <div>
            <span className="booking-kicker">LATHSO HOME TUTOR</span>
            <h2>Request Free Demo 🏠</h2>
            <p>We'll find a suitable verified tutor within 10 km.</p>
          </div>

          <button
            className="booking-close"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit}>

          <div className="booking-grid">

            <label>
              <span>📚 Subject</span>

              <select
                value={form.subject}
                onChange={(event) =>
                  setForm({
                    ...form,
                    subject: event.target.value,
                  })
                }
              >
                <option>Mathematics</option>
                <option>Physics</option>
                <option>Chemistry</option>
                <option>Biology</option>
              </select>
            </label>

            <label>
              <span>🎓 Class</span>

              <select
                value={form.classLevel}
                onChange={(event) =>
                  setForm({
                    ...form,
                    classLevel: event.target.value,
                  })
                }
              >
                <option>Class 8</option>
                <option>Class 9</option>
                <option>Class 10</option>
                <option>Class 11</option>
                <option>Class 12</option>
                <option>JEE</option>
                <option>NEET</option>
              </select>
            </label>

          </div>

          <label>
            <span>📍 Area / Location</span>

            <input
              value={form.location}
              onChange={(event) =>
                setForm({
                  ...form,
                  location: event.target.value,
                })
              }
              placeholder="Example: RK Valley"
            />
          </label>

          <label>
            <span>🏠 Home Address</span>

            <textarea
              rows="3"
              value={form.address}
              onChange={(event) =>
                setForm({
                  ...form,
                  address: event.target.value,
                })
              }
              placeholder="Enter address for the free demo"
            />
          </label>

          <div className="radius-box">
            <strong>📍 10 KM TUTOR MATCHING</strong>
            <span>
              Lathso will find a suitable verified tutor near your location.
            </span>
          </div>

          <div className="booking-actions">

            <button
              type="button"
              className="secondary-button"
              onClick={onClose}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="primary-button"
            >
              Find My Tutor →
            </button>

          </div>

        </form>
      </div>
    </div>
  );
}

function TutorCard({
  name,
  subject,
  location,
  mode,
  onBook,
}) {
  return (
    <div className="tutor-card">
      <div className="tutor-top">
        <div className="tutor-avatar">{name.charAt(0)}</div>
        <div>
          <h3>{name}</h3>
          <p>{subject}</p>
        </div>
        <span className="verified">✓</span>
      </div>

      <div className="tutor-details">
        <span>📍 {location}</span>
        <span>⭐ 4.8 Rating</span>
        <span>🎓 Qualification Verified</span>
      </div>

      <div className="tutor-tags">
        <span>{mode}</span>
        <span>Flexible Fee</span>
      </div>

      <div className="tutor-footer">
        <strong>Available</strong>
        <button
          className="primary-button small"
          onClick={onBook}
          type="button"
        >
          View & Book
        </button>
      </div>
    </div>
  );
}

/* =====================================================
   BOOKING MODAL
===================================================== */

function BookingModal({
  tutor,
  onClose,
  onConfirm,
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [mode, setMode] = useState(
    tutor.mode.includes("Home") ? "Home" : "Online"
  );
  const [note, setNote] = useState("");

  function submit(event) {
    event.preventDefault();

    if (!date || !time) {
      alert("Please select a date and time.");
      return;
    }

    onConfirm({ date, time, mode, note });
  }

  return (
    <div
      className="booking-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="booking-modal">
        <div className="booking-header">
          <div>
            <span className="booking-kicker">LATHSO BOOKING</span>
            <h2>Book with {tutor.name}</h2>
            <p>{tutor.subject} • {tutor.location}</p>
          </div>

          <button
            className="booking-close"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="booking-grid">
            <label>
              <span>📅 Date</span>
              <input
                type="date"
                min={new Date().toISOString().split("T")[0]}
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>

            <label>
              <span>⏰ Time</span>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>

          <label>
            <span>Learning Mode</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              {tutor.mode.includes("Home") && (
                <option value="Home">🏠 Home Tutor</option>
              )}
              {tutor.mode.includes("Online") && (
                <option value="Online">💻 Online Session</option>
              )}
            </select>
          </label>

          <label>
            <span>Message to Tutor (optional)</span>
            <textarea
              rows="3"
              placeholder="Tell the tutor what you want to learn..."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          <div className="booking-summary">
            <span>✓ Verified Tutor</span>
            <span>🔒 Lathso Booking</span>
          </div>

          <div className="booking-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Confirm Booking →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



/* =====================================================
   PARENT DASHBOARD
===================================================== */

function ParentDashboard({ onLogout }) {
  const [child, setChild] = useState(null);
  const [childLoading, setChildLoading] = useState(true);
  const [childError, setChildError] = useState("");
  const [childSessions, setChildSessions] = useState([]);
  const [childSubscription, setChildSubscription] = useState(null);
  const [showChild, setShowChild] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const parent = auth.currentUser;
    const parentEmail = String(parent?.email || "").trim().toLowerCase();

    if (!parent || !parentEmail) {
      setChild(null);
      setChildLoading(false);
      setChildError("Please login again with your Parent account.");
      return undefined;
    }

    setChildLoading(true);
    setChildError("");

    const childQuery = query(
      collection(db, "users"),
      where("role", "==", "student"),
      where("parentEmail", "==", parentEmail)
    );

    const unsubscribe = onSnapshot(
      childQuery,
      (snapshot) => {
        if (cancelled) return;

        const students = snapshot.docs
          .map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() }))
          .sort((a, b) => {
            const aTime = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
            const bTime = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });

        setChild(students[0] || null);
        setChildLoading(false);
        setChildError("");
      },
      (error) => {
        console.error("Parent child listener error:", error);
        if (!cancelled) {
          setChild(null);
          setChildLoading(false);
          setChildError(
            error?.code === "permission-denied"
              ? "Parent access is blocked by Firestore Rules. Publish the parent connection rules."
              : "Could not load the connected student. Please try again."
          );
        }
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [auth.currentUser?.uid]);

  useEffect(() => {
    if (!child?.id) {
      setChildSessions([]);
      setChildSubscription(null);
      return undefined;
    }

    let cancelled = false;
    const sessionsQuery = query(
      collection(db, "sessions"),
      where("studentId", "==", child.id)
    );

    const unsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        if (cancelled) return;
        const loaded = snapshot.docs
          .map((sessionDoc) => ({ id: sessionDoc.id, ...sessionDoc.data() }))
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });
        setChildSessions(loaded);
      },
      (error) => {
        console.error("Parent child sessions error:", error);
        if (!cancelled) setChildSessions([]);
      }
    );

    getDoc(doc(db, "subscriptions", child.id))
      .then((subscriptionSnap) => {
        if (!cancelled) setChildSubscription(subscriptionSnap.exists() ? subscriptionSnap.data() : null);
      })
      .catch((error) => {
        console.error("Parent subscription load error:", error);
        if (!cancelled) setChildSubscription(null);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [child?.id]);

  const completedSessions = childSessions.filter((session) => session.status === "Completed").length;
  const totalTrackableSessions = childSessions.filter((session) => session.status !== "Cancelled").length;
  const progressPercent = totalTrackableSessions > 0
    ? Math.min(100, Math.round((completedSessions / totalTrackableSessions) * 100))
    : 0;

  const activeSessions = childSessions.filter((session) =>
    ["Confirmed", "Tutor Assigned", "Accepted", "Offline Session Confirmed & Active", "Demo Requested"].includes(session.status)
  );

  const upcomingSessions = activeSessions.length;
  const tutorSession = childSessions.find((session) => session.tutorId && [
    "Confirmed", "Tutor Assigned", "Accepted", "Offline Session Confirmed & Active"
  ].includes(session.status));

  const tutorName = tutorSession?.tutorName || "No Tutor Assigned";
  const tutorSubject = tutorSession?.subject || "Tutor information will appear after assignment.";
  const nextSession = activeSessions[0] || null;

  const subjects = Array.isArray(child?.subjects) && child.subjects.length
    ? child.subjects
    : [...new Set(childSessions.map((session) => session.subject).filter(Boolean))];

  return (
    <>
      <style>{ROLE_DASHBOARD_CSS}</style>
      <style>{`\
        .parent-connection-note{margin:0 0 16px;padding:12px 14px;border:1px solid rgba(124,92,255,.18);border-radius:13px;background:rgba(124,92,255,.07);color:#aaa4b8;font-size:10px;line-height:1.6}\
        .parent-connection-note strong{color:#fff}\
        .parent-linked-email{color:#a78bfa}\
        .parent-loading-box{padding:28px;text-align:center;color:#817b8e}\
        .parent-error-box{padding:14px;border:1px solid rgba(239,68,68,.18);border-radius:13px;background:rgba(239,68,68,.07);color:#fecaca;font-size:11px}\
        .parent-empty-box{padding:26px;border:1px dashed rgba(255,255,255,.10);border-radius:15px;text-align:center;color:#817b8e;font-size:11px;line-height:1.6}\
        .parent-empty-box strong{display:block;color:#fff;margin-bottom:5px;font-size:13px}\
        .parent-session-list{display:grid;gap:8px;margin-top:12px}\
        .parent-session-mini{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06)}\
        .parent-session-mini strong{display:block;font-size:11px}.parent-session-mini span{display:block;margin-top:3px;color:#817b8e;font-size:9px}\
        .parent-session-status{padding:5px 8px;border-radius:999px;background:rgba(124,92,255,.10);color:#cfc5ff;font-size:8px;font-weight:800;white-space:nowrap}\
        .parent-subject-empty{padding:18px;border-radius:13px;background:rgba(255,255,255,.025);color:#817b8e;font-size:10px}\
        .parent-link-field{display:grid;gap:7px}\
        .parent-link-field small{color:#777286;font-size:9px;line-height:1.55}\
        @media(max-width:760px){.parent-session-mini{align-items:flex-start;flex-direction:column}.parent-session-status{align-self:flex-start}}\
      `}</style>
      <div className="role-dashboard">
        <aside className="role-sidebar">
          <Logo />
          <div className="role-account">
            <div className="role-avatar">👨‍👩‍👧</div>
            <div>
              <strong>Parent Account</strong>
              <small>{auth.currentUser?.email || "Lathso V1.0"}</small>
            </div>
          </div>

          <nav>
            <button className="role-nav active">⌂ Dashboard</button>
            <button className="role-nav" type="button" onClick={() => setShowChild((value) => !value)}>👦 My Child</button>
            <button className="role-nav" type="button">👨‍🏫 Tutor</button>
            <button className="role-nav" type="button">📅 Sessions</button>
            <button className="role-nav" type="button">💎 Subscription</button>
          </nav>

          <button className="role-logout" onClick={onLogout}>↪ Logout</button>
        </aside>

        <main className="role-main">
          <div className="role-header">
            <div>
              <span className="role-kicker">PARENT PORTAL</span>
              <h1>Parent Dashboard 👋</h1>
              <p>Stay connected with your child's learning journey.</p>
            </div>
            <div className="role-status">{child ? "🟢 Student Connected" : "🟡 Waiting for Student"}</div>
          </div>

          {childError && <div className="parent-error-box" style={{ marginBottom: 16 }}>{childError}</div>}

          {childLoading ? (
            <div className="role-panel parent-loading-box">⏳ Connecting to your student's Lathso dashboard...</div>
          ) : !child ? (
            <div className="role-panel">
              <div className="parent-empty-box">
                <strong>👦 No Student Connected Yet</strong>
                Ask your child to open <b>Profile → Parent / Guardian Email</b>, enter this Parent account email, and save the profile. The connection will appear here automatically.
              </div>
            </div>
          ) : (
            <>
              <div className="parent-connection-note">
                <strong>✓ Live Parent–Student Connection</strong><br />
                This dashboard is connected to <span className="parent-linked-email">{child.fullName || "Student"}</span>. Student profile, sessions, tutor assignment and subscription status are read from Firestore in real time.
              </div>

              <div className="role-stats">
                <div><span>Overall Progress</span><strong>{progressPercent}%</strong><small>{completedSessions} of {totalTrackableSessions} sessions completed</small></div>
                <div><span>Assigned Tutor</span><strong>{tutorSession ? "1" : "—"}</strong><small>{tutorSession ? tutorName : "No tutor assigned"}</small></div>
                <div><span>Upcoming Sessions</span><strong>{upcomingSessions}</strong><small>Live Firestore data</small></div>
                <div><span>Online Access</span><strong>{childSubscription?.active ? "Active" : "—"}</strong><small>{childSubscription?.planName || "Subscription not selected"}</small></div>
              </div>

              <div className="role-grid-2">
                <div className="role-panel">
                  <div className="role-panel-title">
                    <div>
                      <span className="role-kicker">MY CHILD</span>
                      <h2>{child.fullName || "Student"}</h2>
                      <p>{child.classLevel || "Class not added"} • {child.email || "No email"}</p>
                    </div>
                    <button className="role-secondary" type="button" onClick={() => setShowChild(!showChild)}>
                      {showChild ? "Hide Details" : "View Profile"}
                    </button>
                  </div>
                  {showChild && (
                    <div className="role-detail-box">
                      <span>📚 Subjects: {subjects.length ? subjects.join(", ") : "Not added"}</span>
                      <span>📞 Phone: {child.phone || "Not added"}</span>
                      <span>📍 Location: {child.location || "Not added"}</span>
                      <span>🏠 Address: {child.address || "Not added"}</span>
                    </div>
                  )}
                  <div className="role-progress-row">
                    <div><span>Learning Progress</span><strong>{progressPercent}%</strong></div>
                    <div className="role-bar"><i style={{ width: `${progressPercent}%` }} /></div>
                  </div>
                </div>

                <div className="role-panel">
                  <span className="role-kicker">ASSIGNED TUTOR</span>
                  <h2>{tutorName}</h2>
                  <p>{tutorSubject}</p>
                  {tutorSession ? (
                    <div className="role-tutor-meta">✓ Linked through your child's live session</div>
                  ) : (
                    <div className="role-tutor-meta">No active tutor data</div>
                  )}
                  <button className="role-primary" type="button" disabled={!tutorSession}>View Tutor →</button>
                </div>
              </div>

              <div className="role-panel">
                <div className="role-panel-title">
                  <div><h2>Learning Progress</h2><p>Subject-wise activity from your child's live sessions.</p></div>
                  <span className="role-badge">Live</span>
                </div>
                <div className="subject-grid">
                  {subjects.length ? subjects.map((subject) => {
                    const subjectSessions = childSessions.filter((session) => session.subject === subject && session.status !== "Cancelled");
                    const subjectCompleted = subjectSessions.filter((session) => session.status === "Completed").length;
                    const percent = subjectSessions.length ? Math.round((subjectCompleted / subjectSessions.length) * 100) : 0;
                    return (
                      <div className="subject-progress" key={subject}>
                        <div><span>{subject}</span><strong>{percent}%</strong></div>
                        <div className="role-bar"><i style={{ width: `${percent}%` }} /></div>
                      </div>
                    );
                  }) : <div className="parent-subject-empty">No subjects added by the student yet.</div>}
                </div>
              </div>

              <div className="role-panel">
                <span className="role-kicker">UPCOMING</span>
                <h2>Next Session</h2>
                {nextSession ? (
                  <div className="role-session">
                    <div className="role-avatar">📅</div>
                    <div>
                      <strong>{nextSession.subject || "Learning Session"}</strong>
                      <p>{nextSession.date || "Date to be scheduled"} • {nextSession.time || "Time to be scheduled"}</p>
                      <p>{nextSession.tutorName ? `👨‍🏫 ${nextSession.tutorName}` : "Tutor assignment pending"}</p>
                    </div>
                    <span className="role-badge">{nextSession.status || "Pending"}</span>
                  </div>
                ) : (
                  <div className="parent-empty-box">
                    <strong>No upcoming session</strong>
                    New confirmed student sessions will appear here automatically.
                  </div>
                )}
              </div>

              <div className="role-panel">
                <div className="role-panel-title">
                  <div><h2>Recent Sessions</h2><p>Live session history from your child.</p></div>
                  <span className="role-badge">{childSessions.length} total</span>
                </div>
                <div className="parent-session-list">
                  {childSessions.slice(0, 5).map((session) => (
                    <div className="parent-session-mini" key={session.id}>
                      <div>
                        <strong>{session.subject || "Learning Session"}</strong>
                        <span>{session.date || "Date not set"} • {session.tutorName || "Tutor pending"}</span>
                      </div>
                      <span className="parent-session-status">{session.status || "Pending"}</span>
                    </div>
                  ))}
                  {!childSessions.length && <div className="parent-subject-empty">No sessions found for this student yet.</div>}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}


/* =====================================================
   TUTOR VERIFICATION APPLICATION
   Firebase-only: no document/video uploads.
===================================================== */

function TvField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TutorVerificationApplication({
  onBack,
  onSubmitted,
  initialApplication = null,
  tutorProfile = null,
}) {
  const [user, setUser] = useState(() => auth.currentUser);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const getValue = (...values) => {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
    return "";
  };

  const [form, setForm] = useState(() => ({
    name: getValue(
      initialApplication?.name,
      initialApplication?.fullName,
      tutorProfile?.name,
      tutorProfile?.fullName,
      user?.displayName
    ),
    email: getValue(
      initialApplication?.email,
      tutorProfile?.email,
      user?.email
    ),
    phone: getValue(
      initialApplication?.phone,
      tutorProfile?.phone
    ),
    subject: getValue(
      initialApplication?.subject,
      tutorProfile?.subject,
      "Mathematics"
    ),
    qualification: getValue(
      initialApplication?.qualification,
      initialApplication?.education,
      tutorProfile?.qualification,
      tutorProfile?.education
    ),
    experience: String(
      getValue(
        initialApplication?.experience,
        tutorProfile?.experience
      )
    ).replace(/\s*(Years?|yrs?)\s*$/i, ""),
    location: getValue(
      initialApplication?.location,
      initialApplication?.city,
      tutorProfile?.location,
      tutorProfile?.city
    ),
    classes: getValue(
      initialApplication?.classes,
      initialApplication?.classLevel,
      tutorProfile?.classes,
      tutorProfile?.classLevel,
      "Class 8 - 10"
    ),
  }));

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  // Hydrate this screen only from the current Firebase UID's Firestore data.
  useEffect(() => {
    if (!initialApplication && !tutorProfile && !user) return;

    setForm((prev) => ({
      ...prev,
      name: getValue(
        initialApplication?.name,
        initialApplication?.fullName,
        tutorProfile?.name,
        tutorProfile?.fullName,
        user?.displayName,
        prev.name
      ),
      email: getValue(
        initialApplication?.email,
        tutorProfile?.email,
        user?.email,
        prev.email
      ),
      phone: getValue(
        initialApplication?.phone,
        tutorProfile?.phone,
        prev.phone
      ),
      subject: getValue(
        initialApplication?.subject,
        tutorProfile?.subject,
        prev.subject,
        "Mathematics"
      ),
      qualification: getValue(
        initialApplication?.qualification,
        initialApplication?.education,
        tutorProfile?.qualification,
        tutorProfile?.education,
        prev.qualification
      ),
      experience: String(
        getValue(
          initialApplication?.experience,
          tutorProfile?.experience,
          prev.experience
        )
      ).replace(/\s*(Years?|yrs?)\s*$/i, ""),
      location: getValue(
        initialApplication?.location,
        initialApplication?.city,
        tutorProfile?.location,
        tutorProfile?.city,
        prev.location
      ),
      classes: getValue(
        initialApplication?.classes,
        initialApplication?.classLevel,
        tutorProfile?.classes,
        tutorProfile?.classLevel,
        prev.classes,
        "Class 8 - 10"
      ),
    }));
  }, [initialApplication, tutorProfile, user?.displayName, user?.email]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrorMessage("");
  }

  async function submitApplication(event) {
    event.preventDefault();
    if (submitting) return;

    setErrorMessage("");

    const currentUser = auth.currentUser || user;
    if (!currentUser) {
      setErrorMessage("Your login session has expired. Please log in again.");
      return;
    }

    const requiredFields = [
      ["name", "Full name"],
      ["email", "Email"],
      ["phone", "Phone"],
      ["qualification", "Highest qualification"],
      ["experience", "Teaching experience"],
      ["location", "City / Location"],
      ["subject", "Subject"],
      ["classes", "Classes"],
    ];

    const missingField = requiredFields.find(
      ([field]) => !String(form[field] || "").trim()
    );

    if (missingField) {
      setErrorMessage(`Please enter your ${missingField[1].toLowerCase()}.`);
      return;
    }

    try {
      setSubmitting(true);

      // One application per tutor account. Existing applications are updated;
      // a new tutor UID always gets a completely separate Firestore document.
      let applicationRef;

      if (initialApplication?.id && initialApplication.tutorId === currentUser.uid) {
        applicationRef = doc(db, "tutorApplications", initialApplication.id);
      } else {
        const existingSnapshot = await getDocs(
          query(
            collection(db, "tutorApplications"),
            where("tutorId", "==", currentUser.uid)
          )
        );

        if (!existingSnapshot.empty) {
          const latest = existingSnapshot.docs
            .map((item) => ({ id: item.id, ...item.data() }))
            .sort((a, b) => {
              const time = (value) => {
                if (!value) return 0;
                if (typeof value.toMillis === "function") return value.toMillis();
                if (typeof value === "string") return new Date(value).getTime() || 0;
                return 0;
              };
              return Math.max(time(b.updatedAt), time(b.submittedAt)) -
                Math.max(time(a.updatedAt), time(a.submittedAt));
            })[0];
          applicationRef = doc(db, "tutorApplications", latest.id);
        } else {
          applicationRef = doc(collection(db, "tutorApplications"));
        }
      }

      const applicationId = applicationRef.id;
      const applicationData = {
        tutorId: currentUser.uid,
        name: form.name.trim(),
        fullName: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        subject: form.subject,
        qualification: form.qualification.trim(),
        education: form.qualification.trim(),
        experience: `${form.experience.trim()} Years`,
        location: form.location.trim(),
        classes: form.classes,
        // Admin performs verification by phone/manual review.
        verificationMethod: "Admin Phone Verification",
        verificationDetails: "Admin team will call the tutor and verify the details.",
        status: "Pending",
        rejectionReason: "",
        updatedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      };

      await setDoc(applicationRef, applicationData, { merge: true });

      // Keep the tutor's profile synchronized with the same Firebase UID.
      await setDoc(
        doc(db, "users", currentUser.uid),
        {
          fullName: applicationData.fullName,
          email: applicationData.email,
          phone: applicationData.phone,
          role: "tutor",
          subject: applicationData.subject,
          education: applicationData.education,
          qualification: applicationData.qualification,
          experience: applicationData.experience,
          location: applicationData.location,
          classes: applicationData.classes,
          verified: false,
          available: false,
          verificationStatus: "Pending",
          latestTutorApplicationId: applicationId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const localApplication = {
        ...applicationData,
        id: applicationId,
        tutorId: currentUser.uid,
        status: "Pending",
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setSubmitted(true);
      if (onSubmitted) onSubmitted(localApplication);
    } catch (error) {
      console.error("Tutor verification submit error:", error);
      setErrorMessage(error?.message || "Could not submit verification application.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <section className="tutor-verification-page">
        <div className="tv-success">
          <div className="tv-success-icon">✓</div>
          <span className="tv-kicker">APPLICATION SUBMITTED</span>
          <h1>Verification request sent 🎉</h1>
          <p>
            Your details have been sent to the Lathso Admin team. They will
            call you, verify your information, and update your verification status.
          </p>

          <div className="tv-success-grid">
            <div>
              <span>Status</span>
              <strong>⏳ Pending Admin Verification</strong>
            </div>
            <div>
              <span>Verification</span>
              <strong>Admin Phone Verification</strong>
            </div>
          </div>

          <button className="role-primary" type="button" onClick={onBack}>
            ← Back to Tutor Dashboard
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="tutor-verification-page">
      <div className="tv-top">
        <div>
          <span className="tv-kicker">BECOME A VERIFIED TUTOR</span>
          <h1>
            {initialApplication
              ? "Review Your Verification 👨‍🏫"
              : "Tutor Verification 👨‍🏫"}
          </h1>
          <p>
            Submit your teaching and contact details. No documents or videos are
            required. Our Admin team will call you and verify the details manually.
          </p>
        </div>

        <button className="role-secondary" type="button" onClick={onBack}>
          ← Back
        </button>
      </div>

      {initialApplication && (
        <div className="tv-existing-status">
          <span>APPLICATION STATUS</span>
          <strong>{initialApplication.status || "Pending"}</strong>
          <small>
            {initialApplication.status === "Rejected"
              ? "Please review your details and resubmit."
              : "Your application is saved. You can update and resubmit if required."}
          </small>
        </div>
      )}

      {errorMessage && <div className="tv-error">⚠️ {errorMessage}</div>}

      <form className="tv-form" onSubmit={submitApplication}>
        <div className="tv-card">
          <div className="tv-card-title">
            <b>01</b>
            <div>
              <h2>Personal & Teaching Profile</h2>
              <p>Basic details used for tutor verification.</p>
            </div>
          </div>

          <div className="tv-grid">
            <TvField label="Full Name *" value={form.name} onChange={(v) => update("name", v)} placeholder="Your full name" />
            <TvField label="Email *" type="email" value={form.email} onChange={(v) => update("email", v)} placeholder="you@example.com" />
            <TvField label="Phone *" type="tel" value={form.phone} onChange={(v) => update("phone", v)} placeholder="9876543210" />
            <TvField label="Highest Qualification *" value={form.qualification} onChange={(v) => update("qualification", v)} placeholder="M.Sc / B.Tech / B.Ed..." />
            <TvField label="Teaching Experience (Years) *" type="number" value={form.experience} onChange={(v) => update("experience", v)} placeholder="5" />
            <TvField label="City / Location *" value={form.location} onChange={(v) => update("location", v)} placeholder="Nellore" />

            <label>
              Subject *
              <select value={form.subject} onChange={(e) => update("subject", e.target.value)}>
                <option>Mathematics</option>
                <option>Physics</option>
                <option>Chemistry</option>
                <option>Biology</option>
                <option>English</option>
                <option>Computer Science</option>
              </select>
            </label>

            <label>
              Classes *
              <select value={form.classes} onChange={(e) => update("classes", e.target.value)}>
                <option>Class 6 - 8</option>
                <option>Class 8 - 10</option>
                <option>Class 10 - 12</option>
                <option>JEE</option>
                <option>NEET</option>
                <option>JEE + NEET</option>
              </select>
            </label>
          </div>
        </div>

        <div className="tv-card">
          <div className="tv-card-title">
            <b>02</b>
            <div>
              <h2>Admin Verification</h2>
              <p>No document upload is required.</p>
            </div>
          </div>

          <div className="tv-info-box">
            📞 <strong>Manual Phone Verification</strong>
            <span>
              After you submit, the Lathso Admin team will call you, verify your
              identity and teaching details, and then approve or reject the application.
            </span>
          </div>
        </div>

        <div className="tv-submit-row">
          <div>
            <strong>{initialApplication ? "Update your application?" : "Ready to submit?"}</strong>
            <span>Admin will call and verify your details before approval.</span>
          </div>
          <button className="role-primary" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : initialApplication ? "Update & Submit" : "Submit for Verification"}
          </button>
        </div>
      </form>
    </section>
  );
}


/* =====================================================
   TUTOR DASHBOARD
===================================================== */

function TutorDashboard({ onLogout }) {
  const [availability, setAvailability] = useState(false);
  const [showTutorVerification, setShowTutorVerification] = useState(false);
  const [tutorProfile, setTutorProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [students, setStudents] = useState([]);
  const [tutorError, setTutorError] = useState("");
  const [requestLoading, setRequestLoading] = useState(false);
  const [latestTutorApplication, setLatestTutorApplication] = useState(null);
  const [activeTutorPage, setActiveTutorPage] = useState("dashboard");
  const [authUser, setAuthUser] = useState(() => auth.currentUser);
  const [videoSession, setVideoSession] = useState(null);
  const [chatSession, setChatSession] = useState(null);
  const [selectedTutorChatSessionId, setSelectedTutorChatSessionId] = useState(null);
  const [tutorChatUnreadCount, setTutorChatUnreadCount] = useState(0);

  // INSTANT HUMAN TUTOR
  const [instantRequests, setInstantRequests] = useState([]);
  const [instantRequestLoading, setInstantRequestLoading] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setAuthUser(firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTutorData() {
      const user = authUser;

      // Clear all account-scoped state before loading the current Firebase user.
      setTutorProfile(null);
      setRequests([]);
      setStudents([]);
      setLatestTutorApplication(null);
      setAvailability(false);

      if (!user) {
        setTutorError("Please login again.");
        setProfileLoading(false);
        return;
      }

      try {
        setProfileLoading(true);
        setTutorError("");

        const profileSnap = await getDoc(doc(db, "users", user.uid));

        if (cancelled) return;

        if (profileSnap.exists()) {
          const data = profileSnap.data();

          setTutorProfile({
            id: user.uid,
            name: data.fullName || user.displayName || "Tutor",
            email: data.email || user.email || "",
            phone: data.phone || "",
            education: data.education || "",
            subject: data.subject || "",
            experience: data.experience || "",
            location: data.location || "",
            classes: data.classes || "",
            mode: data.mode || "Online",
            rating: data.rating || "New",
            latitude: Number(data.latitude),
            longitude: Number(data.longitude),
            locationActive: data.locationActive === true,
            verified: data.verified === true,
            verificationStatus: data.verificationStatus || "",
            available: data.verified === true && data.available === true,
          });

          setAvailability(data.verified === true && data.available === true);
        }

        const applicationQuery = query(
          collection(db, "tutorApplications"),
          where("tutorId", "==", user.uid)
        );
        const applicationSnap = await getDocs(applicationQuery);

        const getApplicationTime = (value) => {
          if (!value) return 0;
          if (typeof value.toMillis === "function") return value.toMillis();
          if (typeof value === "string") return new Date(value).getTime() || 0;
          return 0;
        };

        const apps = applicationSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const aTime = Math.max(
              getApplicationTime(a.updatedAt),
              getApplicationTime(a.submittedAt)
            );
            const bTime = Math.max(
              getApplicationTime(b.updatedAt),
              getApplicationTime(b.submittedAt)
            );
            return bTime - aTime;
          });

        setLatestTutorApplication(apps[0] || null);
      } catch (error) {
        console.error("Tutor dashboard load error:", error);

        if (!cancelled) {
          setTutorError(
            error?.code === "permission-denied"
              ? "Tutor data permission denied. Please publish the Firestore Rules."
              : "Could not load tutor data. Please try again."
          );
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    loadTutorData();

    return () => {
      cancelled = true;
    };
  }, [authUser?.uid]);

  // Refresh tutor GPS whenever the tutor is available.
  useEffect(() => {
    let cancelled = false;
    if (!authUser || !tutorProfile?.verified || !availability) return undefined;
    getBrowserLocation({ maximumAge: 30000 })
      .then(async (coords) => {
        if (cancelled) return;
        try {
          await setDoc(doc(db, "users", authUser.uid), { latitude: coords.latitude, longitude: coords.longitude, locationActive: true, locationUpdatedAt: serverTimestamp() }, { merge: true });
          setTutorProfile((previous) => previous ? { ...previous, latitude: coords.latitude, longitude: coords.longitude, locationActive: true } : previous);
        } catch (error) { console.error("Save tutor GPS error:", error); }
      })
      .catch((error) => { if (!cancelled) setTutorError(error?.message || "Could not activate tutor location."); });
    return () => { cancelled = true; };
  }, [authUser?.uid, tutorProfile?.verified, availability]);

  // Keep Instant Human Tutor requests synchronized in real time.
  // React + Firestore onSnapshot is the React equivalent of a Flutter StreamBuilder.
  useEffect(() => {
    const user = authUser;
    if (!user) {
      setInstantRequests([]);
      return undefined;
    }

    // Query only by tutorId so no composite index is required.
    // Pending/expiry filtering is handled locally.
    const instantQuery = query(
      collection(db, "instant_requests"),
      where("tutorId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      instantQuery,
      (snapshot) => {
        const now = Date.now();
        const loaded = snapshot.docs
          .map((requestDoc) => ({
            id: requestDoc.id,
            ...requestDoc.data(),
          }))
          .filter((request) => {
            if (request.status !== "pending") return false;
            const expiresAt = Number(request.expiresAt || 0);
            return !expiresAt || expiresAt > now;
          })
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });

        setInstantRequests(loaded);
      },
      (error) => {
        console.error("Instant tutor requests listener error:", error);
        setTutorError(
          error?.code === "permission-denied"
            ? "Instant tutor request permission denied. Please publish the updated Firestore Rules."
            : "Could not load Instant Doubt Requests."
        );
      }
    );

    return () => unsubscribe();
  }, [authUser?.uid]);

  async function acceptInstantTutorRequest(request) {
    const user = auth.currentUser;

    if (!user) {
      alert("Please login again.");
      return;
    }

    if (!request?.id || request.tutorId !== user.uid) {
      alert("This instant request is not assigned to your tutor account.");
      return;
    }

    if (!tutorProfile?.verified || !availability) {
      alert("Please keep your verified tutor status Available to accept Instant Doubt requests.");
      return;
    }

    if (instantRequestLoading) return;

    try {
      setInstantRequestLoading(true);

      const requestRef = doc(db, "instant_requests", request.id);
      const sessionId = `instant-${request.id}`;
      const sessionRef = doc(db, "sessions", sessionId);
      const expiresAt = Date.now() + 360000;

      // Accept + session creation happen atomically. This prevents an
      // accepted request without a matching session (or an orphan session).
      await runTransaction(db, async (transaction) => {
        const requestSnap = await transaction.get(requestRef);

        if (!requestSnap.exists()) {
          throw new Error("This instant request no longer exists.");
        }

        const liveRequest = requestSnap.data() || {};

        if (liveRequest.tutorId !== user.uid) {
          throw new Error("This request is assigned to another tutor.");
        }

        if (liveRequest.status !== "pending") {
          throw new Error("This instant request has already been handled.");
        }

        const requestExpiry = Number(liveRequest.expiresAt || 0);
        if (requestExpiry > 0 && requestExpiry <= Date.now()) {
          throw new Error("This instant request has expired.");
        }

        if (!liveRequest.studentId) {
          throw new Error("This instant request is missing the student account.");
        }

        transaction.set(
          sessionRef,
          {
            studentId: liveRequest.studentId,
            studentEmail: liveRequest.studentEmail || "",
            studentName: liveRequest.studentName || "Student",
            tutorId: user.uid,
            tutorEmail: user.email || liveRequest.tutorEmail || "",
            tutorName: tutorProfile?.name || liveRequest.tutorName || "Tutor",
            subject: liveRequest.subject || tutorProfile?.subject || "General",
            tutorEducation: tutorProfile?.education || liveRequest.tutorEducation || "Verified Tutor",
            tutorRating: tutorProfile?.rating || liveRequest.tutorRating || "New",
            tutorExperience: tutorProfile?.experience || liveRequest.tutorExperience || "Verified",
            tutorMode: "Online",
            tutorType: "Instant Human Tutor",
            mode: "Online",
            sessionType: "Instant Human Tutor",
            status: "Accepted",
            instantRequestId: request.id,
            expiresAt,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        transaction.update(requestRef, {
          status: "accepted",
          acceptedAt: serverTimestamp(),
          expiresAt,
          sessionId,
          updatedAt: serverTimestamp(),
        });
      });

      const acceptedSession = {
        id: sessionId,
        studentId: request.studentId,
        tutorId: user.uid,
        studentName: request.studentName || "Student",
        tutorName: tutorProfile?.name || request.tutorName || "Tutor",
        subject: request.subject || tutorProfile?.subject || "General",
        mode: "Online",
        sessionType: "Instant Human Tutor",
        status: "Accepted",
        expiresAt,
      };

      setInstantRequests((items) => items.filter((item) => item.id !== request.id));
      setVideoSession(acceptedSession);
    } catch (error) {
      console.error("Accept instant tutor request error:", error);
      const message =
        error?.code === "permission-denied"
          ? "Instant Tutor permission denied. Publish the updated Firestore Rules first."
          : error?.message || "Could not accept the instant tutor request.";
      alert(message);
    } finally {
      setInstantRequestLoading(false);
    }
  }

  async function rejectInstantTutorRequest(request) {
    const user = auth.currentUser;

    if (!user || !request?.id || request.tutorId !== user.uid) {
      alert("Please login again.");
      return;
    }

    try {
      setInstantRequestLoading(true);
      await updateDoc(doc(db, "instant_requests", request.id), {
        status: "rejected",
        rejectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setInstantRequests((items) => items.filter((item) => item.id !== request.id));
    } catch (error) {
      console.error("Reject instant tutor request error:", error);
      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to reject this request."
          : "Could not reject the instant tutor request."
      );
    } finally {
      setInstantRequestLoading(false);
    }
  }

  // Keep tutor booking requests synchronized with Firestore in real time.
  // This does not change the existing UI; it only makes the existing request/session
  // views reflect bookings and Accept/Reject changes without a manual refresh.
  useEffect(() => {
    const user = authUser;
    if (!user) return undefined;

    const sessionsQuery = query(
      collection(db, "sessions"),
      where("tutorId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      sessionsQuery,
      (snapshot) => {
        const loadedRequests = snapshot.docs
          .map((sessionDoc) => {
            const data = sessionDoc.data();
            return {
              id: sessionDoc.id,
              studentId: data.studentId || "",
              studentEmail: data.studentEmail || "",
              student: data.studentName || "Student",
              subject: data.subject || "General",
              classLevel: data.classLevel || "",
              mode: data.mode || "Online",
              sessionType: data.sessionType || "",
              date: data.date || "",
              time: data.time || "",
              note: data.note || "",
              status: data.status || "Pending",
              sessionStarted: data.sessionStarted === true,
              sessionStartedAt: data.sessionStartedAt || null,
              createdAt: data.createdAt || null,
            };
          })
          // Instant Human Tutor has its own dashboard. Keep it out of the
          // existing Demo Requests / My Students / Sessions UI.
          .filter((item) => item.sessionType !== "Instant Human Tutor")
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
          });

        setRequests(loadedRequests);

        const uniqueStudents = [];
        const seen = new Set();

        loadedRequests
          .filter((item) =>
            ["Confirmed", "Tutor Assigned", "Accepted", "Offline Session Confirmed & Active"].includes(item.status)
          )
          .forEach((item) => {
            const key = item.studentId || item.studentEmail || item.student;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueStudents.push({
                id: key,
                sessionId: item.id,
                studentId: item.studentId,
                name: item.student,
                subject: item.subject,
                progress: 0,
                mode: item.mode,
                status: item.status,
              });
            }
          });

        setStudents(uniqueStudents);
      },
      (error) => {
        console.error("Realtime tutor sessions error:", error);
        setTutorError(
          error?.code === "permission-denied"
            ? "Tutor session permission denied. Please publish the Firestore Rules."
            : "Could not load tutor bookings. Please try again."
        );
      }
    );

    return () => unsubscribe();
  }, [authUser?.uid]);

  async function toggleAvailability() {
    const user = auth.currentUser;
    if (!user) { alert("Please login again."); return; }
    if (!tutorProfile?.verified) { alert("Your tutor profile must be approved before you can become available."); return; }
    const next = !availability;
    try {
      if (next) {
        let coords;
        try { coords = await getBrowserLocation({ maximumAge: 0 }); }
        catch (error) { alert(error?.message || "Location permission is required to become available."); return; }
        await setDoc(doc(db, "users", user.uid), { available: true, locationActive: true, latitude: coords.latitude, longitude: coords.longitude, locationUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        setAvailability(true);
        setTutorProfile((old) => old ? { ...old, available: true, locationActive: true, latitude: coords.latitude, longitude: coords.longitude } : old);
      } else {
        await setDoc(doc(db, "users", user.uid), { available: false, locationActive: false, updatedAt: serverTimestamp() }, { merge: true });
        setAvailability(false);
        setTutorProfile((old) => old ? { ...old, available: false, locationActive: false } : old);
      }
    } catch (error) {
      console.error("Availability update error:", error);
      alert(error?.code === "permission-denied" ? "You do not have permission to change availability." : "Could not update availability.");
    }
  }

  async function updateRequest(id, nextStatus) {
    const user = auth.currentUser;

    if (!user) {
      alert("Please login again.");
      return;
    }

    const request = requests.find((item) => item.id === id);
    if (!request) return;

    try {
      setRequestLoading(true);

      await updateDoc(doc(db, "sessions", id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      setRequests((items) =>
        items.map((item) =>
          item.id === id ? { ...item, status: nextStatus } : item
        )
      );

      if (nextStatus === "Accepted") {
        setStudents((items) => {
          const key =
            request.studentId || request.studentEmail || request.student;

          if (items.some((item) => item.id === key)) return items;

          return [
            ...items,
            {
              id: key,
              name: request.student,
              subject: request.subject,
              progress: 0,
              mode: request.mode,
            },
          ];
        });
      }
    } catch (error) {
      console.error("Request update error:", error);
      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to update this booking."
          : "Could not update the booking."
      );
    } finally {
      setRequestLoading(false);
    }
  }

  async function endNormalSession(id) {
    const user = auth.currentUser;
    if (!user) {
      alert("Please login again.");
      return;
    }

    const request = requests.find((item) => item.id === id);
    if (!request || request.status !== "Accepted" || request.mode !== "Online" || !request.sessionStarted) return;

    try {
      setRequestLoading(true);
      await updateDoc(doc(db, "sessions", id), {
        status: "Completed",
        sessionEndedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setRequests((items) =>
        items.map((item) =>
          item.id === id ? { ...item, status: "Completed" } : item
        )
      );
      setVideoSession(null);
    } catch (error) {
      console.error("Session end error:", error);
      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to end this session."
          : "Could not end the session."
      );
    } finally {
      setRequestLoading(false);
    }
  }

  async function startNormalSession(id) {
    const user = auth.currentUser;
    if (!user) {
      alert("Please login again.");
      return;
    }

    const request = requests.find((item) => item.id === id);
    if (!request || request.status !== "Accepted" || request.mode !== "Online") return;

    try {
      setRequestLoading(true);
      await updateDoc(doc(db, "sessions", id), {
        sessionStarted: true,
        sessionStartedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setRequests((items) =>
        items.map((item) =>
          item.id === id ? { ...item, sessionStarted: true } : item
        )
      );
    } catch (error) {
      console.error("Session start error:", error);
      alert(
        error?.code === "permission-denied"
          ? "You do not have permission to start this session."
          : "Could not start the session."
      );
    } finally {
      setRequestLoading(false);
    }
  }

  function goTo(page) {
    setActiveTutorPage(page);
  }

  // Instant Tutor only: ending the existing video session marks the instant
  // request finished so the same student/tutor can receive a fresh request.
  async function finishInstantTutorSession(nextStatus = "Completed") {
    const current = videoSession;
    setVideoSession(null);

    if (!current?.id || current?.sessionType !== "Instant Human Tutor") return;

    const user = auth.currentUser;
    if (!user) return;

    const requestId = current.instantRequestId || current.id.replace(/^instant-/, "");

    try {
      await runTransaction(db, async (transaction) => {
        const sessionRef = doc(db, "sessions", current.id);
        const requestRef = requestId ? doc(db, "instant_requests", requestId) : null;
        const requestSnap = requestRef ? await transaction.get(requestRef) : null;

        transaction.update(sessionRef, {
          status: nextStatus,
          endedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (requestRef && requestSnap?.exists()) {
          transaction.update(requestRef, {
            status: nextStatus.toLowerCase(),
            endedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      });

      setInstantRequests((items) => items.filter((item) => item.id !== requestId));
    } catch (error) {
      console.error("Finish Instant Tutor session error:", error);
    }
  }

  if (showTutorVerification) {
    return (
      <>
        <style>{TUTOR_VERIFICATION_CSS}</style>
        <TutorVerificationApplication
          initialApplication={latestTutorApplication}
          tutorProfile={tutorProfile}
          onBack={() => setShowTutorVerification(false)}
          onSubmitted={(application) => {
            setLatestTutorApplication(application);
            setShowTutorVerification(false);
          }}
        />
      </>
    );
  }

  const pendingCount = requests.filter(
    (r) => ["Confirmed", "Pending", "Demo Requested"].includes(r.status)
  ).length;

  const activeStudentCount = students.length;

  const sessionCount = requests.filter(
    (r) => !["Rejected", "Cancelled"].includes(r.status)
  ).length;

  const acceptedCount = requests.filter(
    (r) => ["Accepted", "Offline Session Confirmed & Active"].includes(r.status)
  ).length;

  const verificationStatus = tutorProfile?.verified
    ? "Verified"
    : latestTutorApplication?.status || tutorProfile?.verificationStatus || "Not submitted";

  const verificationLabel =
    verificationStatus === "Approved" ? "Verified" : verificationStatus;

  const navItems = [
    { id: "dashboard", icon: "⌂", label: "Dashboard" },
    { id: "instant", icon: "⚡", label: "Instant Doubt", count: instantRequests.length },
    { id: "requests", icon: "📩", label: "Demo Requests", count: pendingCount },
    { id: "students", icon: "👨‍🎓", label: "My Students", count: activeStudentCount },
    { id: "chat", icon: "💬", label: "Tutor Chat", count: tutorChatUnreadCount },
    { id: "sessions", icon: "📅", label: "Sessions", count: sessionCount },
    { id: "earnings", icon: "💰", label: "Earnings" },
    { id: "profile", icon: "👤", label: "Profile" },
  ];

  return (
    <>
      <ChatPresenceTracker sessions={requests} role="tutor" />
      {videoSession && <VideoSession session={videoSession} role="tutor" onClose={() => {
        if (videoSession?.sessionType === "Instant Human Tutor") {
          finishInstantTutorSession("Completed");
        } else {
          setVideoSession(null);
        }
      }} />}
      {chatSession && (() => {
        const matched = requests.find((item) => item.id === chatSession.sessionId);
        if (!matched) return null;
        return (
          <LiveChat
            session={{
              id: matched.id,
              studentId: matched.studentId,
              tutorId: authUser?.uid || "",
              studentName: matched.student,
              subject: matched.subject,
              mode: matched.mode,
              status: matched.status,
            }}
            role="tutor"
            overlay
            onClose={() => setChatSession(null)}
          />
        );
      })()}
      <style>{TUTOR_DASHBOARD_CSS}</style>

      <div className="tutor-app">
        <aside className="tutor-side">
          <Logo />

          <div className="tutor-account">
            <div className="tutor-avatar">👨‍🏫</div>
            <div>
              <strong>{tutorProfile?.name || "Tutor Account"}</strong>
              <small>
                {tutorProfile?.verified ? "✓ Verified Tutor" : "Tutor Account"}
              </small>
            </div>
          </div>

          <nav className="tutor-nav">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={activeTutorPage === item.id ? "active" : ""}
                onClick={() => goTo(item.id)}
              >
                <span className="tutor-nav-left">
                  <i>{item.icon}</i>
                  {item.label}
                </span>
                {item.count > 0 && <b>{item.count}</b>}
              </button>
            ))}
          </nav>

          <div className="tutor-side-bottom">
            <div className="tutor-help">
              <span>✦</span>
              <div>
                <strong>Lathso Tutor</strong>
                <small>Teach. Connect. Grow.</small>
              </div>
            </div>

            <button className="tutor-logout" onClick={onLogout}>
              ↪ Logout
            </button>
          </div>
        </aside>

        <main className="tutor-main">
          <header className="tutor-topbar">
            <div>
              <span className="tutor-kicker">TUTOR PORTAL</span>
              <h1>
                {activeTutorPage === "dashboard"
                  ? `Good afternoon, ${tutorProfile?.name?.split(" ")[0] || "Tutor"} 👋`
                  : navItems.find((item) => item.id === activeTutorPage)?.label}
              </h1>
              <p>
                {activeTutorPage === "dashboard"
                  ? "Manage your students, requests and teaching activity."
                  : "Everything you need to manage your Lathso teaching profile."}
              </p>
            </div>

            <div className="tutor-top-actions">
              <span className={tutorProfile?.verified ? "tutor-status verified" : "tutor-status"}>
                {tutorProfile?.verified ? "● Verified" : "● Verification pending"}
              </span>

              <button
                className={availability ? "tutor-availability on" : "tutor-availability"}
                onClick={toggleAvailability}
                disabled={profileLoading}
                title={!tutorProfile?.verified ? "Approval required" : ""}
              >
                {availability && tutorProfile?.verified ? "🟢 Available" : "⚪ Offline"}
              </button>
            </div>
          </header>

          {tutorError && (
            <div className="tutor-alert error">
              ⚠️ <span>{tutorError}</span>
            </div>
          )}

          {activeTutorPage === "dashboard" && (
            <>
              <section className="tutor-hero">
                <div className="tutor-hero-copy">
                  <span className="tutor-kicker">TEACHING PROFILE</span>
                  <h2>
                    {tutorProfile?.verified
                      ? "Your tutor profile is live."
                      : latestTutorApplication?.status === "Pending"
                      ? "Your verification is under review."
                      : latestTutorApplication?.status === "Rejected"
                      ? "Your application needs attention."
                      : "Become a verified Lathso Tutor."}
                  </h2>
                  <p>
                    {tutorProfile?.verified
                      ? "Students can discover you when you are available."
                      : latestTutorApplication?.status === "Pending"
                      ? "Our Admin team is reviewing your submitted information."
                      : latestTutorApplication?.status === "Rejected"
                      ? "Review the application and resubmit your verification details."
                      : "Complete verification to start receiving student requests."}
                  </p>

                  <div className="tutor-hero-actions">
                    <button
                      className="tutor-primary"
                      onClick={() => setShowTutorVerification(true)}
                    >
                      {latestTutorApplication ? "View / Resubmit Verification" : "Start Verification"} →
                    </button>
                    <button
                      className="tutor-ghost"
                      onClick={() => goTo("profile")}
                    >
                      View Profile
                    </button>
                  </div>
                </div>

                <div className="tutor-hero-art">
                  <div className="tutor-orb">👨‍🏫</div>
                  <span>✓</span>
                </div>
              </section>

              <section className="tutor-stats">
                <div>
                  <span>Booking Requests</span>
                  <strong>{pendingCount}</strong>
                  <small>Needs response</small>
                </div>
                <div>
                  <span>My Students</span>
                  <strong>{activeStudentCount}</strong>
                  <small>Active learners</small>
                </div>
                <div>
                  <span>Sessions</span>
                  <strong>{sessionCount}</strong>
                  <small>Total sessions</small>
                </div>
                <div>
                  <span>Verification</span>
                  <strong>{verificationLabel}</strong>
                  <small>{availability ? "Available" : "Offline"}</small>
                </div>
              </section>

              <div className="tutor-content-grid">
                <section className="tutor-panel">
                  <div className="tutor-panel-head">
                    <div>
                      <span className="tutor-kicker">ACTION CENTER</span>
                      <h2>Booking Requests</h2>
                    </div>
                    <button className="tutor-text-button" onClick={() => goTo("requests")}>
                      View all →
                    </button>
                  </div>

                  {requests.length === 0 ? (
                    <div className="tutor-empty">
                      <div>📩</div>
                      <h3>No booking requests yet</h3>
                      <p>New student bookings will appear here automatically.</p>
                    </div>
                  ) : (
                    <div className="tutor-list">
                      {requests.slice(0, 4).map((request) => (
                        <TutorRequestRow
                          key={request.id}
                          request={request}
                          requestLoading={requestLoading}
                          onAccept={() => updateRequest(request.id, "Accepted")}
                          onReject={() => updateRequest(request.id, "Rejected")}
                          onStartSession={() => startNormalSession(request.id)}
                           onEndSession={() => endNormalSession(request.id)}
                           onJoinVideo={() => setVideoSession(request)}
                           onDemoComplete={() => updateRequest(request.id, "Demo Completed")}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <section className="tutor-panel">
                  <div className="tutor-panel-head">
                    <div>
                      <span className="tutor-kicker">PROFILE STATUS</span>
                      <h2>Verification</h2>
                    </div>
                    <span className={tutorProfile?.verified ? "tutor-pill green" : "tutor-pill"}>
                      {tutorProfile?.verified ? "Approved" : verificationStatus}
                    </span>
                  </div>

                  <div className="tutor-check-list">
                    <div className="done"><span>✓</span><div><strong>Account</strong><small>Firebase account connected</small></div></div>
                    <div className={tutorProfile?.name ? "done" : ""}><span>{tutorProfile?.name ? "✓" : "2"}</span><div><strong>Teaching profile</strong><small>{tutorProfile?.name ? "Profile details added" : "Complete your details"}</small></div></div>
                    <div className={latestTutorApplication ? "done" : ""}><span>{latestTutorApplication ? "✓" : "3"}</span><div><strong>Verification application</strong><small>{latestTutorApplication ? "Application submitted" : "Submit your teaching details"}</small></div></div>
                    <div className={tutorProfile?.verified ? "done" : ""}><span>{tutorProfile?.verified ? "✓" : "4"}</span><div><strong>Admin approval</strong><small>{tutorProfile?.verified ? "Tutor profile approved" : "Waiting for review"}</small></div></div>
                  </div>
                </section>
              </div>

              <section className="tutor-panel">
                <div className="tutor-panel-head">
                  <div>
                    <span className="tutor-kicker">MY STUDENTS</span>
                    <h2>Active Learners</h2>
                  </div>
                  <button className="tutor-text-button" onClick={() => goTo("students")}>
                    Manage students →
                  </button>
                </div>

                {students.length === 0 ? (
                  <div className="tutor-empty compact">
                    <div>👨‍🎓</div>
                    <h3>No students assigned yet</h3>
                    <p>Accept a student booking to see learners here.</p>
                  </div>
                ) : (
                  <div className="tutor-student-grid">
                    {students.slice(0, 3).map((student) => (
                      <TutorStudentCard key={student.id} student={student} onChat={(item) => setChatSession(item)} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTutorPage === "instant" && (
            <section className="tutor-panel instant-dashboard-panel">
              <div className="instant-dashboard-hero">
                <div>
                  <span className="tutor-kicker">LIVE • REAL-TIME</span>
                  <h2>Instant Doubt Requests</h2>
                  <p>Students who need immediate human help appear here as soon as they send a request.</p>
                </div>
                <div className="instant-tutor-status">
                  <span className="instant-status-dot" />
                  {availability && tutorProfile?.verified ? "Ready to receive" : "Turn Available ON"}
                </div>
              </div>

              {!tutorProfile?.verified && (
                <div className="instant-tutor-warning">
                  ⚠️ <span>Only verified tutors can receive Instant Doubt requests.</span>
                </div>
              )}

              {tutorProfile?.verified && !availability && (
                <div className="instant-tutor-warning">
                  🟠 <span>Set your tutor status to <strong>Available</strong> to receive live requests.</span>
                </div>
              )}

              <div className="instant-request-toolbar">
                <div>
                  <span>ACTIVE QUEUE</span>
                  <strong>{instantRequests.length} request{instantRequests.length === 1 ? "" : "s"}</strong>
                </div>
                <div className="instant-refresh-label">● Firestore live stream</div>
              </div>

              {instantRequests.length === 0 ? (
                <div className="instant-empty">
                  <div className="instant-empty-orb">⚡</div>
                  <h3>Waiting for an Instant Doubt</h3>
                  <p>Keep your availability switched on. New student requests will appear here automatically — no refresh required.</p>
                </div>
              ) : (
                <div className="instant-request-list">
                  {instantRequests.map((request) => (
                    <InstantTutorRequestCard
                      key={request.id}
                      request={request}
                      loading={instantRequestLoading}
                      onAccept={() => acceptInstantTutorRequest(request)}
                      onReject={() => rejectInstantTutorRequest(request)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTutorPage === "requests" && (
            <section className="tutor-panel">
              <div className="tutor-panel-head">
                <div>
                  <span className="tutor-kicker">LIVE BOOKINGS</span>
                  <h2>Student Requests</h2>
                  <p>Accept or reject requests directly from Firestore.</p>
                </div>
                <span className="tutor-pill">{pendingCount} pending</span>
              </div>

              {requests.length === 0 ? (
                <div className="tutor-empty">
                  <div>📩</div>
                  <h3>No booking requests</h3>
                  <p>When a student books you, the request will appear here.</p>
                </div>
              ) : (
                <div className="tutor-list">
                  {requests.map((request) => (
                    <TutorRequestRow
                      key={request.id}
                      request={request}
                      requestLoading={requestLoading}
                      onAccept={() => updateRequest(request.id, "Accepted")}
                      onReject={() => updateRequest(request.id, "Rejected")}
                          onStartSession={() => startNormalSession(request.id)}
                           onEndSession={() => endNormalSession(request.id)}
                           onJoinVideo={() => setVideoSession(request)}
                           onDemoComplete={() => updateRequest(request.id, "Demo Completed")}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTutorPage === "students" && (
            <section className="tutor-panel">
              <div className="tutor-panel-head">
                <div>
                  <span className="tutor-kicker">ACTIVE LEARNERS</span>
                  <h2>My Students</h2>
                  <p>Students collected from accepted or confirmed sessions.</p>
                </div>
              </div>

              {students.length === 0 ? (
                <div className="tutor-empty">
                  <div>👨‍🎓</div>
                  <h3>No students assigned yet</h3>
                  <p>Accept a booking to add a learner.</p>
                </div>
              ) : (
                <div className="tutor-student-grid">
                  {students.map((student) => (
                    <TutorStudentCard key={student.id} student={student} onChat={(item) => setChatSession(item)} />
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTutorPage === "chat" && (
            <section className="tutor-panel">
              <div className="tutor-panel-head">
                <div>
                  <span className="tutor-kicker">PRIVATE CONVERSATIONS</span>
                  <h2>Tutor Chat 💬</h2>
                  <p>Chat privately with students from your accepted bookings.</p>
                </div>
              </div>

              <ChatInbox
                sessions={requests}
                role="tutor"
                selectedSessionId={selectedTutorChatSessionId}
                onSelectSession={setSelectedTutorChatSessionId}
                onUnreadChange={setTutorChatUnreadCount}
              />
            </section>
          )}

          {activeTutorPage === "sessions" && (
            <section className="tutor-panel">
              <div className="tutor-panel-head">
                <div>
                  <span className="tutor-kicker">TEACHING CALENDAR</span>
                  <h2>Sessions</h2>
                  <p>All sessions connected to your tutor account.</p>
                </div>
                <span className="tutor-pill green">{acceptedCount} accepted</span>
              </div>

              {requests.length === 0 ? (
                <div className="tutor-empty">
                  <div>📅</div>
                  <h3>No sessions yet</h3>
                  <p>Your confirmed and accepted sessions will appear here.</p>
                </div>
              ) : (
                <div className="tutor-session-list">
                  {requests.map((request) => (
                    <div className="tutor-session-card" key={request.id}>
                      <div className="tutor-session-icon">📅</div>
                      <div className="tutor-session-main">
                        <strong>{request.subject} • {request.student}</strong>
                        <span>{request.date || "Date not set"} • {request.time || "Time not set"}</span>
                        <small>{request.mode}{request.classLevel ? ` • ${request.classLevel}` : ""}</small>
                      </div>
                      <span className={
                        ["Accepted", "Demo Completed", "Offline Session Confirmed & Active"].includes(request.status)
                          ? "tutor-pill green"
                          : request.status === "Rejected"
                          ? "tutor-pill red"
                          : "tutor-pill"
                      }>
                        {request.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeTutorPage === "earnings" && (
            <section className="tutor-panel">
              <div className="tutor-panel-head">
                <div>
                  <span className="tutor-kicker">EARNINGS</span>
                  <h2>Teaching Earnings</h2>
                  <p>Financial tracking is ready for session-based payment integration.</p>
                </div>
              </div>

              <div className="tutor-earnings-grid">
                <div><span>Total Earnings</span><strong>𠮐</strong><small>Payment backend not connected yet</small></div>
                <div><span>Completed Sessions</span><strong>0</strong><small>Will update from completed sessions</small></div>
                <div><span>Pending Payout</span><strong>𠮐</strong><small>Ready for payment integration</small></div>
              </div>

              <div className="tutor-empty compact">
                <div>💰</div>
                <h3>Earnings backend is ready for the next phase</h3>
                <p>Connect your preferred payment provider and payout collection to activate real earnings.</p>
              </div>
            </section>
          )}

          {activeTutorPage === "profile" && (
            <section className="tutor-profile-grid">
              <div className="tutor-profile-card main">
                <div className="tutor-profile-avatar">👨‍🏫</div>
                <span className={tutorProfile?.verified ? "tutor-pill green" : "tutor-pill"}>
                  {tutorProfile?.verified ? "✓ Verified Tutor" : "Verification Pending"}
                </span>
                <h2>{tutorProfile?.name || "Tutor"}</h2>
                <p>{tutorProfile?.subject || "Subject"} • {tutorProfile?.education || "Qualification not added"}</p>
                <p>{tutorProfile?.experience || "Experience not added"} • {tutorProfile?.classes || "Classes not added"}</p>

                <button
                  className="tutor-primary"
                  onClick={() => setShowTutorVerification(true)}
                >
                  {latestTutorApplication ? "View / Resubmit Verification" : "Complete Verification"} →
                </button>
              </div>

              <div className="tutor-profile-card">
                <span className="tutor-kicker">ACCOUNT DETAILS</span>
                <div className="tutor-detail-list">
                  <div><span>Email</span><strong>{tutorProfile?.email || "—"}</strong></div>
                  <div><span>Phone</span><strong>{tutorProfile?.phone || "—"}</strong></div>
                  <div><span>Location</span><strong>{tutorProfile?.location || "—"}</strong></div>
                  <div><span>Mode</span><strong>{tutorProfile?.mode || "Online"}</strong></div>
                  <div><span>Rating</span><strong>⭐ {tutorProfile?.rating || "New"}</strong></div>
                  <div><span>Availability</span><strong>{availability ? "🟢 Available" : "⚪ Offline"}</strong></div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function InstantTutorRequestCard({ request, loading, onAccept, onReject }) {
  const [secondsLeft, setSecondsLeft] = useState(360);

  useEffect(() => {
    const createdAtMs = request.createdAt?.toMillis?.() || Date.now();
    const deadline = Number(request.expiresAt || 0) || createdAtMs + 360000;

    const updateTimer = () => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };

    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(timer);
  }, [request.id, request.createdAt]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="instant-request-card">
      <div className="instant-request-accent" />
      <div className="instant-request-avatar">
        {(request.studentName || "S").charAt(0).toUpperCase()}
      </div>

      <div className="instant-request-main">
        <div className="instant-request-name-row">
          <div>
            <span className="instant-new-pill">NEW INSTANT DOUBT</span>
            <h3>{request.studentName || "Student"}</h3>
          </div>
          <div className={secondsLeft <= 20 ? "instant-timer urgent" : "instant-timer"}>
            <span>⏱</span> {minutes}:{seconds}
          </div>
        </div>

        <div className="instant-request-meta">
          <span>📚 {request.subject || "General"}</span>
          {request.classLevel && <span>🎓 {request.classLevel}</span>}
          <span>🎥 Video / Audio</span>
        </div>

        {request.questionText && (
          <div className="instant-question-preview">
            <span>STUDENT DOUBT</span>
            <p>{request.questionText}</p>
          </div>
        )}

        {request.hasQuestionImage && (
          <div className="instant-image-note">📷 Question image attached</div>
        )}

        <div className="instant-request-actions">
          <button
            type="button"
            className="tutor-danger"
            disabled={loading}
            onClick={onReject}
          >
            Decline
          </button>
          <button
            type="button"
            className="tutor-primary"
            disabled={loading || secondsLeft === 0}
            onClick={onAccept}
          >
            {secondsLeft === 0 ? "Request Expired" : "✓ Accept & Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TutorRequestRow({ request, requestLoading, onAccept, onReject, onStartSession, onEndSession, onJoinVideo, onDemoComplete }) {
  const initial = (request.student || "S").charAt(0).toUpperCase();
  const isHomeDemo = request.sessionType === "Offline Home Demo" || request.mode === "Home Demo";
  return (
    <div className="tutor-request-row">
      <div className="tutor-row-avatar">{initial}</div>
      <div className="tutor-row-body">
        <strong>{request.student}</strong>
        <span>{request.subject}{request.classLevel ? ` • ${request.classLevel}` : ""}{" • "}{request.mode}</span>
        <small>{request.date || "Date not set"} • {request.time || "Time not set"}</small>
      </div>
      {request.status === "Confirmed" || request.status === "Pending" || request.status === "Demo Requested" ? (
        <div className="tutor-row-actions">
          <button className="tutor-danger" disabled={requestLoading} onClick={onReject}>Reject</button>
          <button className="tutor-primary small" disabled={requestLoading} onClick={onAccept}>{isHomeDemo ? "Accept Demo" : "Accept"}</button>
        </div>
      ) : (
        <div className="tutor-row-actions">
          {isHomeDemo && request.status === "Accepted" && (
            <button className="tutor-primary small" type="button" disabled={requestLoading} onClick={onDemoComplete}>✓ Demo Completed</button>
          )}
          {!isHomeDemo && request.status === "Accepted" && request.mode === "Online" && !request.sessionStarted && (
            <button className="tutor-primary small" type="button" disabled={requestLoading} onClick={onStartSession}>▶ Start Session</button>
          )}
          {!isHomeDemo && request.status === "Accepted" && request.mode === "Online" && request.sessionStarted && (
            <>
              <button className="tutor-primary small" type="button" disabled={requestLoading} onClick={onStartSession}>✓ Session Started</button>
              <button className="tutor-primary small" type="button" onClick={onJoinVideo}>🎥 Video Session</button>
              <button className="tutor-danger small" type="button" disabled={requestLoading} onClick={onEndSession}>⏹ End Session</button>
            </>
          )}
          <span className={["Accepted", "Demo Completed", "Offline Session Confirmed & Active"].includes(request.status) ? "tutor-pill green" : "tutor-pill red"}>{request.status}</span>
        </div>
      )}
    </div>
  );
}

function TutorStudentCard({ student, onChat }) {
  return (
    <div
      className="tutor-student-card"
      onClick={() => onChat?.(student)}
      role={onChat ? "button" : undefined}
      tabIndex={onChat ? 0 : undefined}
      onKeyDown={(event) => {
        if (onChat && (event.key === "Enter" || event.key === " ")) onChat(student);
      }}
    >
      <div className="tutor-student-head">
        <div className="tutor-row-avatar">{(student.name || "S").charAt(0).toUpperCase()}</div>
        <span className="tutor-pill green">Active</span>
      </div>

      <h3>{student.name}</h3>
      <p>{student.subject} • {student.mode}</p>

      <div className="tutor-progress-head">
        <span>Learning progress</span>
        <strong>{student.progress}%</strong>
      </div>
      <div className="tutor-progress">
        <i style={{ width: `${student.progress}%` }} />
      </div>
    </div>
  );
}

const TUTOR_DASHBOARD_CSS = `
.tutor-app{
  min-height:100vh;
  display:grid;
  grid-template-columns:248px minmax(0,1fr);
  background:
    radial-gradient(circle at 72% -10%,rgba(124,92,255,.13),transparent 28%),
    #070713;
  color:#f7f5ff;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}

.tutor-side{
  position:sticky;
  top:0;
  height:100vh;
  box-sizing:border-box;
  display:flex;
  flex-direction:column;
  padding:22px 14px;
  border-right:1px solid rgba(255,255,255,.075);
  background:rgba(10,9,24,.96);
  backdrop-filter:blur(16px);
}

.tutor-side .learnora-logo{margin:0 8px 22px}

.tutor-account{
  display:flex;
  align-items:center;
  gap:11px;
  padding:13px;
  margin-bottom:18px;
  border:1px solid rgba(255,255,255,.075);
  border-radius:16px;
  background:linear-gradient(135deg,rgba(255,255,255,.045),rgba(255,255,255,.018));
}

.tutor-account strong{display:block;font-size:11px}
.tutor-account small{display:block;margin-top:4px;color:#777287;font-size:8px}

.tutor-avatar,.tutor-row-avatar{
  display:grid;
  place-items:center;
  flex:none;
  border-radius:12px;
  background:linear-gradient(135deg,#6d3df0,#9b72ff);
  font-weight:900;
}
.tutor-avatar{width:43px;height:43px}
.tutor-row-avatar{width:42px;height:42px}

.tutor-nav{display:grid;gap:5px}
.tutor-nav button{
  width:100%;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:11px 10px;
  border:1px solid transparent;
  border-radius:11px;
  background:transparent;
  color:#908b9e;
  text-align:left;
  font-size:10px;
  cursor:pointer;
  transition:.18s ease;
}
.tutor-nav button:hover,.tutor-nav button.active{
  color:#fff;
  background:linear-gradient(90deg,rgba(109,61,240,.15),rgba(109,61,240,.04));
  border-color:rgba(139,92,246,.24);
}
.tutor-nav-left{display:flex;align-items:center;gap:10px}
.tutor-nav i{font-style:normal;width:20px;text-align:center;font-size:14px}
.tutor-nav b{
  min-width:18px;height:18px;
  display:grid;place-items:center;
  border-radius:50%;
  background:#6d3df0;
  color:#fff;font-size:7px;
}

.tutor-side-bottom{margin-top:auto}
.tutor-help{
  display:flex;align-items:center;gap:10px;
  padding:12px;margin-bottom:9px;
  border:1px solid rgba(139,92,246,.12);
  border-radius:13px;
  background:rgba(109,61,240,.06);
}
.tutor-help>span{font-size:18px;color:#b9aaff}
.tutor-help strong,.tutor-help small{display:block}
.tutor-help strong{font-size:9px}
.tutor-help small{margin-top:3px;color:#777287;font-size:7px}
.tutor-logout{
  width:100%;padding:11px;
  border:1px solid rgba(255,255,255,.075);
  border-radius:11px;
  background:#141226;color:#aaa5b6;
  font-size:10px;font-weight:750;cursor:pointer;
}

.tutor-main{
  width:100%;
  max-width:1380px;
  margin:0 auto;
  padding:34px 40px 70px;
  box-sizing:border-box;
}

.tutor-topbar{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:22px;
  margin-bottom:22px;
}
.tutor-kicker{
  color:#a78bfa;
  font-size:8px;
  font-weight:900;
  letter-spacing:.15em;
}
.tutor-topbar h1{
  margin:7px 0 5px;
  font-size:32px;
  line-height:1.12;
  letter-spacing:-.04em;
}
.tutor-topbar p{
  margin:0;
  color:#817d90;
  font-size:11px;
}
.tutor-top-actions{display:flex;align-items:center;gap:8px}
.tutor-status,.tutor-availability{
  display:inline-flex;align-items:center;
  padding:8px 11px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:999px;
  background:#111021;
  color:#aaa5b6;
  font-size:8px;font-weight:800;
}
.tutor-status.verified{color:#86efac;border-color:rgba(34,197,94,.18);background:rgba(34,197,94,.055)}
.tutor-availability{cursor:pointer}
.tutor-availability.on{color:#86efac;border-color:rgba(34,197,94,.18);background:rgba(34,197,94,.055)}
.tutor-availability:disabled{opacity:.55;cursor:not-allowed}

.tutor-alert{
  display:flex;gap:8px;
  padding:12px 14px;
  margin-bottom:16px;
  border-radius:12px;
  font-size:9px;
}
.tutor-alert.error{border:1px solid rgba(239,68,68,.2);background:rgba(239,68,68,.055);color:#fca5a5}

.tutor-hero{
  min-height:245px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:30px;
  padding:29px 32px;
  margin-bottom:16px;
  overflow:hidden;
  position:relative;
  border:1px solid rgba(139,92,246,.20);
  border-radius:22px;
  background:
    radial-gradient(circle at 88% 25%,rgba(139,92,246,.24),transparent 28%),
    linear-gradient(125deg,rgba(109,61,240,.14),rgba(255,255,255,.025));
  box-shadow:0 20px 65px rgba(0,0,0,.22);
}
.tutor-hero:after{
  content:"";
  position:absolute;
  width:260px;height:260px;
  right:-90px;bottom:-160px;
  border:1px solid rgba(167,139,250,.10);
  border-radius:50%;
}
.tutor-hero-copy{position:relative;z-index:1;max-width:680px}
.tutor-hero h2{
  margin:9px 0 8px;
  font-size:27px;
  line-height:1.14;
  letter-spacing:-.035em;
}
.tutor-hero p{
  margin:0;
  max-width:640px;
  color:#9993a8;
  font-size:10px;
  line-height:1.65;
}
.tutor-hero-actions{display:flex;gap:8px;margin-top:19px}
.tutor-hero-art{
  width:180px;height:180px;
  position:relative;
  display:grid;place-items:center;
  flex:none;
}
.tutor-orb{
  width:128px;height:128px;
  display:grid;place-items:center;
  border:1px solid rgba(167,139,250,.22);
  border-radius:38px;
  background:radial-gradient(circle at 30% 25%,rgba(167,139,250,.34),rgba(124,92,255,.08));
  font-size:58px;
  box-shadow:0 25px 70px rgba(0,0,0,.25);
}
.tutor-hero-art>span{
  position:absolute;
  right:13px;top:18px;
  width:31px;height:31px;
  display:grid;place-items:center;
  border:4px solid #0b0a18;
  border-radius:50%;
  background:#22c55e;
  color:#06110a;
  font-size:12px;font-weight:900;
}

.tutor-primary,.tutor-ghost,.tutor-danger,.tutor-text-button{
  border-radius:10px;
  font-size:9px;
  font-weight:850;
  cursor:pointer;
  transition:.18s ease;
}
.tutor-primary{
  padding:10px 13px;
  border:1px solid rgba(139,92,246,.22);
  background:linear-gradient(135deg,#6d3df0,#8057f6);
  color:#fff;
  box-shadow:0 9px 25px rgba(109,61,240,.18);
}
.tutor-primary:hover{transform:translateY(-1px);filter:brightness(1.05)}
.tutor-primary.small{padding:8px 11px}
.tutor-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.tutor-ghost{
  padding:10px 13px;
  border:1px solid rgba(255,255,255,.09);
  background:rgba(255,255,255,.035);
  color:#c9c3d4;
}
.tutor-danger{
  padding:8px 11px;
  border:1px solid rgba(239,68,68,.16);
  background:rgba(239,68,68,.055);
  color:#fca5a5;
}
.tutor-danger:disabled{opacity:.5;cursor:not-allowed}
.tutor-text-button{
  padding:7px 0;
  border:0;
  background:transparent;
  color:#b9aaff;
}

.tutor-stats{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:12px;
  margin-bottom:16px;
}
.tutor-stats>div{
  padding:15px 16px;
  border:1px solid rgba(255,255,255,.075);
  border-radius:15px;
  background:rgba(255,255,255,.032);
}
.tutor-stats span,.tutor-stats small{
  display:block;color:#817d90;font-size:8px
}
.tutor-stats strong{
  display:block;
  margin:8px 0 3px;
  font-size:22px;
  letter-spacing:-.025em;
}

.tutor-content-grid{
  display:grid;
  grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr);
  gap:16px;
  margin-bottom:16px;
}

.tutor-panel{
  padding:19px;
  margin-bottom:16px;
  border:1px solid rgba(255,255,255,.075);
  border-radius:18px;
  background:rgba(255,255,255,.032);
}
.tutor-content-grid .tutor-panel{margin-bottom:0}
.tutor-panel-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:15px;
  margin-bottom:15px;
}
.tutor-panel-head h2{
  margin:6px 0 4px;
  font-size:16px;
  letter-spacing:-.02em;
}
.tutor-panel-head p{margin:0;color:#817d90;font-size:9px}

.tutor-pill{
  display:inline-flex;
  align-items:center;
  width:max-content;
  padding:6px 9px;
  border-radius:999px;
  background:rgba(250,204,21,.065);
  color:#fde68a;
  font-size:7px;
  font-weight:900;
}
.tutor-pill.green{background:rgba(34,197,94,.065);color:#86efac}
.tutor-pill.red{background:rgba(239,68,68,.065);color:#fca5a5}

.tutor-list{display:grid;gap:8px}
.tutor-request-row{
  display:flex;
  align-items:center;
  gap:11px;
  padding:11px;
  border:1px solid rgba(255,255,255,.065);
  border-radius:13px;
  background:rgba(0,0,0,.11);
}
.tutor-row-body{flex:1;min-width:0}
.tutor-row-body strong{display:block;font-size:10px}
.tutor-row-body span,.tutor-row-body small{
  display:block;margin-top:3px;color:#817d90;font-size:8px
}
.tutor-row-actions{display:flex;gap:6px}

.tutor-check-list{display:grid;gap:8px}
.tutor-check-list>div{
  display:flex;align-items:center;gap:9px;
  padding:10px;
  border-radius:11px;
  background:rgba(255,255,255,.025);
}
.tutor-check-list>div>span{
  width:24px;height:24px;display:grid;place-items:center;
  border-radius:8px;background:#17142a;color:#8d879c;font-size:9px;font-weight:900;
}
.tutor-check-list>div.done>span{background:rgba(34,197,94,.09);color:#86efac}
.tutor-check-list strong,.tutor-check-list small{display:block}
.tutor-check-list strong{font-size:9px}
.tutor-check-list small{margin-top:3px;color:#817d90;font-size:7px}

.tutor-student-grid{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:10px;
}
.tutor-student-card{
  padding:14px;
  border:1px solid rgba(255,255,255,.065);
  border-radius:14px;
  background:rgba(255,255,255,.022);
}
.tutor-student-head{display:flex;justify-content:space-between;align-items:flex-start}
.tutor-student-card h3{margin:12px 0 4px;font-size:11px}
.tutor-student-card p{margin:0;color:#817d90;font-size:8px}
.tutor-progress-head{
  display:flex;justify-content:space-between;
  margin-top:17px;margin-bottom:6px;
  color:#817d90;font-size:7px
}
.tutor-progress-head strong{color:#d8d3e2;font-size:8px}
.tutor-progress{height:6px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}
.tutor-progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6d3df0,#a78bfa)}

.tutor-empty{
  padding:34px 18px;
  border:1px dashed rgba(255,255,255,.085);
  border-radius:13px;
  text-align:center;
}
.tutor-empty.compact{padding:25px 18px}
.tutor-empty>div{
  width:44px;height:44px;
  display:grid;place-items:center;
  margin:0 auto 10px;
  border-radius:13px;
  background:rgba(124,92,255,.07);
  font-size:19px;
}
.tutor-empty h3{margin:0 0 4px;font-size:12px}
.tutor-empty p{margin:0;color:#817d90;font-size:8px}

.tutor-session-list{display:grid;gap:9px}
.tutor-session-card{
  display:flex;align-items:center;gap:11px;
  padding:12px;
  border:1px solid rgba(255,255,255,.065);
  border-radius:13px;
  background:rgba(255,255,255,.022);
}
.tutor-session-icon{
  width:38px;height:38px;
  display:grid;place-items:center;
  border-radius:11px;
  background:rgba(124,92,255,.09);
}
.tutor-session-main{flex:1}
.tutor-session-main strong,.tutor-session-main span,.tutor-session-main small{display:block}
.tutor-session-main strong{font-size:10px}
.tutor-session-main span{margin-top:3px;color:#b4afbe;font-size:8px}
.tutor-session-main small{margin-top:3px;color:#817d90;font-size:7px}

.tutor-earnings-grid{
  display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px
}
.tutor-earnings-grid>div{
  padding:17px;border:1px solid rgba(255,255,255,.07);
  border-radius:14px;background:rgba(255,255,255,.025)
}
.tutor-earnings-grid span,.tutor-earnings-grid small{display:block;color:#817d90;font-size:8px}
.tutor-earnings-grid strong{display:block;margin:9px 0 4px;font-size:25px}

.tutor-profile-grid{
  display:grid;
  grid-template-columns:.8fr 1.2fr;
  gap:16px;
}
.tutor-profile-card{
  padding:22px;
  border:1px solid rgba(255,255,255,.075);
  border-radius:18px;
  background:rgba(255,255,255,.032);
}
.tutor-profile-card.main{
  display:flex;flex-direction:column;align-items:flex-start;
  background:
    radial-gradient(circle at 85% 10%,rgba(124,92,255,.15),transparent 30%),
    rgba(255,255,255,.032);
}
.tutor-profile-avatar{
  width:68px;height:68px;
  display:grid;place-items:center;
  margin-bottom:15px;
  border-radius:21px;
  background:linear-gradient(135deg,#6d3df0,#9b72ff);
  font-size:32px;
}
.tutor-profile-card h2{margin:14px 0 5px;font-size:22px}
.tutor-profile-card p{margin:3px 0;color:#817d90;font-size:9px}
.tutor-profile-card .tutor-primary{margin-top:20px}
.tutor-detail-list{
  display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px
}
.tutor-detail-list>div{
  padding:12px;border-radius:11px;background:rgba(255,255,255,.025)
}
.tutor-detail-list span,.tutor-detail-list strong{display:block}
.tutor-detail-list span{color:#817d90;font-size:7px}
.tutor-detail-list strong{margin-top:5px;font-size:9px;word-break:break-word}

@media(max-width:1050px){
  .tutor-app{grid-template-columns:220px minmax(0,1fr)}
  .tutor-main{padding:30px 25px 60px}
  .tutor-content-grid{grid-template-columns:1fr}
  .tutor-content-grid .tutor-panel{margin-bottom:0}
  .tutor-student-grid{grid-template-columns:1fr 1fr}
}
@media(max-width:800px){
  .tutor-app{display:block}
  .tutor-side{
    position:relative;height:auto;
    padding:14px;
    border-right:0;border-bottom:1px solid rgba(255,255,255,.075)
  }
  .tutor-side .learnora-logo{margin-bottom:13px}
  .tutor-account{margin-bottom:10px}
  .tutor-nav{grid-template-columns:repeat(3,1fr)}
  .tutor-side-bottom{display:none}
  .tutor-main{padding:24px 18px 50px}
  .tutor-hero-art{display:none}
  .tutor-stats{grid-template-columns:1fr 1fr}
  .tutor-profile-grid{grid-template-columns:1fr}
}
@media(max-width:560px){
  .tutor-topbar{flex-direction:column}
  .tutor-top-actions{width:100%;justify-content:flex-start}
  .tutor-nav{grid-template-columns:1fr 1fr}
  .tutor-hero{padding:22px}
  .tutor-hero h2{font-size:23px}
  .tutor-hero-actions{flex-direction:column}
  .tutor-hero-actions button{width:100%}
  .tutor-stats,.tutor-student-grid,.tutor-earnings-grid,.tutor-detail-list{grid-template-columns:1fr}
  .tutor-request-row,.tutor-session-card{align-items:flex-start;flex-wrap:wrap}
  .tutor-row-actions{width:100%;justify-content:flex-end}
  .tutor-request-row>.tutor-pill,.tutor-session-card>.tutor-pill{margin-left:auto}
}

.tutor-app{min-height:100vh;display:grid;grid-template-columns:248px minmax(0,1fr);background:radial-gradient(circle at 72% -10%,rgba(124,92,255,.13),transparent 28%),#070713;color:#f7f5ff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.tutor-side{position:sticky;top:0;height:100vh;box-sizing:border-box;display:flex;flex-direction:column;padding:22px 14px;border-right:1px solid rgba(255,255,255,.075);background:rgba(10,9,24,.96);backdrop-filter:blur(16px)}
.tutor-side .learnora-logo{margin:0 8px 22px}.tutor-account{display:flex;align-items:center;gap:11px;padding:13px;margin-bottom:18px;border:1px solid rgba(255,255,255,.075);border-radius:16px;background:linear-gradient(135deg,rgba(255,255,255,.045),rgba(255,255,255,.018))}
.tutor-account strong{display:block;font-size:11px}.tutor-account small{display:block;margin-top:4px;color:#777287;font-size:8px}.tutor-avatar,.tutor-row-avatar{display:grid;place-items:center;flex:none;border-radius:12px;background:linear-gradient(135deg,#6d3df0,#9b72ff);font-weight:900}.tutor-avatar{width:43px;height:43px}.tutor-row-avatar{width:42px;height:42px}
.tutor-nav{display:grid;gap:5px}.tutor-nav button{width:100%;display:flex;align-items:center;justify-content:space-between;padding:11px 10px;border:1px solid transparent;border-radius:11px;background:transparent;color:#908b9e;text-align:left;font-size:10px;cursor:pointer;transition:.18s ease}.tutor-nav button:hover,.tutor-nav button.active{color:#fff;background:linear-gradient(90deg,rgba(109,61,240,.15),rgba(109,61,240,.04));border-color:rgba(139,92,246,.24)}.tutor-nav-left{display:flex;align-items:center;gap:10px}.tutor-nav i{font-style:normal;width:20px;text-align:center;font-size:14px}.tutor-nav b{min-width:18px;height:18px;display:grid;place-items:center;border-radius:50%;background:#6d3df0;color:#fff;font-size:7px}
.tutor-side-bottom{margin-top:auto}.tutor-help{display:flex;align-items:center;gap:10px;padding:12px;margin-bottom:9px;border:1px solid rgba(139,92,246,.12);border-radius:13px;background:rgba(109,61,240,.06)}.tutor-help>span{font-size:18px;color:#b9aaff}.tutor-help strong,.tutor-help small{display:block}.tutor-help strong{font-size:9px}.tutor-help small{margin-top:3px;color:#777287;font-size:7px}.tutor-logout{width:100%;padding:11px;border:1px solid rgba(255,255,255,.075);border-radius:11px;background:#141226;color:#aaa5b6;font-size:10px;font-weight:750;cursor:pointer}
.tutor-main{width:100%;max-width:1380px;margin:0 auto;padding:34px 40px 70px;box-sizing:border-box}.tutor-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;margin-bottom:22px}.tutor-kicker{color:#a78bfa;font-size:8px;font-weight:900;letter-spacing:.15em}.tutor-topbar h1{margin:7px 0 5px;font-size:32px;line-height:1.12;letter-spacing:-.04em}.tutor-topbar p{margin:0;color:#817d90;font-size:11px}.tutor-top-actions{display:flex;align-items:center;gap:8px}.tutor-status,.tutor-availability{display:inline-flex;align-items:center;padding:8px 11px;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:#111021;color:#aaa5b6;font-size:8px;font-weight:800}.tutor-status.verified{color:#86efac;border-color:rgba(34,197,94,.18);background:rgba(34,197,94,.055)}.tutor-availability{cursor:pointer}.tutor-availability.on{color:#86efac;border-color:rgba(34,197,94,.18);background:rgba(34,197,94,.055)}.tutor-availability:disabled{opacity:.55;cursor:not-allowed}
.tutor-alert{display:flex;gap:8px;padding:12px 14px;margin-bottom:16px;border-radius:12px;font-size:9px}.tutor-alert.error{border:1px solid rgba(239,68,68,.2);background:rgba(239,68,68,.055);color:#fca5a5}
.tutor-hero{min-height:245px;display:flex;align-items:center;justify-content:space-between;gap:30px;padding:29px 32px;margin-bottom:16px;overflow:hidden;position:relative;border:1px solid rgba(139,92,246,.20);border-radius:22px;background:radial-gradient(circle at 88% 25%,rgba(139,92,246,.24),transparent 28%),linear-gradient(125deg,rgba(109,61,240,.14),rgba(255,255,255,.025));box-shadow:0 20px 65px rgba(0,0,0,.22)}.tutor-hero-copy{position:relative;z-index:1;max-width:680px}.tutor-hero h2{margin:9px 0 8px;font-size:27px;line-height:1.14;letter-spacing:-.035em}.tutor-hero p{margin:0;max-width:640px;color:#9993a8;font-size:10px;line-height:1.65}.tutor-hero-actions{display:flex;gap:8px;margin-top:19px}.tutor-hero-art{width:180px;height:180px;position:relative;display:grid;place-items:center;flex:none}.tutor-orb{width:128px;height:128px;display:grid;place-items:center;border:1px solid rgba(167,139,250,.22);border-radius:38px;background:radial-gradient(circle at 30% 25%,rgba(167,139,250,.34),rgba(124,92,255,.08));font-size:58px;box-shadow:0 25px 70px rgba(0,0,0,.25)}.tutor-hero-art>span{position:absolute;right:13px;top:18px;width:31px;height:31px;display:grid;place-items:center;border:4px solid #0b0a18;border-radius:50%;background:#22c55e;color:#06110a;font-size:12px;font-weight:900}
.tutor-primary,.tutor-ghost,.tutor-danger,.tutor-text-button{border-radius:10px;font-size:9px;font-weight:850;cursor:pointer;transition:.18s ease}.tutor-primary{padding:10px 13px;border:1px solid rgba(139,92,246,.22);background:linear-gradient(135deg,#6d3df0,#8057f6);color:#fff;box-shadow:0 9px 25px rgba(109,61,240,.18)}.tutor-primary:hover{transform:translateY(-1px);filter:brightness(1.05)}.tutor-primary.small{padding:8px 11px}.tutor-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}.tutor-ghost{padding:10px 13px;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);color:#c9c3d4}.tutor-danger{padding:8px 11px;border:1px solid rgba(239,68,68,.16);background:rgba(239,68,68,.055);color:#fca5a5}.tutor-danger:disabled{opacity:.5;cursor:not-allowed}.tutor-text-button{padding:7px 0;border:0;background:transparent;color:#b9aaff}
.tutor-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}.tutor-stats>div{padding:15px 16px;border:1px solid rgba(255,255,255,.075);border-radius:15px;background:rgba(255,255,255,.032)}.tutor-stats span,.tutor-stats small{display:block;color:#817d90;font-size:8px}.tutor-stats strong{display:block;margin:8px 0 3px;font-size:22px;letter-spacing:-.025em}
.tutor-content-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr);gap:16px;margin-bottom:16px}.tutor-panel{padding:19px;margin-bottom:16px;border:1px solid rgba(255,255,255,.075);border-radius:18px;background:rgba(255,255,255,.032)}.tutor-content-grid .tutor-panel{margin-bottom:0}.tutor-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;margin-bottom:15px}.tutor-panel-head h2{margin:6px 0 4px;font-size:16px;letter-spacing:-.02em}.tutor-panel-head p{margin:0;color:#817d90;font-size:9px}
.tutor-pill{display:inline-flex;align-items:center;width:max-content;padding:6px 9px;border-radius:999px;background:rgba(250,204,21,.065);color:#fde68a;font-size:7px;font-weight:900}.tutor-pill.green{background:rgba(34,197,94,.065);color:#86efac}.tutor-pill.red{background:rgba(239,68,68,.065);color:#fca5a5}
.tutor-list{display:grid;gap:8px}.tutor-request-row{display:flex;align-items:center;gap:11px;padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(0,0,0,.11)}.tutor-row-body{flex:1;min-width:0}.tutor-row-body strong{display:block;font-size:10px}.tutor-row-body span,.tutor-row-body small{display:block;margin-top:3px;color:#817d90;font-size:8px}.tutor-row-actions{display:flex;gap:6px}
.tutor-check-list{display:grid;gap:8px}.tutor-check-list>div{display:flex;align-items:center;gap:9px;padding:10px;border-radius:11px;background:rgba(255,255,255,.025)}.tutor-check-list>div>span{width:24px;height:24px;display:grid;place-items:center;border-radius:8px;background:#17142a;color:#8d879c;font-size:9px;font-weight:900}.tutor-check-list>div.done>span{background:rgba(34,197,94,.09);color:#86efac}.tutor-check-list strong,.tutor-check-list small{display:block}.tutor-check-list strong{font-size:9px}.tutor-check-list small{margin-top:3px;color:#817d90;font-size:7px}
.tutor-student-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.tutor-student-card{padding:14px;border:1px solid rgba(255,255,255,.065);border-radius:14px;background:rgba(255,255,255,.022)}.tutor-student-head{display:flex;justify-content:space-between;align-items:flex-start}.tutor-student-card h3{margin:12px 0 4px;font-size:11px}.tutor-student-card p{margin:0;color:#817d90;font-size:8px}.tutor-progress-head{display:flex;justify-content:space-between;margin-top:17px;margin-bottom:6px;color:#817d90;font-size:7px}.tutor-progress-head strong{color:#d8d3e2;font-size:8px}.tutor-progress{height:6px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}.tutor-progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6d3df0,#a78bfa)}
.tutor-empty{padding:34px 18px;border:1px dashed rgba(255,255,255,.085);border-radius:13px;text-align:center}.tutor-empty.compact{padding:25px 18px}.tutor-empty>div{width:44px;height:44px;display:grid;place-items:center;margin:0 auto 10px;border-radius:13px;background:rgba(124,92,255,.07);font-size:19px}.tutor-empty h3{margin:0 0 4px;font-size:12px}.tutor-empty p{margin:0;color:#817d90;font-size:8px}
.tutor-session-list{display:grid;gap:9px}.tutor-session-card{display:flex;align-items:center;gap:11px;padding:12px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(255,255,255,.022)}.tutor-session-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:rgba(124,92,255,.09)}.tutor-session-main{flex:1}.tutor-session-main strong,.tutor-session-main span,.tutor-session-main small{display:block}.tutor-session-main strong{font-size:10px}.tutor-session-main span{margin-top:3px;color:#b4afbe;font-size:8px}.tutor-session-main small{margin-top:3px;color:#817d90;font-size:7px}
.tutor-earnings-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}.tutor-earnings-grid>div{padding:17px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(255,255,255,.025)}.tutor-earnings-grid span,.tutor-earnings-grid small{display:block;color:#817d90;font-size:8px}.tutor-earnings-grid strong{display:block;margin:9px 0 4px;font-size:25px}
.tutor-profile-grid{display:grid;grid-template-columns:.8fr 1.2fr;gap:16px}.tutor-profile-card{padding:22px;border:1px solid rgba(255,255,255,.075);border-radius:18px;background:rgba(255,255,255,.032)}.tutor-profile-card.main{display:flex;flex-direction:column;align-items:flex-start;background:radial-gradient(circle at 85% 10%,rgba(124,92,255,.15),transparent 30%),rgba(255,255,255,.032)}.tutor-profile-avatar{width:68px;height:68px;display:grid;place-items:center;margin-bottom:15px;border-radius:21px;background:linear-gradient(135deg,#6d3df0,#9b72ff);font-size:32px}.tutor-profile-card h2{margin:14px 0 5px;font-size:22px}.tutor-profile-card p{margin:3px 0;color:#817d90;font-size:9px}.tutor-profile-card .tutor-primary{margin-top:20px}.tutor-detail-list{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px}.tutor-detail-list>div{padding:12px;border-radius:11px;background:rgba(255,255,255,.025)}.tutor-detail-list span,.tutor-detail-list strong{display:block}.tutor-detail-list span{color:#817d90;font-size:7px}.tutor-detail-list strong{margin-top:5px;font-size:9px;word-break:break-word}
@media(max-width:1050px){.tutor-app{grid-template-columns:220px minmax(0,1fr)}.tutor-main{padding:30px 25px 60px}.tutor-content-grid{grid-template-columns:1fr}.tutor-student-grid{grid-template-columns:1fr 1fr}}
@media(max-width:800px){.tutor-app{display:block}.tutor-side{position:relative;height:auto;padding:14px;border-right:0;border-bottom:1px solid rgba(255,255,255,.075)}.tutor-side .learnora-logo{margin-bottom:13px}.tutor-account{margin-bottom:10px}.tutor-nav{grid-template-columns:repeat(3,1fr)}.tutor-side-bottom{display:none}.tutor-main{padding:24px 18px 50px}.tutor-hero-art{display:none}.tutor-stats{grid-template-columns:1fr 1fr}.tutor-profile-grid{grid-template-columns:1fr}}
@media(max-width:560px){.tutor-topbar{flex-direction:column}.tutor-top-actions{width:100%;justify-content:flex-start}.tutor-nav{grid-template-columns:1fr 1fr}.tutor-hero{padding:22px}.tutor-hero h2{font-size:23px}.tutor-hero-actions{flex-direction:column}.tutor-hero-actions button{width:100%}.tutor-stats,.tutor-student-grid,.tutor-earnings-grid,.tutor-detail-list{grid-template-columns:1fr}.tutor-request-row,.tutor-session-card{align-items:flex-start;flex-wrap:wrap}.tutor-row-actions{width:100%;justify-content:flex-end}}

/* INSTANT HUMAN TUTOR BOOKING PAGE — isolated UI additions only */
.instant-human-page{padding-bottom:42px}
.instant-booking-hero{
  position:relative;display:flex;align-items:center;justify-content:space-between;gap:28px;
  min-height:205px;padding:30px 32px;margin-bottom:18px;overflow:hidden;border-radius:24px;
  border:1px solid rgba(124,92,255,.18);
  background:
    radial-gradient(circle at 82% 18%,rgba(56,189,248,.13),transparent 25%),
    radial-gradient(circle at 18% 110%,rgba(124,92,255,.18),transparent 38%),
    linear-gradient(135deg,rgba(17,19,45,.92),rgba(10,12,29,.82));
  box-shadow:0 24px 70px rgba(0,0,0,.25)
}
.instant-booking-hero:after{
  content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,transparent 0 52%,rgba(255,255,255,.025) 52.2%,transparent 52.5%)
}
.instant-hero-copy{position:relative;z-index:1;max-width:700px}
.instant-hero-eyebrow{
  display:inline-flex;align-items:center;gap:8px;color:#9d91ff;font-size:8px;font-weight:900;
  letter-spacing:.13em;margin-bottom:11px
}
.instant-pulse-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 15px rgba(74,222,128,.85)}
.instant-booking-hero h1{margin:0;color:#f7f5ff;font-size:clamp(28px,4vw,43px);line-height:1.05;letter-spacing:-.04em}
.instant-booking-hero h1 span{color:#a78bfa}
.instant-booking-hero p{margin:10px 0 0;color:#8f899d;font-size:11px;line-height:1.7;max-width:580px}
.instant-hero-features{display:flex;flex-wrap:wrap;gap:7px;margin-top:17px}
.instant-hero-features span{
  padding:7px 9px;border:1px solid rgba(255,255,255,.07);border-radius:999px;
  background:rgba(255,255,255,.035);color:#b7b0c3;font-size:7px;font-weight:800
}
.instant-live-orb{
  position:relative;z-index:1;flex:0 0 118px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:118px;border:1px solid rgba(124,92,255,.16);border-radius:28px;
  background:rgba(7,9,24,.48);box-shadow:inset 0 0 35px rgba(124,92,255,.06)
}
.instant-orb-ring{
  width:52px;height:52px;display:grid;place-items:center;border-radius:50%;
  border:1px solid rgba(167,139,250,.35);background:rgba(124,92,255,.12);
  box-shadow:0 0 30px rgba(124,92,255,.18);font-size:23px;color:#c4b5fd
}
.instant-live-orb strong{margin-top:8px;color:#7ee7a1;font-size:8px;letter-spacing:.14em}
.instant-live-orb small{margin-top:3px;color:#6d6878;font-size:6px}
.instant-live-badge{
  display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid rgba(34,197,94,.14);
  border-radius:999px;background:rgba(34,197,94,.05);color:#79d99a;font-size:8px;font-weight:900;letter-spacing:.08em
}
.instant-live-badge i,.instant-online i,.instant-ready-pill i,.instant-section-label i,.instant-avatar-online i{
  width:6px;height:6px;border-radius:50%;display:inline-block;background:#4ade80;
  box-shadow:0 0 12px rgba(74,222,128,.8)
}
.instant-request-banner{
  display:flex;align-items:center;gap:12px;padding:14px 16px;margin:0 0 15px;border-radius:16px;
  border:1px solid rgba(155,124,255,.18);
  background:linear-gradient(110deg,rgba(109,61,240,.13),rgba(34,197,94,.035));
  box-shadow:0 14px 35px rgba(0,0,0,.12)
}
.instant-request-orb{
  width:40px;height:40px;display:grid;place-items:center;flex-shrink:0;border-radius:13px;
  background:rgba(109,61,240,.13);border:1px solid rgba(155,124,255,.2);color:#c4b5fd;font-weight:900
}
.instant-request-banner strong{display:block;color:#eeeaf5;font-size:10px}
.instant-request-banner p{margin:4px 0 0;color:#777184;font-size:8px;line-height:1.5}
.instant-status-pill{
  margin-left:auto;padding:6px 9px;border-radius:999px;font-size:6px;font-weight:900;letter-spacing:.08em
}
.instant-status-pill.pending{color:#fbbf24;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.12)}
.instant-status-pill.accepted{color:#86efac;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.12)}
.instant-human-card{
  padding:22px;border:1px solid rgba(255,255,255,.075);border-radius:20px;
  background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.014));
  box-shadow:0 22px 60px rgba(0,0,0,.16)
}
.instant-card-head{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin-bottom:19px}
.instant-section-label{display:flex;align-items:center;gap:7px;color:#72d893;font-size:7px;font-weight:900;letter-spacing:.13em}
.instant-section-label i{width:5px;height:5px}
.instant-card-head h2{margin:7px 0 5px;color:#f0ecf6;font-size:21px;letter-spacing:-.025em}
.instant-card-head p{margin:0;color:#777184;font-size:8px;line-height:1.65;max-width:650px}
.instant-count-card{
  min-width:78px;padding:10px 13px;text-align:center;border:1px solid rgba(34,197,94,.12);
  border-radius:13px;background:rgba(34,197,94,.035)
}
.instant-count-card strong{display:block;color:#e9fcef;font-size:18px;line-height:1}
.instant-count-card span{display:block;margin-top:5px;color:#65bd82;font-size:5px;font-weight:900;letter-spacing:.1em}
.instant-tutor-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.instant-tutor-card{
  position:relative;padding:16px;border:1px solid rgba(255,255,255,.065);border-radius:17px;
  background:linear-gradient(160deg,rgba(17,18,38,.98),rgba(11,12,25,.96));overflow:hidden;
  transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease
}
.instant-tutor-card:hover{
  transform:translateY(-3px);border-color:rgba(139,92,246,.3);box-shadow:0 18px 40px rgba(0,0,0,.22),0 0 28px rgba(109,61,240,.07)
}
.instant-tutor-card-glow{
  position:absolute;width:120px;height:120px;right:-55px;top:-65px;border-radius:50%;
  background:rgba(109,61,240,.13);filter:blur(5px);pointer-events:none
}
.instant-tutor-top{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.instant-tutor-avatar-wrap{position:relative;width:46px;height:46px}
.instant-tutor-avatar{
  width:46px;height:46px;display:grid;place-items:center;border-radius:15px;
  background:linear-gradient(135deg,#6540dc,#9a78ff);color:#fff;font-size:17px;font-weight:900;
  box-shadow:0 9px 24px rgba(109,61,240,.22)
}
.instant-avatar-online{
  position:absolute;right:-2px;bottom:-2px;width:13px;height:13px;display:grid;place-items:center;
  border-radius:50%;background:#0c0d1c;border:2px solid #0c0d1c
}
.instant-avatar-online i{width:7px;height:7px}
.instant-ready-pill{
  display:inline-flex;align-items:center;gap:5px;padding:6px 8px;border-radius:999px;
  color:#7ee7a1;background:rgba(34,197,94,.045);border:1px solid rgba(34,197,94,.1);
  font-size:5px;font-weight:900;letter-spacing:.08em
}
.instant-ready-pill i{width:5px;height:5px}
.instant-tutor-identity{position:relative;z-index:1}
.instant-tutor-identity h3{margin:0;color:#f0ecf6;font-size:13px}
.instant-tutor-identity span{display:flex;align-items:center;gap:5px;margin-top:4px;color:#756f80;font-size:6px}
.instant-tutor-identity span b{color:#7dd3fc;font-size:8px}
.instant-tutor-subject{display:flex;align-items:center;gap:6px;margin:12px 0 9px;color:#7d7788;font-size:7px}
.instant-tutor-subject strong{color:#c9c2d5;font-size:8px}
.instant-tutor-meta{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.instant-tutor-meta span{
  padding:5px 7px;border:1px solid rgba(255,255,255,.055);border-radius:7px;
  color:#9891a1;background:rgba(255,255,255,.02);font-size:6px
}
.instant-connect-options{
  display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:13px
}
.instant-connect-options span{
  padding:7px 4px;text-align:center;border-radius:8px;background:rgba(124,92,255,.045);
  border:1px solid rgba(124,92,255,.09);color:#8f88a0;font-size:6px
}
.instant-request-button{
  position:relative;z-index:1;width:100%;display:flex!important;align-items:center;justify-content:center;gap:8px;
  padding:11px 12px!important;border-radius:11px!important;font-size:8px!important;
  box-shadow:0 10px 25px rgba(109,61,240,.18)
}
.instant-request-button b{font-size:13px;line-height:1}
.instant-request-button:disabled{opacity:.72;cursor:not-allowed}
.instant-empty-state{
  min-height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:24px;border:1px dashed rgba(255,255,255,.08);border-radius:15px;text-align:center
}
.instant-empty-icon{
  width:46px;height:46px;display:grid;place-items:center;margin-bottom:10px;border-radius:14px;
  background:rgba(124,92,255,.08);border:1px solid rgba(124,92,255,.1);color:#a78bfa;font-size:20px
}
.instant-empty-state h3{margin:0 0 5px;color:#ddd7e7;font-size:12px}
.instant-empty-state p{margin:0;color:#716b7b;font-size:8px}
.instant-loading-line{width:130px;height:3px;margin-top:15px;border-radius:999px;background:rgba(255,255,255,.05);overflow:hidden}
.instant-loading-line i{display:block;width:45%;height:100%;border-radius:999px;background:#8b5cf6;animation:instantLoading 1.2s ease-in-out infinite}
@keyframes instantLoading{0%{transform:translateX(-120%)}100%{transform:translateX(300%)}}
.instant-bypass-note{
  display:flex;align-items:center;gap:10px;margin-top:13px;padding:12px 14px;border-radius:13px;
  border:1px solid rgba(255,145,77,.13);background:rgba(255,145,77,.035)
}
.instant-bypass-note>span:first-child{color:#ffad78;font-size:13px}
.instant-bypass-note strong{display:block;color:#d5cedd;font-size:8px}
.instant-bypass-note p{margin:3px 0 0;color:#716a7a;font-size:6px;line-height:1.55}
.instant-secure-label{margin-left:auto;color:#887f91!important;font-size:5px!important;font-weight:900;white-space:nowrap}
.instant-dashboard-panel{overflow:hidden}
.instant-dashboard-hero{
  display:flex;align-items:center;justify-content:space-between;gap:14px;padding:3px 0 15px;margin-bottom:13px;
  border-bottom:1px solid rgba(255,255,255,.05)
}
.instant-dashboard-hero h2{margin:6px 0 4px;color:#f0ecf6;font-size:19px}
.instant-dashboard-hero p{margin:0;color:#716b7c;font-size:7px;line-height:1.6}
.instant-tutor-status{
  display:inline-flex;align-items:center;gap:7px;padding:8px 10px;border:1px solid rgba(34,197,94,.12);
  border-radius:10px;background:rgba(34,197,94,.035);color:#84d99e;font-size:7px;font-weight:800;white-space:nowrap
}
.instant-status-dot{width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 10px rgba(74,222,128,.7)}
.instant-tutor-warning{
  margin-bottom:11px;padding:9px 11px;border:1px solid rgba(251,191,36,.12);border-radius:10px;
  background:rgba(251,191,36,.035);color:#c7a44e;font-size:7px
}
.instant-request-toolbar{
  display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px;padding:10px 11px;
  border:1px solid rgba(255,255,255,.045);border-radius:10px;background:rgba(255,255,255,.018)
}
.instant-request-toolbar span{display:block;color:#5e5969;font-size:5px;font-weight:900;letter-spacing:.12em}
.instant-request-toolbar strong{display:block;margin-top:3px;color:#ded8e8;font-size:9px}
.instant-refresh-label{color:#6ec58a;font-size:6px;font-weight:800}
.instant-request-list{display:grid;gap:9px}
.instant-request-card{
  position:relative;display:flex;gap:12px;padding:13px;overflow:hidden;border:1px solid rgba(155,124,255,.12);
  border-radius:14px;background:linear-gradient(125deg,rgba(109,61,240,.06),rgba(255,255,255,.018))
}
.instant-request-accent{
  position:absolute;left:0;top:0;bottom:0;width:2px;background:linear-gradient(180deg,#a78bfa,#5b21b6)
}
.instant-request-avatar{
  width:43px;height:43px;flex-shrink:0;background:rgba(109,61,240,.11);border:1px solid rgba(155,124,255,.14);
  color:#c8b9ff;font-size:15px
}
.instant-request-main{flex:1;min-width:0}
.instant-request-name-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.instant-new-pill{
  display:inline-block;padding:4px 6px;border-radius:5px;background:rgba(255,145,77,.08);color:#ffb17b;
  border:1px solid rgba(255,145,77,.12);font-size:5px;font-weight:900;letter-spacing:.07em
}
.instant-request-name-row h3{margin:5px 0 0;color:#e9e4ef;font-size:11px}
.instant-timer{
  padding:6px 8px;border-radius:8px;background:rgba(34,197,94,.045);border:1px solid rgba(34,197,94,.09);
  color:#8ae0a1;font-size:8px;font-weight:900;font-variant-numeric:tabular-nums
}
.instant-timer.urgent{color:#fb8a8a;background:rgba(239,68,68,.05);border-color:rgba(239,68,68,.12)}
.instant-request-meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.instant-request-meta span{color:#797283;font-size:6px}
.instant-question-preview{
  padding:8px 9px;border:1px solid rgba(255,255,255,.05);border-radius:9px;background:rgba(0,0,0,.14);margin-top:5px
}
.instant-question-preview span{display:block;color:#5f596b;font-size:5px;font-weight:900;letter-spacing:.1em}
.instant-question-preview p{margin:4px 0 0;color:#aaa4b4;font-size:7px;line-height:1.5;white-space:pre-wrap}
.instant-image-note{margin-top:6px;color:#8d82a1;font-size:6px}
.instant-request-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:10px}
.instant-request-actions .tutor-primary{padding:8px 11px}
.instant-empty{
  min-height:250px;display:grid;place-items:center;align-content:center;padding:24px;text-align:center;
  border:1px dashed rgba(155,124,255,.12);border-radius:13px;background:rgba(109,61,240,.025)
}
.instant-empty-orb{
  width:54px;height:54px;display:grid;place-items:center;border-radius:17px;margin-bottom:9px;
  background:rgba(109,61,240,.10);border:1px solid rgba(155,124,255,.15);color:#bbaaff;font-size:22px;
  box-shadow:0 0 35px rgba(109,61,240,.10)
}
.instant-empty h3{margin:0;color:#dcd7e5;font-size:11px}
.instant-empty p{max-width:440px;margin:5px 0 0;color:#666172;font-size:7px;line-height:1.6}
@media(max-width:900px){
  .instant-tutor-grid{grid-template-columns:1fr 1fr}
}
@media(max-width:650px){
  .instant-tutor-grid{grid-template-columns:1fr}
  .instant-card-head,.instant-dashboard-hero{flex-direction:column;align-items:flex-start}
  .instant-request-card{align-items:flex-start}
  .instant-request-name-row{flex-direction:column}
  .instant-status-pill{margin-left:0}
}
@media(max-width:900px){
  .instant-booking-hero{padding:25px}
  .instant-tutor-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:620px){
  .instant-booking-hero{min-height:auto;padding:22px;align-items:flex-start}
  .instant-live-orb{display:none}
  .instant-card-head{align-items:flex-start;flex-direction:column}
  .instant-count-card{align-self:flex-start}
  .instant-tutor-grid{grid-template-columns:1fr}
  .instant-human-card{padding:15px}
  .instant-request-banner{align-items:flex-start;flex-wrap:wrap}
  .instant-status-pill{margin-left:52px}
  .instant-secure-label{display:none}
}

/* ============================================================
   INSTANT HUMAN TUTOR — PROFESSIONAL BOOKING UI
   Isolated to .instant-human-page only.
   ============================================================ */
.instant-human-page{position:relative;max-width:1180px;margin:0 auto;padding:8px 0 52px}
.instant-human-page .instant-booking-hero{
  min-height:245px;padding:34px 38px;margin-bottom:20px;border-radius:28px;
  border:1px solid rgba(126,92,255,.28);
  background:radial-gradient(circle at 86% 18%,rgba(56,189,248,.18),transparent 26%),radial-gradient(circle at 14% 105%,rgba(124,92,255,.22),transparent 42%),linear-gradient(135deg,rgba(20,24,55,.96),rgba(8,12,31,.92));
  box-shadow:0 28px 80px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.045)
}
.instant-human-page .instant-hero-eyebrow{font-size:11px;letter-spacing:.14em;color:#a99cff;margin-bottom:14px}
.instant-human-page .instant-pulse-dot{width:9px;height:9px}
.instant-human-page .instant-booking-hero h1{font-size:clamp(32px,4vw,48px);line-height:1.08}
.instant-human-page .instant-booking-hero p{max-width:680px;margin-top:13px;color:#aaa5ba;font-size:14px;line-height:1.65}
.instant-human-page .instant-hero-features{gap:9px;margin-top:20px}
.instant-human-page .instant-hero-features span{padding:9px 13px;font-size:10px;color:#c7c1d3;border-color:rgba(255,255,255,.09);background:rgba(255,255,255,.045)}
.instant-human-page .instant-live-orb{
  flex-basis:142px;min-height:142px;border-radius:32px;border-color:rgba(126,92,255,.3);
  background:radial-gradient(circle at 50% 35%,rgba(124,92,255,.18),transparent 48%),rgba(5,9,25,.66);
  box-shadow:0 0 45px rgba(124,92,255,.1),inset 0 0 40px rgba(56,189,248,.035)
}
.instant-human-page .instant-orb-ring{width:62px;height:62px;font-size:27px;border-color:rgba(167,139,250,.5);box-shadow:0 0 35px rgba(124,92,255,.24)}
.instant-human-page .instant-live-orb strong{margin-top:10px;font-size:10px}
.instant-human-page .instant-live-orb small{font-size:8px;color:#8a8496}
.instant-human-page .instant-request-banner{min-height:66px;padding:15px 18px;margin-bottom:18px;border-radius:18px;border-color:rgba(155,124,255,.25);background:linear-gradient(105deg,rgba(109,61,240,.15),rgba(34,197,94,.045))}
.instant-human-page .instant-request-orb{width:42px;height:42px}
.instant-human-page .instant-request-banner strong{font-size:12px}
.instant-human-page .instant-request-banner p{font-size:10px}
.instant-human-page .instant-status-pill{padding:7px 10px;font-size:8px}
.instant-human-page .instant-human-card{padding:28px;border-radius:24px;border-color:rgba(255,255,255,.085);background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.018));box-shadow:0 24px 70px rgba(0,0,0,.2)}
.instant-human-page .instant-card-head{align-items:center;margin-bottom:24px}
.instant-human-page .instant-section-label{font-size:10px;letter-spacing:.15em}
.instant-human-page .instant-card-head h2{margin:9px 0 7px;font-size:26px;letter-spacing:-.03em}
.instant-human-page .instant-card-head p{max-width:720px;font-size:11px;line-height:1.65}
.instant-human-page .instant-count-card{min-width:104px;padding:13px 16px;border-radius:16px}
.instant-human-page .instant-count-card strong{font-size:25px}
.instant-human-page .instant-count-card span{margin-top:6px;font-size:7px;letter-spacing:.13em}
.instant-human-page .instant-tutor-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:17px}
.instant-human-page .instant-tutor-card{
  min-height:355px;padding:20px;border-radius:20px;border-color:rgba(255,255,255,.085);
  background:radial-gradient(circle at 90% 0%,rgba(124,92,255,.11),transparent 34%),linear-gradient(160deg,rgba(19,22,47,.98),rgba(9,12,28,.98));
  box-shadow:0 16px 40px rgba(0,0,0,.18)
}
.instant-human-page .instant-tutor-card:hover{transform:translateY(-5px);border-color:rgba(139,92,246,.45);box-shadow:0 22px 48px rgba(0,0,0,.3),0 0 35px rgba(109,61,240,.12)}
.instant-human-page .instant-tutor-top{margin-bottom:18px}
.instant-human-page .instant-tutor-avatar-wrap,.instant-human-page .instant-tutor-avatar{width:58px;height:58px}
.instant-human-page .instant-tutor-avatar{border-radius:18px;font-size:21px;box-shadow:0 12px 28px rgba(109,61,240,.3)}
.instant-human-page .instant-avatar-online{width:16px;height:16px}
.instant-human-page .instant-avatar-online i{width:8px;height:8px}
.instant-human-page .instant-ready-pill{padding:7px 10px;font-size:8px}
.instant-human-page .instant-ready-pill i{width:6px;height:6px}
.instant-human-page .instant-tutor-identity h3{font-size:17px;font-weight:800}
.instant-human-page .instant-tutor-identity span{gap:6px;margin-top:6px;font-size:9px;color:#918a9f}
.instant-human-page .instant-tutor-identity span b{font-size:11px}
.instant-human-page .instant-tutor-subject{gap:8px;margin:15px 0 11px;font-size:10px}
.instant-human-page .instant-tutor-subject strong{font-size:12px;color:#d7d0e2}
.instant-human-page .instant-tutor-meta{gap:7px;margin-bottom:14px}
.instant-human-page .instant-tutor-meta span{padding:7px 9px;border-radius:9px;font-size:9px;color:#aaa3b5;background:rgba(255,255,255,.035)}
.instant-human-page .instant-connect-options{gap:7px;margin-bottom:17px}
.instant-human-page .instant-connect-options span{padding:9px 5px;border-radius:10px;font-size:9px;color:#aaa4b8;background:rgba(124,92,255,.07);border-color:rgba(124,92,255,.13)}
.instant-human-page .instant-request-button{min-height:44px;padding:12px 14px!important;border-radius:12px!important;font-size:11px!important;font-weight:800;box-shadow:0 12px 28px rgba(109,61,240,.24)}
.instant-human-page .instant-request-button:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 15px 34px rgba(109,61,240,.3),0 0 24px rgba(124,92,255,.12)}
.instant-human-page .instant-request-button b{font-size:15px}
.instant-human-page .instant-empty-state{min-height:240px}
.instant-human-page .instant-empty-state h3{font-size:15px}
.instant-human-page .instant-empty-state p{font-size:10px}
.instant-human-page .instant-bypass-note{padding:14px 17px;margin-top:16px;border-radius:16px}
.instant-human-page .instant-bypass-note strong{font-size:10px}
.instant-human-page .instant-bypass-note p{font-size:8px}
.instant-human-page .instant-secure-label{font-size:7px!important}
@media(max-width:1000px){.instant-human-page .instant-tutor-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){
  .instant-human-page{padding-left:4px;padding-right:4px}
  .instant-human-page .instant-booking-hero{padding:27px}
  .instant-human-page .instant-live-orb{flex-basis:120px;min-height:120px}
  .instant-human-page .instant-tutor-grid{grid-template-columns:1fr}
  .instant-human-page .instant-human-card{padding:20px}
}
@media(max-width:560px){
  .instant-human-page .instant-booking-hero{padding:23px}
  .instant-human-page .instant-booking-hero h1{font-size:31px}
  .instant-human-page .instant-booking-hero p{font-size:12px}
  .instant-human-page .instant-card-head h2{font-size:22px}
  .instant-human-page .instant-request-banner{padding:13px}
}

`;




const TUTOR_VERIFICATION_CSS_EXTRA = `
.tv-existing-status,.tv-error{margin-bottom:14px;padding:12px 14px;border-radius:12px}
.tv-existing-status{display:grid;gap:3px;border:1px solid rgba(139,92,246,.22);background:rgba(124,92,255,.07)}
.tv-existing-status span{font-size:8px;letter-spacing:.12em;color:#a78bfa;font-weight:900}
.tv-existing-status strong{font-size:14px}
.tv-existing-status small{font-size:9px;color:#858193}
.tv-error{border:1px solid rgba(248,113,113,.25);background:rgba(248,113,113,.08);color:#fca5a5;font-size:10px}
.tv-info-box{display:flex;align-items:center;gap:8px;margin-top:14px;padding:12px;border-radius:11px;background:rgba(124,92,255,.06);color:#817d90;font-size:9px}
.tv-info-box strong{color:#b9aaff}
.tv-info-box span{flex:1}
.tv-limit-note{display:block;margin-top:7px;color:#817d90;font-size:8px}
.tv-submit-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.03)}
.tv-submit-row div{display:grid;gap:4px}
.tv-submit-row strong{font-size:12px}
.tv-submit-row span{font-size:9px;color:#817d90}
@media(max-width:760px){.tv-submit-row{flex-direction:column;align-items:stretch}.tv-submit-row button{width:100%}}
`;

const TUTOR_VERIFICATION_CSS = TUTOR_VERIFICATION_CSS_EXTRA + `
/* =====================================================
   TUTOR VERIFICATION — PREMIUM UI
===================================================== */
.tutor-verification-page{
  width:100%;
  max-width:1120px;
  margin:0 auto;
  padding:38px 34px 70px;
  color:#f7f5ff;
}

.tv-top{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:28px;
  margin-bottom:26px;
  padding:28px 30px;
  border:1px solid rgba(167,139,250,.18);
  border-radius:24px;
  background:
    radial-gradient(circle at 85% 15%,rgba(124,92,255,.20),transparent 32%),
    linear-gradient(135deg,rgba(124,92,255,.13),rgba(255,255,255,.025));
  box-shadow:0 18px 55px rgba(0,0,0,.22);
  overflow:hidden;
  position:relative;
}

.tv-top:after{
  content:"✓";
  position:absolute;
  right:28px;
  bottom:-30px;
  font-size:120px;
  font-weight:900;
  color:rgba(167,139,250,.045);
  pointer-events:none;
}

.tv-kicker{
  display:inline-flex;
  align-items:center;
  gap:7px;
  font-size:9px;
  letter-spacing:.16em;
  font-weight:900;
  color:#b9aaff;
}

.tv-kicker:before{
  content:"";
  width:7px;
  height:7px;
  border-radius:50%;
  background:#a78bfa;
  box-shadow:0 0 14px rgba(167,139,250,.8);
}

.tv-top h1{
  margin:9px 0 7px;
  font-size:34px;
  line-height:1.1;
  letter-spacing:-.04em;
}

.tv-top p{
  max-width:620px;
  margin:0;
  color:#9893a8;
  font-size:11px;
  line-height:1.65;
}

.tv-form{display:grid;gap:17px}

.tv-card{
  padding:24px;
  border:1px solid rgba(255,255,255,.085);
  border-radius:20px;
  background:linear-gradient(145deg,rgba(255,255,255,.052),rgba(255,255,255,.022));
  box-shadow:0 12px 38px rgba(0,0,0,.15);
  transition:.2s ease;
}

.tv-card:hover{
  border-color:rgba(167,139,250,.20);
  transform:translateY(-1px);
}

.tv-card-title{
  display:flex;
  align-items:center;
  gap:13px;
  margin-bottom:20px;
}

.tv-card-title>b{
  width:40px;
  height:40px;
  display:grid;
  place-items:center;
  flex:none;
  border:1px solid rgba(167,139,250,.25);
  border-radius:13px;
  background:linear-gradient(135deg,rgba(124,92,255,.24),rgba(167,139,250,.08));
  color:#c8bdff;
  font-size:10px;
  font-weight:900;
  box-shadow:0 7px 20px rgba(90,60,180,.16);
}

.tv-card-title h2{
  margin:0 0 4px;
  font-size:16px;
  letter-spacing:-.01em;
}

.tv-card-title p{
  margin:0;
  color:#817d90;
  font-size:9px;
  line-height:1.5;
}

.tv-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:15px;
}

.tv-card label{
  display:grid;
  gap:7px;
  color:#aaa6b7;
  font-size:9px;
  font-weight:800;
}

.tv-card input,
.tv-card select{
  width:100%;
  min-height:43px;
  box-sizing:border-box;
  padding:11px 13px;
  border:1px solid rgba(255,255,255,.10);
  border-radius:12px;
  outline:none;
  background:#0d0c1a;
  color:#fff;
  font:inherit;
  transition:.18s ease;
}

.tv-card input::placeholder{color:#5f5a6d}

.tv-card input:hover,
.tv-card select:hover{
  border-color:rgba(255,255,255,.18);
}

.tv-card input:focus,
.tv-card select:focus{
  border-color:rgba(167,139,250,.65);
  box-shadow:0 0 0 3px rgba(124,92,255,.10);
}

.tv-card input[type="file"]{
  padding:8px;
  cursor:pointer;
  color:#aaa6b7;
}

.tv-card input[type="file"]::file-selector-button{
  margin-right:9px;
  padding:7px 10px;
  border:0;
  border-radius:8px;
  background:#19162b;
  color:#d9d3e7;
  cursor:pointer;
  font-size:9px;
  font-weight:800;
}

.tv-file-selected{
  display:block;
  padding:8px 10px;
  border:1px solid rgba(34,197,94,.15);
  border-radius:9px;
  background:rgba(34,197,94,.055);
  color:#86efac;
  font-size:8px;
  line-height:1.4;
}

.tv-note{
  display:flex;
  align-items:center;
  gap:8px;
  margin-top:15px;
  padding:12px 13px;
  border:1px solid rgba(124,92,255,.13);
  border-radius:11px;
  background:rgba(124,92,255,.055);
  color:#aaa6b7;
  font-size:9px;
}

.tv-choice-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:13px;
}

.tv-choice{
  min-height:88px;
  display:flex;
  align-items:center;
  gap:14px;
  padding:16px;
  border:1px solid rgba(255,255,255,.09);
  border-radius:15px;
  background:rgba(255,255,255,.025);
  color:white;
  text-align:left;
  cursor:pointer;
  transition:.2s ease;
}

.tv-choice:hover{
  border-color:rgba(167,139,250,.35);
  background:rgba(124,92,255,.06);
  transform:translateY(-2px);
}

.tv-choice.active{
  border-color:rgba(167,139,250,.72);
  background:linear-gradient(135deg,rgba(124,92,255,.17),rgba(124,92,255,.055));
  box-shadow:0 10px 28px rgba(85,55,180,.14);
}

.tv-choice>span{
  width:48px;
  height:48px;
  display:grid;
  place-items:center;
  flex:none;
  border-radius:13px;
  background:#151229;
  font-size:24px;
}

.tv-choice.active>span{
  background:rgba(167,139,250,.14);
}

.tv-choice strong,
.tv-choice small{display:block}

.tv-choice strong{
  font-size:11px;
  font-weight:850;
}

.tv-choice small{
  margin-top:5px;
  color:#817d90;
  font-size:8px;
  line-height:1.45;
}

.tv-verification-input{margin-top:15px}

.tv-submit{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:22px;
  padding:19px 20px;
  border:1px solid rgba(167,139,250,.20);
  border-radius:17px;
  background:linear-gradient(100deg,rgba(124,92,255,.11),rgba(255,255,255,.025));
}

.tv-submit strong,
.tv-submit span{display:block}

.tv-submit strong{
  font-size:11px;
  font-weight:850;
}

.tv-submit span{
  margin-top:5px;
  color:#817d90;
  font-size:8px;
  line-height:1.5;
}

.tv-success{
  max-width:660px;
  margin:60px auto;
  padding:44px;
  border:1px solid rgba(34,197,94,.20);
  border-radius:24px;
  background:
    radial-gradient(circle at 50% 0%,rgba(34,197,94,.10),transparent 38%),
    rgba(255,255,255,.035);
  box-shadow:0 22px 65px rgba(0,0,0,.25);
  text-align:center;
}

.tv-success-icon{
  width:72px;
  height:72px;
  display:grid;
  place-items:center;
  margin:0 auto 18px;
  border:1px solid rgba(134,239,172,.20);
  border-radius:22px;
  background:rgba(34,197,94,.10);
  color:#86efac;
  font-size:32px;
  font-weight:900;
  box-shadow:0 0 35px rgba(34,197,94,.08);
}

.tv-success h1{
  margin:9px 0;
  font-size:28px;
  letter-spacing:-.03em;
}

.tv-success>p{
  max-width:500px;
  margin:0 auto;
  color:#817d90;
  font-size:10px;
  line-height:1.75;
}

.tv-success-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:11px;
  margin:23px 0;
}

.tv-success-grid div{
  padding:14px;
  border:1px solid rgba(255,255,255,.07);
  border-radius:12px;
  background:rgba(255,255,255,.035);
}

.tv-success-grid span,
.tv-success-grid strong{display:block}

.tv-success-grid span{
  color:#817d90;
  font-size:8px;
}

.tv-success-grid strong{
  margin-top:5px;
  color:#e9e5f2;
  font-size:9px;
}

.tutor-verification-banner{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:18px;
  margin-bottom:18px;
  padding:20px;
  border:1px solid rgba(139,92,246,.22);
  border-radius:18px;
  background:linear-gradient(110deg,rgba(109,61,240,.13),rgba(255,255,255,.025));
}

.tutor-verification-banner h2{
  margin:6px 0 4px;
  font-size:17px;
}

.tutor-verification-banner p{
  margin:0;
  color:#817d90;
  font-size:9px;
}

@media(max-width:760px){
  .tutor-verification-page{padding:22px 15px 50px}
  .tv-top{padding:22px;flex-direction:column}
  .tv-top h1{font-size:28px}
  .tv-grid,.tv-choice-grid,.tv-success-grid{grid-template-columns:1fr}
  .tv-submit,.tutor-verification-banner{flex-direction:column;align-items:flex-start}
  .tv-submit .role-primary,
  .tutor-verification-banner .role-primary{width:100%}
}

@media(max-width:480px){
  .tv-card{padding:18px}
  .tv-choice{min-height:76px;padding:13px}
  .tv-choice>span{width:42px;height:42px;font-size:20px}
  .tv-success{padding:30px 20px;margin:35px auto}
}

/* =====================================================
   TUTOR VERIFICATION — V2 REAL APP UI
   Scoped only to Tutor Verification
===================================================== */
.tutor-verification-page{
  max-width:1180px;
  padding:28px 28px 80px;
}
.tv-top{
  min-height:250px;
  padding:34px 36px;
  border:1px solid rgba(167,139,250,.28);
  border-radius:30px;
  background:
    radial-gradient(circle at 78% 18%,rgba(167,139,250,.24),transparent 25%),
    radial-gradient(circle at 100% 100%,rgba(56,189,248,.10),transparent 28%),
    linear-gradient(135deg,#17122f 0%,#0d0b19 58%,#11102a 100%);
  box-shadow:0 30px 90px rgba(0,0,0,.34);
}
.tv-top h1{
  font-size:42px;
  letter-spacing:-.055em;
}
.tv-top p{
  font-size:12px;
  max-width:680px;
  color:#aaa4bd;
}
.tv-progress-strip{
  display:flex;
  align-items:center;
  max-width:620px;
  margin-top:28px;
  padding:9px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:16px;
  background:rgba(0,0,0,.18);
}
.tv-progress-item{
  display:flex;
  align-items:center;
  gap:8px;
  color:#777187;
  font-size:9px;
  font-weight:800;
  white-space:nowrap;
}
.tv-progress-item b{
  width:30px;height:30px;display:grid;place-items:center;
  border-radius:10px;background:#171329;color:#777187;
  font-size:8px;border:1px solid rgba(255,255,255,.06);
}
.tv-progress-item.active{color:#fff}
.tv-progress-item.active b{
  color:#fff;background:linear-gradient(135deg,#7c3aed,#a78bfa);
  border-color:rgba(196,181,253,.35);box-shadow:0 8px 22px rgba(124,58,237,.28);
}
.tv-progress-strip>i{
  flex:1;height:1px;min-width:22px;margin:0 8px;
  background:linear-gradient(90deg,rgba(167,139,250,.45),rgba(255,255,255,.06));
}
.tv-top-badge{
  position:relative;z-index:2;
  width:220px;margin:-45px 36px 18px auto;
  padding:14px 16px;box-sizing:border-box;
  border:1px solid rgba(134,239,172,.20);
  border-radius:16px;background:rgba(8,10,18,.88);
  box-shadow:0 16px 40px rgba(0,0,0,.3);
  backdrop-filter:blur(12px);
}
.tv-top-badge span{font-size:20px;float:left;margin-right:10px}
.tv-top-badge strong,.tv-top-badge small{display:block}
.tv-top-badge strong{font-size:8px;letter-spacing:.12em;color:#86efac}
.tv-top-badge small{margin-top:4px;color:#777287;font-size:7px;line-height:1.45}
.tv-back{position:absolute;top:28px;right:28px}
.tv-form{gap:20px}
.tv-card{
  padding:27px;
  border-radius:22px;
  border-color:rgba(255,255,255,.09);
  background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018));
}
.tv-card-title>b{
  width:46px;height:46px;border-radius:15px;
  background:linear-gradient(135deg,#7c3aed,#4f46e5);
  color:#fff;border:0;
}
.tv-card-title h2{font-size:18px}
.tv-card-title p{font-size:9px}
.tv-card input,.tv-card select{
  min-height:48px;border-radius:13px;background:#090815;
}
.tv-card label{font-size:9px}
.tv-choice{min-height:104px;border-radius:17px}
.tv-choice.active{
  background:linear-gradient(135deg,rgba(124,58,237,.22),rgba(79,70,229,.08));
  box-shadow:0 14px 35px rgba(76,29,149,.16);
}
.tv-submit{
  padding:22px 24px;border-radius:18px;
  background:linear-gradient(100deg,rgba(124,58,237,.18),rgba(255,255,255,.025));
}
@media(max-width:760px){
  .tutor-verification-page{padding:18px 14px 55px}
  .tv-top{padding:26px 22px;min-height:0}
  .tv-top h1{font-size:31px}
  .tv-progress-strip{overflow:auto}
  .tv-progress-item span{display:none}
  .tv-top-badge{width:auto;margin:-10px 12px 18px}
  .tv-back{position:static;margin-top:16px}
}
`;




const CHAT_FEATURE_CSS = `
.learnora-chat-inbox{display:grid;grid-template-columns:minmax(250px,330px) minmax(0,1fr);gap:12px;min-height:620px}
.chat-conversation-list,.chat-conversation-window{min-width:0;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(255,255,255,.025);overflow:hidden}
.chat-conversation-list{display:flex;flex-direction:column}
.chat-inbox-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px;border-bottom:1px solid rgba(255,255,255,.07)}
.chat-inbox-heading strong{display:block;font-size:12px;color:#fff}.chat-inbox-heading span{display:block;margin-top:4px;color:#777287;font-size:9px}
.chat-inbox-heading b{padding:6px 8px;border-radius:999px;background:rgba(239,68,68,.12);color:#fca5a5;font-size:8px}
.chat-conversation-item{width:100%;display:flex;align-items:center;gap:10px;padding:12px;border:0;border-bottom:1px solid rgba(255,255,255,.045);background:transparent;color:#fff;text-align:left;cursor:pointer}
.chat-conversation-item:hover,.chat-conversation-item.active{background:rgba(124,92,255,.10)}
.chat-conversation-avatar{position:relative;width:39px;height:39px;flex:0 0 39px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#6d3df0,#8b5cf6);font-size:13px;font-weight:900}
.chat-conversation-avatar i{position:absolute;right:-2px;bottom:-2px;width:9px;height:9px;border-radius:50%;background:#555;border:2px solid #10101c}.chat-conversation-avatar i.online{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.7)}
.chat-conversation-main{min-width:0;flex:1}.chat-conversation-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.chat-conversation-top strong{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-conversation-top small{color:#706a7d;font-size:8px;white-space:nowrap}
.chat-conversation-subject{display:block;margin-top:3px;color:#a78bfa;font-size:8px}.chat-conversation-preview{display:block;margin-top:4px;color:#777287;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-unread-badge{min-width:18px;height:18px;padding:0 5px;display:grid;place-items:center;border-radius:999px;background:#ef4444;color:#fff;font-size:8px}
.chat-inbox-empty,.chat-select-empty{margin:auto;padding:30px;text-align:center;color:#777287;font-size:10px;line-height:1.6}.chat-inbox-empty div,.chat-select-empty div{font-size:27px;margin-bottom:8px}.chat-inbox-empty strong,.chat-select-empty strong{display:block;color:#fff;font-size:12px;margin-bottom:4px}.chat-inbox-empty span,.chat-select-empty span{display:block}
.chat-conversation-window .tutor-chat-shell{height:620px;border:0;border-radius:0}
.chat-typing-indicator{display:block;margin-top:5px;color:#a78bfa;font-size:9px;font-weight:800}
.chat-online i:not(.peer-online){background:#555;box-shadow:none}.chat-online i.peer-online{background:#22c55e;box-shadow:0 0 9px rgba(34,197,94,.8)}
@media(max-width:850px){.learnora-chat-inbox{grid-template-columns:1fr}.chat-conversation-window{min-height:560px}.chat-conversation-list{max-height:390px}}


/* =========================================================
   CHAT UI POLISH — SCOPED ONLY TO THE CHAT INBOX
   Keeps all booking/session logic unchanged.
========================================================= */
.learnora-chat-inbox{
  position:relative;
  grid-template-columns:360px minmax(0,1fr);
  gap:14px;
  min-height:650px;
}
.learnora-chat-inbox .chat-conversation-list,
.learnora-chat-inbox .chat-conversation-window{
  border:1px solid rgba(167,139,250,.15);
  background:linear-gradient(145deg,rgba(21,20,38,.96),rgba(10,10,22,.96));
  box-shadow:0 22px 60px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.035);
  backdrop-filter:blur(18px);
}
.learnora-chat-inbox .chat-conversation-list{
  position:relative;
  min-height:650px;
  overflow:hidden;
}
.learnora-chat-inbox .chat-inbox-heading{
  min-height:74px;
  padding:17px 18px;
  background:linear-gradient(180deg,rgba(124,92,255,.10),rgba(124,92,255,.025));
  border-bottom:1px solid rgba(255,255,255,.07);
}
.learnora-chat-inbox .chat-inbox-heading strong{
  font-size:13px;
  letter-spacing:-.1px;
}
.learnora-chat-inbox .chat-inbox-heading span{
  font-size:9px;
  color:#817b91;
}
.learnora-chat-inbox .chat-inbox-heading b{
  padding:7px 9px;
  background:rgba(239,68,68,.12);
  border:1px solid rgba(239,68,68,.18);
  color:#ffb0b0;
  box-shadow:0 6px 18px rgba(239,68,68,.08);
}
.learnora-chat-inbox .chat-conversation-item{
  position:relative;
  min-height:76px;
  padding:13px 15px;
  gap:12px;
  border-bottom:1px solid rgba(255,255,255,.045);
  transition:background .18s ease,transform .18s ease,box-shadow .18s ease;
}
.learnora-chat-inbox .chat-conversation-item:hover{
  background:rgba(124,92,255,.065);
}
.learnora-chat-inbox .chat-conversation-item.active{
  background:linear-gradient(100deg,rgba(124,92,255,.18),rgba(124,92,255,.055));
  box-shadow:inset 3px 0 0 #8b5cf6;
}
.learnora-chat-inbox .chat-conversation-item.active:after{
  content:"";
  position:absolute;
  right:10px;
  top:12px;
  bottom:12px;
  width:1px;
  background:linear-gradient(180deg,transparent,rgba(167,139,250,.35),transparent);
}
.learnora-chat-inbox .chat-conversation-avatar{
  width:46px;
  height:46px;
  flex-basis:46px;
  border-radius:15px;
  background:linear-gradient(145deg,#714cff,#4c35b8);
  border:1px solid rgba(196,181,253,.20);
  box-shadow:0 10px 24px rgba(76,53,184,.22);
  font-size:15px;
}
.learnora-chat-inbox .chat-conversation-avatar i{
  width:10px;
  height:10px;
  right:-1px;
  bottom:-1px;
  border:2px solid #111021;
}
.learnora-chat-inbox .chat-conversation-main{padding-right:4px}
.learnora-chat-inbox .chat-conversation-top strong{
  font-size:11.5px;
  color:#f8f6ff;
}
.learnora-chat-inbox .chat-conversation-top small{
  font-size:8px;
  color:#716b80;
}
.learnora-chat-inbox .chat-conversation-subject{
  margin-top:4px;
  color:#b9a8ff;
  font-size:8px;
  font-weight:800;
  letter-spacing:.2px;
}
.learnora-chat-inbox .chat-conversation-preview{
  margin-top:5px;
  color:#817b91;
  font-size:9px;
}
.learnora-chat-inbox .chat-unread-badge{
  min-width:20px;
  height:20px;
  padding:0 6px;
  background:linear-gradient(135deg,#ef4444,#dc2626);
  box-shadow:0 6px 16px rgba(239,68,68,.20);
  font-size:8px;
}
.learnora-chat-inbox .chat-conversation-window{
  min-height:650px;
  overflow:hidden;
}
.learnora-chat-inbox .chat-conversation-window .tutor-chat-shell{
  max-width:none;
  width:100%;
  height:650px;
  min-height:650px;
  border:0;
  border-radius:0;
  background:linear-gradient(180deg,rgba(18,17,31,.98),rgba(9,9,19,.98));
  box-shadow:none;
}
.learnora-chat-inbox .tutor-chat-header{
  min-height:88px;
  padding:16px 20px;
  gap:13px;
  background:linear-gradient(180deg,rgba(124,92,255,.09),rgba(255,255,255,.012));
  border-bottom:1px solid rgba(255,255,255,.07);
}
.learnora-chat-inbox .chat-tutor-avatar{
  width:52px;
  height:52px;
  border-radius:17px;
  background:linear-gradient(145deg,#7c52ff,#4f35c9);
  border:1px solid rgba(196,181,253,.20);
  box-shadow:0 12px 30px rgba(76,53,184,.25);
  font-size:20px;
}
.learnora-chat-inbox .chat-tutor-info h2{
  margin-bottom:4px;
  font-size:16px;
  letter-spacing:-.15px;
}
.learnora-chat-inbox .chat-tutor-info p{
  margin-bottom:6px;
  color:#918a9f;
  font-size:10px;
}
.learnora-chat-inbox .chat-online{
  display:inline-flex;
  padding:4px 8px;
  border:1px solid rgba(134,239,172,.12);
  border-radius:999px;
  background:rgba(34,197,94,.055);
  color:#91e9ad;
  font-size:8px;
  letter-spacing:.15px;
}
.learnora-chat-inbox .chat-online i{
  width:6px;
  height:6px;
}
.learnora-chat-inbox .chat-typing-indicator{
  margin-top:5px;
  color:#b8a5ff;
  font-size:8px;
}
.learnora-chat-inbox .chat-messages{
  padding:24px 25px 18px;
  gap:10px;
  background:
    radial-gradient(circle at 80% 10%,rgba(124,92,255,.055),transparent 30%),
    radial-gradient(circle at 10% 90%,rgba(68,112,255,.035),transparent 32%);
}
.learnora-chat-inbox .chat-message{
  animation:learnoraChatIn .18s ease-out;
}
@keyframes learnoraChatIn{
  from{opacity:0;transform:translateY(4px)}
  to{opacity:1;transform:translateY(0)}
}
.learnora-chat-inbox .chat-bubble{
  max-width:min(72%,540px);
  padding:10px 13px 8px;
  border-radius:16px;
  background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.075);
  box-shadow:0 7px 20px rgba(0,0,0,.10);
}
.learnora-chat-inbox .chat-message.student .chat-bubble{
  background:linear-gradient(135deg,rgba(124,92,255,.31),rgba(95,68,205,.22));
  border-color:rgba(167,139,250,.24);
  box-shadow:0 9px 24px rgba(76,53,184,.13);
}
.learnora-chat-inbox .chat-bubble p{
  color:#f3f0fb;
  font-size:12px;
  line-height:1.58;
}
.learnora-chat-inbox .chat-bubble small{
  margin-top:6px;
  color:#aaa2b5;
  font-size:8px;
}
.learnora-chat-inbox .chat-input-row{
  gap:9px;
  padding:13px 15px;
  background:rgba(8,8,17,.88);
  border-top:1px solid rgba(255,255,255,.075);
}
.learnora-chat-inbox .chat-input-row input{
  height:44px;
  padding:0 15px;
  border:1px solid rgba(255,255,255,.10);
  border-radius:13px;
  background:#0c0b18;
  color:#fff;
  font-size:11px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.025);
  transition:border-color .18s ease,box-shadow .18s ease;
}
.learnora-chat-inbox .chat-input-row input:focus{
  border-color:rgba(139,92,246,.48);
  box-shadow:0 0 0 3px rgba(124,92,255,.09),inset 0 1px 0 rgba(255,255,255,.025);
}
.learnora-chat-inbox .chat-attach{
  width:44px;
  height:44px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:13px;
  background:rgba(255,255,255,.045);
  color:#c9c2d6;
  transition:.18s ease;
}
.learnora-chat-inbox .chat-attach:hover{
  background:rgba(124,92,255,.12);
  border-color:rgba(167,139,250,.25);
}
.learnora-chat-inbox .chat-send{
  min-width:78px;
  height:44px;
  padding:0 15px;
  border-radius:13px;
  background:linear-gradient(135deg,#7651ff,#613be8);
  border:1px solid rgba(196,181,253,.16);
  box-shadow:0 10px 24px rgba(92,59,232,.22);
  font-size:10px;
  transition:transform .18s ease,box-shadow .18s ease,opacity .18s ease;
}
.learnora-chat-inbox .chat-send:hover:not(:disabled){
  transform:translateY(-1px);
  box-shadow:0 13px 28px rgba(92,59,232,.30);
}
.learnora-chat-inbox .chat-send:disabled{opacity:.55}
.learnora-chat-inbox .chat-inbox-empty,
.learnora-chat-inbox .chat-select-empty{
  padding:34px 24px;
  color:#777287;
}
.learnora-chat-inbox .chat-inbox-empty div,
.learnora-chat-inbox .chat-select-empty div{
  width:58px;
  height:58px;
  display:grid;
  place-items:center;
  margin:0 auto 12px;
  border-radius:18px;
  background:rgba(124,92,255,.10);
  border:1px solid rgba(167,139,250,.15);
  font-size:25px;
}
.learnora-chat-inbox .chat-inbox-empty strong,
.learnora-chat-inbox .chat-select-empty strong{
  font-size:12px;
}
@media(max-width:950px){
  .learnora-chat-inbox{grid-template-columns:300px minmax(0,1fr)}
}
@media(max-width:760px){
  .learnora-chat-inbox{grid-template-columns:1fr;min-height:0}
  .learnora-chat-inbox .chat-conversation-list{min-height:0;max-height:330px}
  .learnora-chat-inbox .chat-conversation-window{min-height:560px}
  .learnora-chat-inbox .chat-conversation-window .tutor-chat-shell{height:560px;min-height:560px}
  .learnora-chat-inbox .chat-messages{padding:18px 15px 14px}
  .learnora-chat-inbox .chat-bubble{max-width:84%}
}
`;

const ROLE_DASHBOARD_CSS = `
.role-dashboard{
  min-height:100vh;
  display:grid;
  grid-template-columns:250px minmax(0,1fr);
  background:#070713;
  color:#f7f5ff;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
.role-sidebar{
  position:sticky;
  top:0;
  height:100vh;
  display:flex;
  flex-direction:column;
  padding:24px 15px;
  border-right:1px solid rgba(255,255,255,.08);
  background:#0b0a18;
}
.role-sidebar .learnora-logo{margin-bottom:22px}
.role-account{
  display:flex;
  align-items:center;
  gap:11px;
  padding:13px;
  margin-bottom:18px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:15px;
  background:#111021;
}
.role-account strong{font-size:12px}.role-account small{display:block;margin-top:3px;color:#777287;font-size:9px}
.role-avatar{
  width:43px;height:43px;display:grid;place-items:center;flex:none;
  border-radius:12px;background:linear-gradient(135deg,#6d3df0,#9b72ff);font-weight:850;
}
.role-sidebar nav{display:grid;gap:5px}
.role-nav{
  width:100%;padding:11px 12px;border:1px solid transparent;border-radius:11px;
  background:transparent;color:#9793a6;text-align:left;font-size:12px;
}
.role-nav.active,.role-nav:hover{color:#fff;background:rgba(109,61,240,.13);border-color:rgba(139,92,246,.25)}
.role-logout{
  margin-top:auto;padding:11px;border:1px solid rgba(255,255,255,.08);border-radius:11px;
  background:#141226;color:#aaa5b6;font-size:11px;font-weight:750;
}
.role-main{width:100%;max-width:1250px;margin:0 auto;padding:42px 44px 70px}
.role-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.role-kicker{color:#a78bfa;font-size:9px;font-weight:850;letter-spacing:.14em}
.role-header h1{margin:7px 0;font-size:36px;letter-spacing:-.035em}
.role-header p,.role-panel p{margin:0;color:#858193;font-size:12px;line-height:1.6}
.role-status,.role-badge,.role-availability{
  display:inline-flex;align-items:center;padding:8px 11px;border-radius:999px;
  border:1px solid rgba(255,255,255,.08);background:#111021;color:#aaa5b6;font-size:10px;font-weight:750;
}
.role-availability.on{color:#86efac;background:rgba(34,197,94,.07);border-color:rgba(34,197,94,.18)}
.role-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin-bottom:18px}
.role-stats>div{
  padding:16px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.035)
}
.role-stats span,.role-stats small{display:block;color:#817d90;font-size:9px}
.role-stats strong{display:block;margin:8px 0 3px;font-size:23px}
.role-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:17px}
.role-panel{
  padding:19px;margin-bottom:17px;border:1px solid rgba(255,255,255,.08);
  border-radius:18px;background:rgba(255,255,255,.035)
}
.role-panel h2{margin:5px 0;font-size:17px}.role-panel-title{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:15px}
.role-secondary,.role-primary,.role-reject{
  padding:9px 12px;border-radius:10px;font-size:10px;font-weight:750;
}
.role-secondary{border:1px solid rgba(255,255,255,.09);background:#151329;color:#d4d0df}
.role-primary{border:1px solid rgba(139,92,246,.2);background:linear-gradient(135deg,#6d3df0,#8057f6);color:#fff}
.role-primary.small{padding:8px 11px}
.role-detail-box{
  display:grid;gap:8px;margin:14px 0;padding:13px;border-radius:12px;
  background:rgba(124,92,255,.06);color:#aaa5b6;font-size:10px
}
.role-progress-row{margin-top:17px}.role-progress-row>div:first-child,.student-progress>div:first-child,.subject-progress>div:first-child{display:flex;justify-content:space-between;margin-bottom:7px;color:#aaa5b6;font-size:10px}
.role-bar{height:7px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.07)}
.role-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#6d3df0,#a78bfa)}
.role-tutor-meta{margin:14px 0;color:#aaa5b6;font-size:10px}.role-badge.green{color:#86efac;background:rgba(34,197,94,.08)}.role-badge.red{color:#fca5a5;background:rgba(239,68,68,.08)}
.role-list{display:grid;gap:10px}.role-request,.role-session{display:flex;align-items:center;gap:13px;padding:13px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(255,255,255,.025)}
.role-grow{flex:1;min-width:0}.role-grow strong,.role-session strong{font-size:12px}.role-grow p,.role-session p{margin-top:4px}
.role-actions{display:flex;gap:7px}.role-reject{border:1px solid rgba(239,68,68,.15);background:rgba(239,68,68,.06);color:#fca5a5}
.student-progress{width:180px}.subject-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.subject-progress{padding:12px;border-radius:12px;background:rgba(255,255,255,.025)}
@media(max-width:900px){.role-dashboard{grid-template-columns:1fr}.role-sidebar{display:none}.role-main{padding:30px 20px 60px}.role-stats,.role-grid-2{grid-template-columns:1fr 1fr}}
@media(max-width:600px){.role-main{padding:22px 14px 50px}.role-header{align-items:flex-start;flex-direction:column}.role-stats,.role-grid-2,.subject-grid{grid-template-columns:1fr}.role-request,.role-session{align-items:flex-start;flex-wrap:wrap}.role-actions{width:100%;justify-content:flex-end}.student-progress{width:100%}}
`;


/* =====================================================
   ADMIN DASHBOARD — TUTOR VERIFICATION
===================================================== */

function App() {
  const [selectedRole, setSelectedRole] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [user, setUser] = useState({ uid: "", name: "Student", email: "", role: null });
  const manualLoginRef = useRef(false);

  // Every app launch starts at the role-selection Home screen.
  // A previously authenticated browser session must never force the app
  // directly into one person's dashboard. Each person selects their own role
  // and explicitly logs in with their own Firebase account.
  useEffect(() => {
    let firstAuthEvent = true;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Ignore/clear the persisted Firebase session that exists when the app
      // is opened or refreshed. This keeps the app multi-user and role-first.
      if (firstAuthEvent) {
        firstAuthEvent = false;

        if (firebaseUser && !manualLoginRef.current) {
          try {
            await signOut(auth);
          } catch (error) {
            console.error("Initial session clear error:", error);
          }
        }

        setLoggedIn(false);
        setSelectedRole(null);
        setUser({ uid: "", name: "Student", email: "", role: null });
        setAuthChecking(false);
        return;
      }

      // During an explicit login, handleLogin() owns the login result.
      // Do not redirect based on an intermediate auth-state event.
      if (manualLoginRef.current) {
        setAuthChecking(false);
        return;
      }

      if (!firebaseUser) {
        setLoggedIn(false);
        setSelectedRole(null);
        setUser({ uid: "", name: "Student", email: "", role: null });
        setAuthChecking(false);
        return;
      }

      try {
        const profileSnap = await getDoc(doc(db, "users", firebaseUser.uid));
        const profile = profileSnap.exists() ? profileSnap.data() : {};
        const role = profile.role;

        if (!ROLES[role]) {
          await signOut(auth);
          setLoggedIn(false);
          setSelectedRole(null);
          setUser({ uid: "", name: "Student", email: "", role: null });
          setAuthChecking(false);
          return;
        }

        setUser({
          uid: firebaseUser.uid,
          name: profile.fullName || firebaseUser.displayName || "User",
          email: profile.email || firebaseUser.email || "",
          role,
        });
        setLoggedIn(true);
        setSelectedRole(null);
      } catch (error) {
        console.error("Auth state error:", error);
        setLoggedIn(false);
        setSelectedRole(null);
        setUser({ uid: "", name: "Student", email: "", role: null });
      } finally {
        setAuthChecking(false);
      }
    });

    return () => unsubscribe();
  }, []);

  function handleLogin(userData) {
    manualLoginRef.current = false;

    setUser({
      uid: userData?.uid || auth.currentUser?.uid || "",
      name: userData?.name || "Student",
      email: userData?.email || "",
      role: userData?.role || selectedRole,
    });
    setLoggedIn(true);
  }

  async function handleLogout() {
    // STRICT LOGOUT: sign out from Firebase first, then clear local app state.
    // No session, chat, video, booking, or dashboard UI logic is changed.
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setLoggedIn(false);
      setSelectedRole(null);
      setUser({ uid: "", name: "Student", email: "", role: null });
      manualLoginRef.current = false;
    }
  }

  if (authChecking) {
    return (
      <div className="home-page">
        <main className="home-content">
          <div className="eyebrow">✦ LATHSO</div>
          <h1>Loading <span>Lathso...</span></h1>
          <p className="home-description">Connecting your account securely.</p>
        </main>
      </div>
    );
  }

  if (loggedIn && user.role === "student") {
    return <StudentDashboard key={user.uid} onLogout={handleLogout} />;
  }

  if (loggedIn && user.role === "parent") {
    return <ParentDashboard key={user.uid} onLogout={handleLogout} />;
  }

  if (loggedIn && user.role === "tutor") {
    return <TutorDashboard key={user.uid} onLogout={handleLogout} />;
  }

  if (selectedRole) {
    return (
      <Login
        role={selectedRole}
        onBack={() => setSelectedRole(null)}
        onLogin={handleLogin}
        manualLoginRef={manualLoginRef}
      />
    );
  }

  return <Home onSelectRole={setSelectedRole} />;
}

export default App;