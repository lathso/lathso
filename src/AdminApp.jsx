import React, { useEffect, useState } from "react";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, getIdTokenResult } from "firebase/auth";
import {
  collection,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  doc,
} from "firebase/firestore";
import { auth, db } from "./firebase.js";

export default function Admin() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [page, setPage] = useState("dashboard");
  const [applications, setApplications] = useState([]);
  const [selectedTutor, setSelectedTutor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // PAYMENT FRONTEND ONLY
  // Real payment data, gateway verification, payouts and commission writes
  // will be connected in the final backend phase. No fake values are used.
  const [paymentPage, setPaymentPage] = useState("overview");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoggedIn(false);
        setAuthChecking(false);
        return;
      }

      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        const profile = profileSnap.exists() ? profileSnap.data() : null;

        // Admin access is accepted from either:
        // 1) the existing users/{uid}.role === "admin" profile, or
        // 2) Firebase Auth custom claims used by the Firestore Admin Rules.
        // This keeps the separate Admin panel working without changing its UI
        // or the normal Student/Parent/Tutor session flow.
        const tokenResult = await getIdTokenResult(user);
        const claims = tokenResult?.claims || {};
        const isAdmin =
          profile?.role === "admin" ||
          claims.admin === true ||
          claims.role === "admin";

        if (isAdmin) {
          setLoggedIn(true);
        } else {
          await signOut(auth);
          setLoggedIn(false);
        }
      } catch (error) {
        console.error("Admin auth check error:", error);
        setLoggedIn(false);
      } finally {
        setAuthChecking(false);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!loggedIn) return;

    setLoading(true);

    const unsubscribe = onSnapshot(
      collection(db, "tutorApplications"),
      (snapshot) => {
        const items = snapshot.docs.map((item) => {
          const data = item.data();

          return {
            id: item.id,
            tutorId: data.tutorId || data.userId || "",
            name: data.name || data.fullName || "Tutor",
            email: data.email || "",
            phone: data.phone || "",
            subject: data.subject || "",
            qualification: data.qualification || "",
            experience: data.experience || "",
            location: data.location || "",
            classes: data.classes || "",
                                                            status:
              typeof data.status === "string" && data.status.trim()
                ? data.status.trim()
                : "Pending",
            submittedAt: data.submittedAt || "Recently submitted",
            reviewedAt: data.reviewedAt || "",
          };
        });

        setApplications(items);
        setLoading(false);
      },
      (error) => {
        console.error("Tutor applications listener error:", error);
        alert("Unable to load tutor applications. Please check Firestore Rules.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [loggedIn]);

  async function login(email, password) {
    if (!email.trim() || !password.trim()) {
      alert("Please enter Admin email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      console.error("Admin login error:", error);

      const message =
        error?.code === "auth/invalid-credential"
          ? "Invalid Admin email or password."
          : error?.code === "auth/user-not-found"
          ? "Admin account was not found."
          : error?.message || "Admin login failed.";

      alert(message);
    }
  }

  async function logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Admin logout error:", error);
    }

    setLoggedIn(false);
    setSelectedTutor(null);
    setPage("dashboard");
  }

  async function updateTutorStatus(id, status, rejectionReason = "") {
    const application = applications.find((item) => item.id === id);

    if (!application) {
      alert("Tutor application not found.");
      return;
    }

    if (!application.tutorId) {
      alert("This application has no Firebase tutor UID.");
      return;
    }

    if (!["Approved", "Rejected"].includes(status)) {
      alert("Invalid tutor verification status.");
      return;
    }

    if (application.status !== "Pending") {
      alert(`This tutor application is already ${application.status}.`);
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert("Your Admin login session has expired. Please login again.");
      return;
    }

    try {
      setStatusUpdating(true);
      const reviewerId = currentUser.uid;
      const rejectionText =
        status === "Rejected"
          ? (rejectionReason.trim() || "Tutor verification was not approved.")
          : "";

      const applicationRef = doc(db, "tutorApplications", id);
      const userRef = doc(db, "users", application.tutorId);
      const batch = writeBatch(db);

      batch.update(applicationRef, {
        status,
        reviewedAt: serverTimestamp(),
        reviewedBy: reviewerId,
        rejectionReason: rejectionText,
        updatedAt: serverTimestamp(),
      });

      batch.set(
        userRef,
        {
          verified: status === "Approved",
          available: status === "Approved",
          verificationStatus: status,
          rejectionReason: rejectionText,
          reviewedAt: serverTimestamp(),
          reviewedBy: reviewerId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();
      setSelectedTutor(null);
    } catch (error) {
      console.error("Tutor status update error:", error);
      alert(
        error?.code === "permission-denied"
          ? "Permission denied. Check your Firestore Admin Rules."
          : error?.message || "Could not update tutor status."
      );
    } finally {
      setStatusUpdating(false);
    }
  }


  if (authChecking) {
    return (
      <div className="login-page">
        <style>{CSS}</style>
        <div className="login-card">
          <div className="login-logo">L</div>
          <span className="eyebrow">LATHSO ADMIN</span>
          <h1>Checking Admin access...</h1>
          <p>Connecting securely to Lathso.</p>
        </div>
      </div>
    );
  }

  if (!loggedIn) {
    return <AdminLogin onLogin={login} />;
  }

  const pending = applications.filter((x) => x.status === "Pending");
  const approved = applications.filter((x) => x.status === "Approved");
  const rejected = applications.filter((x) => x.status === "Rejected");

  let content;

  if (page === "dashboard") {
    content = (
      <Dashboard
        applications={applications}
        onReview={setSelectedTutor}
        onOpenVerification={() => setPage("verification")}
      />
    );
  }

  if (page === "verification" || page === "applications") {
    content = (
      <ApplicationPage
        title={page === "verification" ? "Tutor Verification" : "All Applications"}
        subtitle={
          page === "verification"
            ? "Review tutor details and complete manual phone verification."
            : "View every tutor application submitted to Lathso."
        }
        applications={applications}
        onReview={setSelectedTutor}
      />
    );
  }

  if (page === "approved") {
    content = (
      <ApplicationPage
        title="Approved Tutors"
        subtitle="Tutors approved by Lathso Admin."
        applications={approved}
        onReview={setSelectedTutor}
      />
    );
  }

  if (page === "rejected") {
    content = (
      <ApplicationPage
        title="Rejected Tutors"
        subtitle="Tutor applications rejected during verification."
        applications={rejected}
        onReview={setSelectedTutor}
      />
    );
  }

  if (page === "users") {
    content = <UsersPage applications={applications} />;
  }

  if (page === "reports") {
    content = <ReportsPage applications={applications} />;
  }

  if (page === "settings") {
    content = <SettingsPage />;
  }

  if (page === "payments") {
    content = <PaymentsPage />;
  }

  return (
    <div className="admin-root">
      <style>{CSS}</style>

      <header className="admin-topbar">
        <button className="admin-brand" onClick={() => setPage("dashboard")}>
          <span className="admin-logo">L</span>
          <span>
            <strong>learnora</strong>
            <small>Administration</small>
          </span>
        </button>

        <div className="top-actions">
          <span className="admin-pill">🛡️ ADMIN DESK</span>
          <button className="logout" onClick={logout}>Logout</button>
        </div>
      </header>

      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-account">
            <div className="admin-avatar">A</div>
            <div>
              <strong>Lathso Admin</strong>
              <small>Super Administrator</small>
            </div>
          </div>

          <NavGroup title="MAIN">
            <AdminNav icon="📊" text="Dashboard" active={page === "dashboard"} onClick={() => setPage("dashboard")} />
            <AdminNav
              icon="🛡️"
              text="Tutor Verification"
              count={pending.length}
              active={page === "verification"}
              onClick={() => setPage("verification")}
            />
            <AdminNav icon="📄" text="Applications" active={page === "applications"} onClick={() => setPage("applications")} />
          </NavGroup>

          <NavGroup title="VERIFICATION">
            <AdminNav icon="✅" text="Approved Tutors" active={page === "approved"} onClick={() => setPage("approved")} />
            <AdminNav icon="❌" text="Rejected Tutors" active={page === "rejected"} onClick={() => setPage("rejected")} />
          </NavGroup>

          <NavGroup title="PLATFORM">
            <AdminNav icon="👥" text="Users" active={page === "users"} onClick={() => setPage("users")} />
            <AdminNav icon="📈" text="Reports" active={page === "reports"} onClick={() => setPage("reports")} />
            <AdminNav icon="💳" text="Payments" active={page === "payments"} onClick={() => setPage("payments")} />
            <AdminNav icon="⚙️" text="Settings" active={page === "settings"} onClick={() => setPage("settings")} />
          </NavGroup>
        </aside>

        <main className="admin-content">
          {loading && (
            <div className="info-banner">
              <strong>Loading live tutor applications…</strong>
              <span>Fetching the latest data from Firestore.</span>
            </div>
          )}
          {content}
        </main>
      </div>

      {selectedTutor && (
        <TutorReview
          tutor={selectedTutor}
          busy={statusUpdating}
          onClose={() => !statusUpdating && setSelectedTutor(null)}
          onApprove={() => updateTutorStatus(selectedTutor.id, "Approved")}
          onReject={(reason) => updateTutorStatus(selectedTutor.id, "Rejected", reason)}
        />
      )}
    </div>
  );
}

function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="login-page">
      <style>{CSS}</style>

      <div className="login-card">
        <div className="login-logo">L</div>
        <span className="eyebrow">LATHSO ADMIN</span>
        <h1>Admin Login</h1>
        <p>Manage tutor verification and Lathso platform operations.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLogin(email, password);
          }}
        >
          <label>
            Admin Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@learnora.com"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </label>

          <button className="login-button" type="submit">
            Login to Admin Desk →
          </button>
        </form>

        <div className="demo-note">
          <strong>SECURE ADMIN ACCESS</strong>
          <span>Use the Admin Firebase Authentication account.</span>
        </div>
      </div>
    </div>
  );
}

function NavGroup({ title, children }) {
  return (
    <>
      <div className="menu-title">{title}</div>
      <nav>{children}</nav>
    </>
  );
}

function AdminNav({ icon, text, active, count, onClick }) {
  return (
    <button className={`admin-nav ${active ? "active" : ""}`} onClick={onClick}>
      <span>{icon}</span>
      <span>{text}</span>
      {count > 0 && <b>{count}</b>}
    </button>
  );
}

function Dashboard({ applications, onReview, onOpenVerification }) {
  const pending = applications.filter((x) => x.status === "Pending");
  const approved = applications.filter((x) => x.status === "Approved");

  return (
    <>
      <PageHeader
        eyebrow="LATHSO ADMIN"
        title="Admin Dashboard"
        subtitle="Manage tutor verification and platform operations."
      />

      <div className="stats-grid">
        <Stat icon="🛡️" label="Pending Verification" value={pending.length} note="Needs review" />
        <Stat icon="📞" label="Phone Verification" value={pending.length} note="Admin call required" />
        <Stat icon="👥" label="Tutor Applications" value={applications.length} note="Firestore submissions" />
        <Stat icon="✅" label="Approved Tutors" value={approved.length} note="Verified tutors" />
      </div>

      <div className="two-column">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Verification Queue</h2>
              <p>Applications waiting for Admin action.</p>
            </div>
            <button className="primary small" onClick={onOpenVerification}>View All →</button>
          </div>

          <div className="list">
            {pending.slice(0, 5).map((item) => (
              <ApplicationRow key={item.id} application={item} onReview={() => onReview(item)} />
            ))}

            {!pending.length && <Empty text="No pending tutor applications." />}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Verification Flow</h2>
              <p>Required before tutor approval.</p>
            </div>
          </div>

          <div className="flow">
            <Flow n="01" title="Tutor Profile" text="Personal and teaching details" />
            <Flow n="02" title="Tutor Details" text="Review submitted profile information" />
            <Flow n="03" title="Phone Verification" text="Call tutor and confirm details" />
            <Flow n="04" title="Admin Approval" text="Verified tutor status" />
          </div>
        </div>
      </div>
    </>
  );
}

function ApplicationPage({ title, subtitle, applications, onReview }) {
  return (
    <>
      <PageHeader eyebrow="TUTOR VERIFICATION" title={title} subtitle={subtitle} />

      <div className="info-banner">
        <strong>Required before approval</strong>
        <span>📞 Admin phone verification of submitted tutor details</span>
      </div>

      <div className="panel">
        <div className="list">
          {applications.map((item) => (
            <ApplicationRow key={item.id} application={item} onReview={() => onReview(item)} large />
          ))}
          {!applications.length && <Empty text="No applications found." />}
        </div>
      </div>
    </>
  );
}

function ApplicationRow({ application, onReview, large }) {
  return (
    <div className={`application-row ${large ? "large" : ""}`}>
      <div className="person-avatar">{application.name.charAt(0)}</div>

      <div className="person">
        <strong>{application.name}</strong>
        <span>{application.subject} • {application.qualification}</span>
        <small>{application.experience} • {application.location}</small>
      </div>

      <div className="proof-summary">
        <span>📞 Manual phone verification</span>
        <span>🆔 UID: {application.tutorId || "Not available"}</span>
      </div>

      <Status status={application.status} />

      <button className="review" onClick={onReview}>Review →</button>
    </div>
  );
}

function TutorReview({ tutor, onClose, onApprove, onReject, busy = false }) {
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="review-modal">
        <button className="close" onClick={onClose}>×</button>

        <span className="eyebrow">TUTOR APPLICATION REVIEW</span>

        <div className="review-heading">
          <div className="big-avatar">{tutor.name.charAt(0)}</div>
          <div>
            <h2>{tutor.name}</h2>
            <p>{tutor.subject} • {tutor.qualification}</p>
          </div>
          <Status status={tutor.status} />
        </div>

        <ReviewSection title="👤 Tutor Profile">
          <div className="detail-grid">
            <Detail label="Firebase UID" value={tutor.tutorId} />
            <Detail label="Email" value={tutor.email} />
            <Detail label="Phone" value={tutor.phone} />
            <Detail label="Subject" value={tutor.subject} />
            <Detail label="Experience" value={tutor.experience} />
            <Detail label="Location" value={tutor.location} />
            <Detail label="Classes" value={tutor.classes} />
          </div>
        </ReviewSection>

        <ReviewSection title="📞 Manual Verification">
          <div className="verification-card">
            <div className="verification-icon">📞</div>
            <div>
              <strong>Admin Phone Verification</strong>
              <span>Call the tutor using the submitted phone number and confirm identity, qualification, experience, subject and teaching details.</span>
            </div>
          </div>
        </ReviewSection>

        {tutor.status === "Pending" && (
          <div className="modal-actions">
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt(
                  "Reason for rejection (optional):",
                  rejectReason
                );
                if (reason === null) return;
                setRejectReason(reason);
                if (window.confirm("Reject this tutor application?")) onReject(reason);
              }}
            >
              {busy ? "Updating…" : "❌ Reject Application"}
            </button>

            <button
              className="approve"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Approve this tutor as a verified tutor?")) onApprove();
              }}
            >
              {busy ? "Updating…" : "✅ Approve Tutor"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewSection({ title, children }) {
  return (
    <section className="review-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="detail">
      <small>{label}</small>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function Proof({ title, icon, value, name, onView }) {
  return (
    <div className="proof">
      <div className="proof-icon">{icon}</div>
      <div>
        <strong>{title}</strong>
        <span>{name || (value ? "Uploaded file" : "Not supplied")}</span>
      </div>
      <button className="secondary" disabled={!value} onClick={onView}>
        View
      </button>
    </div>
  );
}

function Status({ status }) {
  const type =
    status === "Approved"
      ? "approved"
      : status === "Rejected"
      ? "rejected"
      : "pending";

  return <span className={`status ${type}`}>{status}</span>;
}

function Flow({ n, title, text }) {
  return (
    <div className="flow-item">
      <div className="flow-number">{n}</div>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}

function Stat({ icon, label, value, note }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function UsersPage({ applications }) {
  return (
    <>
      <PageHeader eyebrow="PLATFORM" title="Users 👥" subtitle="Lathso user overview." />

      <div className="stats-grid">
        <Stat icon="🎓" label="Students" value="—" note="Firestore users" />
        <Stat icon="👨‍👩‍👧" label="Parents" value="—" note="Firestore users" />
        <Stat
          icon="👨‍🏫"
          label="Verified Tutors"
          value={applications.filter((x) => x.status === "Approved").length}
          note="Admin approved"
        />
        <Stat
          icon="⏳"
          label="Pending Tutors"
          value={applications.filter((x) => x.status === "Pending").length}
          note="Waiting for review"
        />
      </div>
    </>
  );
}

function ReportsPage({ applications }) {
  const total = applications.length;
  const approved = applications.filter((x) => x.status === "Approved").length;
  const rate = total ? Math.round((approved / total) * 100) : 0;

  return (
    <>
      <PageHeader eyebrow="PLATFORM REPORTS" title="Reports 📈" subtitle="Lathso Admin overview." />

      <div className="report-grid">
        <Report value={`${rate}%`} label="Tutor Approval Rate" />
        <Report value="—" label="Average Tutor Rating" />
        <Report value="—" label="Session Completion" />
        <Report value="—" label="Assignment Completion" />
      </div>
    </>
  );
}

function Report({ value, label }) {
  return (
    <div className="report">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}


function PaymentsPage() {
  const [commissionTab, setCommissionTab] = useState("overview");
  const [paymentReport, setPaymentReport] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPaymentReport() {
      try {
        setPaymentLoading(true);
        setPaymentError("");
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error("Admin login session expired.");
        const token = await currentUser.getIdToken();
        const base = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
        const response = await fetch(`${base}/api/admin/payments`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.message || "Could not load verified payment data.");
        }
        if (!cancelled) setPaymentReport(data);
      } catch (error) {
        console.error("Admin payment report load error:", error);
        if (!cancelled) setPaymentError(error.message || "Could not load payment data.");
      } finally {
        if (!cancelled) setPaymentLoading(false);
      }
    }

    loadPaymentReport();
    return () => { cancelled = true; };
  }, []);

  const money = (paise) => {
    const value = Number(paise || 0) / 100;
    return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const rate = Number(paymentReport?.commissionPercent ?? 15);
  const tabRate = commissionTab === "subscription" || commissionTab === "overview" ? rate : 0;
  const tabText = commissionTab === "subscription"
    ? "15% is charged only from verified subscription payments. The remaining 85% becomes the tutor pool for tutor-service plans."
    : commissionTab === "overview"
    ? "Lathso takes 15% from subscription payments only. Student wallet/Add Money transactions have 0% platform commission."
    : "No platform commission is configured for this category.";

  return (
    <div className="payments-page">
      <section className="payments-command-bar">
        <div className="payments-title-block">
          <div className="payments-eyebrow">
            <span className="payments-live-dot" />
            LATHSO FINANCE
            <span className="payments-slash">/</span>
            PAYMENT CONTROL
          </div>
          <h1>Payments <span>&amp; Revenue</span></h1>
          <p>Monitor the financial layer of Lathso — wallet activity, tutor earnings, settlements and platform commission.</p>
        </div>

        <div className="payments-command-actions">
          <div className="payments-security">
            <span className="payments-security-mark">✓</span>
            <div>
              <strong>Secure Mode</strong>
              <small>Backend verification required</small>
            </div>
          </div>
          <button className="payments-period" type="button">
            <span>Period</span>
            <strong>Today</strong>
            <b>⌄</b>
          </button>
        </div>
      </section>

      <div className="payment-front-note">
        <div className="payment-note-icon">⌁</div>
        <div className="payment-note-copy">
          <strong>Verified payment backend connected</strong>
          <span>
            Subscription revenue and commission are read from the secure backend. Wallet top-ups remain 100% student wallet credit and are excluded from platform commission.
          </span>
        </div>
        <span className="payment-note-status">LIVE BACKEND</span>
      </div>

      {paymentError && <div className="info-banner"><strong>Payment data unavailable</strong><span>{paymentError}</span></div>}

      <section className="payment-stats-grid">
        <PaymentStat icon="₹" label="Today's Revenue" value={paymentLoading ? "…" : money(paymentReport?.todayRevenuePaise)} note="Verified subscription payments only" />
        <PaymentStat icon="↗" label="Tutor Payouts" value={paymentLoading ? "…" : money(paymentReport?.tutorPayoutPaise)} note="Manual payouts recorded" />
        <PaymentStat icon="%" label="Platform Commission" value={paymentLoading ? "…" : money(paymentReport?.platformCommissionPaise)} note={`${rate}% of subscriptions`} />
        <PaymentStat icon="◷" label="Pending Withdrawals" value={paymentLoading ? "…" : money(paymentReport?.pendingWithdrawalPaise)} note="Tutor earnings awaiting payout" />
      </section>

      <div className="payment-main-grid">
        <section className="payment-panel payment-operations-panel">
          <div className="payment-panel-heading">
            <div>
              <span className="payment-section-label">MONEY MOVEMENT</span>
              <h2>Payment Operations</h2>
              <p>Four controlled areas for the Lathso payment ecosystem.</p>
            </div>
            <span className="payment-count-chip">04 AREAS</span>
          </div>

          <div className="payment-operation-grid">
            <PaymentOperation icon="◈" title="Student Wallet" text="Credits, debits, refunds and ledger history." />
            <PaymentOperation icon="◆" title="Tutor Earnings" text="Available, pending and total tutor earnings." />
            <PaymentOperation icon="⇄" title="Tutor Withdrawals" text="Pending, processing and completed payouts." />
            <PaymentOperation icon="↩" title="Refund Center" text="Verified refunds and payment reversals." />
          </div>
        </section>

        <section className="payment-panel commission-panel">
          <div className="payment-panel-heading">
            <div>
              <span className="payment-section-label">REVENUE ENGINE</span>
              <h2>Commission Rules</h2>
              <p>Controlled by the secure payment backend.</p>
            </div>
            <span className="commission-lock">LOCKED</span>
          </div>

          <div className="commission-tabs">
            <button className={commissionTab === "overview" ? "active" : ""} onClick={() => setCommissionTab("overview")}>Overview</button>
            <button className={commissionTab === "instant" ? "active" : ""} onClick={() => setCommissionTab("instant")}>Instant Doubt</button>
            <button className={commissionTab === "session" ? "active" : ""} onClick={() => setCommissionTab("session")}>Sessions</button>
            <button className={commissionTab === "subscription" ? "active" : ""} onClick={() => setCommissionTab("subscription")}>Plans</button>
          </div>

          <div className="commission-display">
            <div className="commission-ring">
              <span>{paymentLoading ? "…" : `${tabRate}%`}</span>
            </div>
            <div className="commission-copy">
              <span>CONFIGURED RATE</span>
              <strong>{paymentLoading ? "Loading backend" : tabRate ? `${tabRate}% Subscription Commission` : "0% Commission"}</strong>
              <small>{tabText}</small>
            </div>
          </div>
        </section>
      </div>

      <section className="payment-panel transactions-panel">
        <div className="payment-panel-heading transaction-heading">
          <div>
            <span className="payment-section-label">VERIFIED LEDGER</span>
            <h2>Recent Transactions</h2>
            <p>Only Razorpay-captured subscription transactions are shown in this revenue ledger.</p>
          </div>
          <div className="transaction-tools">
            <span className="ledger-secure">● SECURE LEDGER</span>
            <button className="payment-export-button" type="button">Export Report <span>↗</span></button>
          </div>
        </div>

        <div className="payment-table">
          <div className="payment-table-row payment-table-head">
            <span>TRANSACTION</span>
            <span>CATEGORY</span>
            <span>AMOUNT</span>
            <span>COMMISSION</span>
            <span>STATUS</span>
          </div>
          {paymentLoading ? (
            <div className="payment-empty"><div className="payment-empty-icon">⌁</div><strong>Loading verified transactions…</strong><span>Reading the secure Razorpay payment ledger.</span></div>
          ) : paymentReport?.transactions?.length ? (
            paymentReport.transactions.map((item) => (
              <div className="payment-table-row" key={item.id}>
                <span>{item.paymentId || item.id}</span>
                <span>{item.planId || "Subscription"}</span>
                <span>{money(item.amountPaise)}</span>
                <span>{money(item.commissionPaise)}</span>
                <span>{item.status || "captured"}</span>
              </div>
            ))
          ) : (
            <div className="payment-empty"><div className="payment-empty-icon">⌁</div><strong>No verified subscription transactions yet</strong><span>Real Razorpay-captured subscription payments will appear here.</span></div>
          )}
        </div>
      </section>
    </div>
  );
}

function PaymentStat({ icon, label, value, note }) {
  return (
    <div className="payment-stat-card">
      <div className="payment-stat-top">
        <div className="payment-stat-icon">{icon}</div>
        <span className="payment-stat-trend">READY</span>
      </div>
      <span className="payment-stat-label">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function PaymentOperation({ icon, title, text }) {
  return (
    <div className="payment-operation">
      <div className="payment-operation-icon">{icon}</div>
      <div className="payment-operation-copy">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <span className="payment-operation-arrow">↗</span>
    </div>
  );
}

function SettingsPage() {
  const [phoneVerification, setPhoneVerification] = useState(true);

  return (
    <>
      <PageHeader eyebrow="ADMIN SETTINGS" title="Settings ⚙️" subtitle="Tutor verification configuration." />

      <div className="panel settings">
        <Setting
          title="Manual Phone Verification Required"
          text="Admin must call the tutor and confirm the submitted details before approval."
          value={phoneVerification}
          onChange={() => setPhoneVerification((x) => !x)}
        />
        <Setting
          title="Document / Video Uploads"
          text="Disabled for the current Firebase-only tutor verification flow."
          value={false}
          onChange={() => {}}
        />
      </div>
    </>
  );
}

function Setting({ title, text, value, onChange }) {
  return (
    <div className="setting">
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <button className={`toggle ${value ? "on" : ""}`} onClick={onChange}>
        {value ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="empty">
      <div>📭</div>
      <strong>{text}</strong>
      <span>New tutor applications will appear here.</span>
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle }) {
  return (
    <div className="page-header">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

const CSS = `
*{box-sizing:border-box}
button,input{font:inherit}
button{cursor:pointer}
.admin-root,.login-page{
  min-height:100vh;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  color:#f8f7ff;
  background:
    radial-gradient(circle at 80% 0%,rgba(124,92,255,.14),transparent 30%),
    #070713;
}
.admin-topbar{
  height:72px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:0 28px;
  border-bottom:1px solid rgba(255,255,255,.08);
  background:rgba(7,7,19,.96);
  position:sticky;
  top:0;
  z-index:30;
}
.admin-brand{
  display:flex;
  align-items:center;
  gap:10px;
  border:0;
  background:transparent;
  color:#fff;
  text-align:left;
}
.admin-logo,.login-logo{
  display:grid;
  place-items:center;
  border-radius:12px;
  background:linear-gradient(135deg,#6d3df0,#9a72ff);
  font-weight:900;
}
.admin-logo{width:38px;height:38px}
.admin-brand strong,.admin-brand small{display:block}
.admin-brand strong{font-size:20px}
.admin-brand small{margin-top:2px;color:#77738b;font-size:8px}
.top-actions{display:flex;align-items:center;gap:10px}
.admin-pill{
  padding:8px 12px;
  border-radius:999px;
  color:#b9aaff;
  background:rgba(124,92,255,.1);
  font-size:9px;
  font-weight:850;
}
.logout{
  padding:8px 12px;
  border:1px solid rgba(239,68,68,.2);
  border-radius:9px;
  background:rgba(239,68,68,.06);
  color:#fca5a5;
  font-size:9px;
  font-weight:800;
}
.admin-shell{
  display:grid;
  grid-template-columns:250px minmax(0,1fr);
  min-height:calc(100vh - 72px);
}
.admin-sidebar{
  padding:18px 14px;
  border-right:1px solid rgba(255,255,255,.07);
  background:rgba(9,8,22,.84);
}
.admin-account{
  display:flex;
  align-items:center;
  gap:10px;
  padding:13px;
  margin-bottom:18px;
  border:1px solid rgba(255,255,255,.07);
  border-radius:15px;
  background:#111021;
}
.admin-avatar{
  width:40px;height:40px;
  display:grid;place-items:center;
  border-radius:12px;
  background:linear-gradient(135deg,#6d3df0,#9a72ff);
  font-weight:900;
}
.admin-account strong,.admin-account small{display:block}
.admin-account strong{font-size:11px}
.admin-account small{margin-top:3px;color:#77738b;font-size:8px}
.menu-title{
  margin:17px 9px 7px;
  color:#5e5a70;
  font-size:8px;
  font-weight:900;
  letter-spacing:.14em;
}
.admin-nav{
  width:100%;
  display:flex;
  align-items:center;
  gap:9px;
  padding:10px 11px;
  margin:3px 0;
  border:1px solid transparent;
  border-radius:11px;
  background:transparent;
  color:#9490a3;
  text-align:left;
  font-size:10px;
  font-weight:750;
}
.admin-nav:hover{background:rgba(255,255,255,.035);color:#fff}
.admin-nav.active{
  border-color:rgba(139,92,246,.28);
  background:rgba(109,61,240,.13);
  color:#fff;
}
.admin-nav b{
  margin-left:auto;
  min-width:18px;
  padding:3px 5px;
  border-radius:999px;
  background:#6d3df0;
  color:#fff;
  text-align:center;
  font-size:8px;
}
.admin-content{
  width:100%;
  max-width:1400px;
  margin:auto;
  padding:40px 42px 70px;
}
.page-header{margin-bottom:25px}
.page-header>span,.eyebrow{
  color:#a78bfa;
  font-size:9px;
  font-weight:900;
  letter-spacing:.15em;
}
.page-header h1{
  margin:8px 0 6px;
  font-size:34px;
  line-height:1.1;
  letter-spacing:-.035em;
}
.page-header p{
  margin:0;
  color:#858193;
  font-size:11px;
}
.stats-grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:13px;
  margin-bottom:20px;
}
.stat-card{
  padding:17px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:17px;
  background:rgba(255,255,255,.035);
}
.stat-icon{
  width:36px;height:36px;
  display:grid;place-items:center;
  margin-bottom:12px;
  border-radius:10px;
  background:rgba(124,92,255,.1);
}
.stat-card>span,.stat-card>small{
  display:block;
  color:#817d90;
  font-size:9px;
}
.stat-card strong{
  display:block;
  margin:6px 0 3px;
  font-size:25px;
}
.two-column{
  display:grid;
  grid-template-columns:1.45fr .8fr;
  gap:17px;
}
.panel{
  padding:20px;
  margin-bottom:18px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:19px;
  background:rgba(255,255,255,.035);
}
.panel-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:16px;
}
.panel-header h2{margin:0 0 4px;font-size:17px}
.panel-header p{margin:0;color:#817d90;font-size:9px}
.list{display:grid;gap:9px}
.primary,.approve,.danger,.secondary,.review,.login-button{
  border-radius:10px;
  font-weight:800;
}
.primary{
  padding:10px 13px;
  border:1px solid rgba(167,139,250,.2);
  background:linear-gradient(135deg,#6d3df0,#8057f6);
  color:#fff;
}
.primary.small{padding:8px 11px;font-size:9px}
.application-row{
  display:flex;
  align-items:center;
  gap:12px;
  padding:13px;
  border:1px solid rgba(255,255,255,.06);
  border-radius:13px;
  background:rgba(255,255,255,.025);
}
.application-row.large{padding:15px}
.person-avatar,.big-avatar{
  display:grid;
  place-items:center;
  flex-shrink:0;
  border-radius:12px;
  background:linear-gradient(135deg,#6d3df0,#9a72ff);
  font-weight:900;
}
.person-avatar{width:42px;height:42px}
.big-avatar{width:52px;height:52px}
.person{flex:1;min-width:170px}
.person strong,.person span,.person small{display:block}
.person strong{font-size:11px}
.person span,.person small{
  margin-top:3px;
  color:#817d90;
  font-size:9px;
}
.proof-summary{
  display:grid;
  gap:4px;
  min-width:180px;
}
.proof-summary span{color:#9995a7;font-size:8px}
.status{
  padding:6px 9px;
  border-radius:999px;
  white-space:nowrap;
  font-size:8px;
  font-weight:850;
}
.status.pending{color:#fbbf24;background:rgba(245,158,11,.09)}
.status.approved{color:#86efac;background:rgba(34,197,94,.09)}
.status.rejected{color:#fca5a5;background:rgba(239,68,68,.09)}
.review{
  padding:8px 10px;
  border:1px solid rgba(255,255,255,.08);
  background:#151329;
  color:#d5d1df;
  font-size:9px;
}
.flow{display:grid;gap:10px}
.flow-item{
  display:flex;
  align-items:center;
  gap:11px;
  padding:11px;
  border-radius:12px;
  background:rgba(255,255,255,.025);
}
.flow-number{
  width:30px;height:30px;
  display:grid;place-items:center;
  border-radius:9px;
  background:rgba(124,92,255,.1);
  color:#b7a7ff;
  font-size:8px;
  font-weight:900;
}
.flow-item strong,.flow-item span{display:block}
.flow-item strong{font-size:10px}
.flow-item span{margin-top:3px;color:#817d90;font-size:8px}
.info-banner{
  padding:14px 16px;
  margin-bottom:16px;
  border:1px solid rgba(124,92,255,.2);
  border-radius:14px;
  background:rgba(124,92,255,.06);
}
.info-banner strong,.info-banner span{display:block}
.info-banner strong{font-size:10px}
.info-banner span{margin-top:4px;color:#928da2;font-size:9px}
.report-grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:13px;
}
.report{
  padding:20px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:17px;
  background:rgba(255,255,255,.035);
}
.report strong,.report span{display:block}
.report strong{font-size:25px}
.report span{margin-top:7px;color:#817d90;font-size:9px}

/* PAYMENT UI ONLY — isolated from the existing Admin UI */
 .payments-page{
   width:100%;
   --pay-line:rgba(255,255,255,.075);
   --pay-muted:#777286;
   --pay-soft:#a8a1b6;
   --pay-accent:#9b7cff;
   --pay-accent-2:#c5b5ff;
 }
 .payments-command-bar{
   display:flex;
   align-items:flex-end;
   justify-content:space-between;
   gap:24px;
   padding:2px 0 20px;
   border-bottom:1px solid rgba(255,255,255,.055);
   margin-bottom:16px;
 }
 .payments-title-block{min-width:0}
 .payments-eyebrow{
   display:flex;
   align-items:center;
   gap:8px;
   color:#9f8bdf;
   font-size:7px;
   font-weight:900;
   letter-spacing:.19em;
 }
 .payments-slash{color:#454052}
 .payments-live-dot{
   width:6px;height:6px;
   border-radius:50%;
   background:#9b7cff;
   box-shadow:0 0 0 4px rgba(155,124,255,.08),0 0 14px rgba(155,124,255,.55);
 }
 .payments-command-bar h1{
   margin:8px 0 5px;
   color:#f7f4fc;
   font-size:35px;
   line-height:1;
   letter-spacing:-.05em;
 }
 .payments-command-bar h1 span{color:#9d8ebc;font-weight:500}
 .payments-command-bar p{
   max-width:650px;
   margin:0;
   color:#777286;
   font-size:9px;
   line-height:1.65;
 }
 .payments-command-actions{
   display:flex;
   align-items:center;
   gap:8px;
 }
 .payments-security{
   display:flex;
   align-items:center;
   gap:8px;
   padding:8px 10px;
   border:1px solid var(--pay-line);
   border-radius:11px;
   background:rgba(255,255,255,.025);
 }
 .payments-security-mark{
   width:25px;height:25px;
   display:grid;place-items:center;
   border-radius:8px;
   background:rgba(34,197,94,.08);
   color:#86efac;
   font-size:9px;
   font-weight:900;
 }
 .payments-security strong,.payments-security small{display:block}
 .payments-security strong{color:#d9d4e2;font-size:7px}
 .payments-security small{margin-top:2px;color:#625d6e;font-size:6px}
 .payments-period{
   min-width:82px;
   display:grid;
   grid-template-columns:1fr auto;
   align-items:center;
   column-gap:7px;
   padding:7px 9px;
   border:1px solid var(--pay-line);
   border-radius:11px;
   background:#10101d;
   color:#a9a2b3;
   text-align:left;
 }
 .payments-period span{grid-column:1/-1;color:#625d6e;font-size:6px}
 .payments-period strong{margin-top:2px;color:#ddd8e7;font-size:8px}
 .payments-period b{grid-column:2;grid-row:2;color:#777184;font-size:10px}
 .payment-front-note{
   display:flex;
   align-items:center;
   gap:11px;
   padding:11px 13px;
   margin-bottom:13px;
   border:1px solid rgba(139,92,246,.16);
   border-radius:13px;
   background:
     linear-gradient(100deg,rgba(109,61,240,.075),rgba(255,255,255,.018));
 }
 .payment-note-icon{
   width:30px;height:30px;
   display:grid;place-items:center;
   flex-shrink:0;
   border:1px solid rgba(155,124,255,.16);
   border-radius:9px;
   background:rgba(109,61,240,.09);
   color:#c4b5fd;
   font-size:13px;
 }
 .payment-note-copy{flex:1;min-width:0}
 .payment-front-note strong,.payment-front-note span{display:block}
 .payment-front-note strong{color:#e7e2f0;font-size:8px}
 .payment-front-note span{margin-top:3px;color:#716c7d;font-size:7px;line-height:1.55}
 .payment-note-status{
   padding:5px 7px;
   border:1px solid rgba(139,92,246,.15);
   border-radius:999px;
   color:#a996eb!important;
   background:rgba(109,61,240,.07);
   font-size:6px!important;
   font-weight:900;
   letter-spacing:.06em;
   white-space:nowrap;
 }
 .payment-stats-grid{
   display:grid;
   grid-template-columns:repeat(4,1fr);
   gap:10px;
   margin-bottom:12px;
 }
 .payment-stat-card{
   position:relative;
   min-height:126px;
   padding:13px;
   overflow:hidden;
   border:1px solid var(--pay-line);
   border-radius:15px;
   background:
     radial-gradient(circle at 100% 0%,rgba(139,92,246,.095),transparent 48%),
     linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.016));
   box-shadow:0 15px 35px rgba(0,0,0,.11);
 }
 .payment-stat-card:before{
   content:"";
   position:absolute;
   left:0;top:0;bottom:0;
   width:2px;
   background:linear-gradient(180deg,#9b7cff,transparent);
   opacity:.7;
 }
 .payment-stat-top{
   display:flex;
   align-items:center;
   justify-content:space-between;
   margin-bottom:14px;
 }
 .payment-stat-icon{
   width:31px;height:31px;
   display:grid;place-items:center;
   border:1px solid rgba(155,124,255,.17);
   border-radius:9px;
   background:rgba(109,61,240,.09);
   color:#c7b9ff;
   font-size:11px;
   font-weight:900;
 }
 .payment-stat-trend{
   padding:4px 6px;
   border:1px solid rgba(34,197,94,.10);
   border-radius:999px;
   color:#79d99a;
   background:rgba(34,197,94,.045);
   font-size:5px;
   font-weight:900;
   letter-spacing:.08em;
 }
 .payment-stat-label{display:block;color:#777184;font-size:7px;font-weight:750}
 .payment-stat-card strong{
   display:block;
   margin:5px 0 3px;
   color:#f5f2fa;
   font-size:25px;
   line-height:1;
   letter-spacing:-.045em;
 }
 .payment-stat-card small{display:block;color:#5f5a6b;font-size:6px}
 .payment-main-grid{
   display:grid;
   grid-template-columns:1.1fr .9fr;
   gap:12px;
   margin-bottom:12px;
 }
 .payment-panel{
   padding:17px;
   border:1px solid var(--pay-line);
   border-radius:16px;
   background:linear-gradient(145deg,rgba(255,255,255,.031),rgba(255,255,255,.018));
   box-shadow:0 14px 38px rgba(0,0,0,.10);
 }
 .payment-panel-heading{
   display:flex;
   align-items:flex-start;
   justify-content:space-between;
   gap:12px;
   margin-bottom:13px;
 }
 .payment-section-label{
   color:#5f5a6d;
   font-size:6px;
   font-weight:900;
   letter-spacing:.18em;
 }
 .payment-panel-heading h2{
   margin:5px 0 3px;
   color:#eeeaf5;
   font-size:15px;
   letter-spacing:-.025em;
 }
 .payment-panel-heading p{margin:0;color:#6b6677;font-size:7px}
 .payment-count-chip,.commission-lock{
   padding:5px 7px;
   border:1px solid rgba(255,255,255,.06);
   border-radius:7px;
   color:#706b7c;
   background:rgba(255,255,255,.018);
   font-size:5px;
   font-weight:900;
   letter-spacing:.09em;
   white-space:nowrap;
 }
 .commission-lock{color:#a996eb;border-color:rgba(155,124,255,.12)}
 .payment-operation-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
 .payment-operation{
   min-height:70px;
   display:flex;
   align-items:center;
   gap:9px;
   padding:10px;
   border:1px solid rgba(255,255,255,.055);
   border-radius:12px;
   background:rgba(7,7,19,.36);
   transition:transform .18s ease,border-color .18s ease,background .18s ease;
 }
 .payment-operation:hover{
   transform:translateY(-1px);
   border-color:rgba(155,124,255,.20);
   background:rgba(109,61,240,.055);
 }
 .payment-operation-icon{
   width:31px;height:31px;
   display:grid;place-items:center;
   flex-shrink:0;
   border-radius:9px;
   background:rgba(124,92,255,.08);
   color:#b9a8ff;
   font-size:11px;
   font-weight:900;
 }
 .payment-operation-copy{flex:1;min-width:0}
 .payment-operation-copy strong{display:block;color:#ddd8e7;font-size:8px}
 .payment-operation-copy span{display:block;margin-top:3px;color:#666171;font-size:6px;line-height:1.5}
 .payment-operation-arrow{color:#625c70;font-size:11px}
 .commission-panel{min-height:100%}
 .commission-tabs{
   display:grid;
   grid-template-columns:1fr 1fr;
   gap:5px;
   margin-bottom:10px;
 }
 .commission-tabs button{
   padding:7px 6px;
   border:1px solid rgba(255,255,255,.055);
   border-radius:7px;
   background:#0e0d1a;
   color:#6e6879;
   font-size:6px;
   font-weight:800;
 }
 .commission-tabs button.active{
   border-color:rgba(155,124,255,.22);
   background:rgba(109,61,240,.11);
   color:#eeeaf6;
   box-shadow:inset 0 -1px rgba(155,124,255,.45);
 }
 .commission-display{
   display:flex;
   align-items:center;
   gap:13px;
   min-height:92px;
   padding:12px;
   border:1px solid rgba(255,255,255,.055);
   border-radius:12px;
   background:linear-gradient(135deg,rgba(109,61,240,.065),rgba(255,255,255,.012));
 }
 .commission-ring{
   position:relative;
   width:62px;height:62px;
   display:grid;place-items:center;
   flex-shrink:0;
   border:1px solid rgba(155,124,255,.22);
   border-radius:50%;
   background:conic-gradient(rgba(155,124,255,.42) 0deg,rgba(155,124,255,.04) 0deg 360deg);
   box-shadow:0 0 25px rgba(109,61,240,.08);
 }
 .commission-ring:before{
   content:"";
   position:absolute;
   width:48px;height:48px;
   border-radius:50%;
   background:#111021;
 }
 .commission-ring span{
   position:relative;
   z-index:1;
   color:#c3b4ff;
   font-size:15px;
   font-weight:900;
 }
 .commission-copy{min-width:0}
 .commission-copy>span,.commission-copy small{display:block;color:#666172;font-size:6px}
 .commission-copy strong{display:block;margin:4px 0;color:#e5e0ec;font-size:9px}
 .commission-copy small{line-height:1.5}
 .transactions-panel{margin-bottom:0}
 .transaction-heading{align-items:center}
 .transaction-tools{display:flex;align-items:center;gap:7px}
 .ledger-secure{
   padding:5px 7px;
   border:1px solid rgba(34,197,94,.08);
   border-radius:999px;
   color:#72ce91;
   background:rgba(34,197,94,.035);
   font-size:5px;
   font-weight:900;
   letter-spacing:.06em;
 }
 .payment-export-button{
   padding:7px 9px;
   border:1px solid rgba(255,255,255,.07);
   border-radius:8px;
   background:#111021;
   color:#9993a5;
   font-size:6px;
   font-weight:800;
 }
 .payment-export-button span{margin-left:4px;color:#a78bfa}
 .payment-table{overflow:hidden;border:1px solid rgba(255,255,255,.055);border-radius:11px}
 .payment-table-row{
   display:grid;
   grid-template-columns:1.5fr 1fr 1fr 1fr 1fr;
   gap:10px;
   padding:10px 11px;
   align-items:center;
 }
 .payment-table-head{
   background:rgba(255,255,255,.023);
   color:#555061;
   font-size:5px;
   font-weight:900;
   letter-spacing:.09em;
 }
 .payment-empty{
   min-height:135px;
   display:grid;
   place-items:center;
   align-content:center;
   padding:23px;
   text-align:center;
 }
 .payment-empty-icon{
   width:36px;height:36px;
   display:grid;place-items:center;
   margin-bottom:7px;
   border:1px solid rgba(155,124,255,.15);
   border-radius:11px;
   background:rgba(109,61,240,.07);
   color:#a78bfa;
   font-size:15px;
 }
 .payment-empty strong{color:#d9d4e2;font-size:9px}
 .payment-empty span{max-width:450px;margin-top:4px;color:#5e596a;font-size:6px;line-height:1.55}
 @media(max-width:1050px){
   .two-column{grid-template-columns:1fr}
   .stats-grid,.report-grid{grid-template-columns:1fr 1fr}
   .payment-stats-grid{grid-template-columns:1fr 1fr}
   .payment-main-grid{grid-template-columns:1fr}
 }
 @media(max-width:800px){
   .payment-operation-grid{grid-template-columns:1fr}
   .payments-command-bar{align-items:flex-start;flex-direction:column}
   .payments-command-actions{width:100%;justify-content:space-between}
 }
 @media(max-width:600px){
   .payment-stats-grid{grid-template-columns:1fr}
   .payments-command-bar h1{font-size:29px}
   .payment-panel{padding:14px}
   .payment-front-note{align-items:flex-start}
   .payment-note-status{display:none}
   .transaction-tools{align-items:flex-end}
   .ledger-secure{display:none}
   .payment-table-row{grid-template-columns:1fr 1fr}
   .payment-table-head span:nth-child(n+3){display:none}
   .payment-export-button{display:none}
 }
.settings{max-width:800px}
.setting{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:20px;
  padding:16px 0;
  border-bottom:1px solid rgba(255,255,255,.06);
}
.setting:last-child{border-bottom:0}
.setting strong,.setting span{display:block}
.setting strong{font-size:11px}
.setting span{margin-top:4px;color:#817d90;font-size:9px}
.toggle{
  min-width:48px;
  padding:6px 9px;
  border:0;
  border-radius:999px;
  background:rgba(239,68,68,.1);
  color:#fca5a5;
  font-size:8px;
  font-weight:900;
}
.toggle.on{background:rgba(34,197,94,.1);color:#86efac}
.empty{
  padding:45px 20px;
  text-align:center;
  color:#817d90;
}
.empty div{font-size:28px}
.empty strong,.empty span{display:block}
.empty strong{margin-top:9px;color:#d7d3e2;font-size:12px}
.empty span{margin-top:4px;font-size:9px}

/* review */
.overlay{
  position:fixed;
  inset:0;
  z-index:100;
  display:grid;
  place-items:center;
  padding:20px;
  background:rgba(0,0,0,.76);
  backdrop-filter:blur(6px);
}
.review-modal{
  position:relative;
  width:min(760px,100%);
  max-height:90vh;
  overflow:auto;
  padding:27px;
  border:1px solid rgba(139,92,246,.3);
  border-radius:22px;
  background:#111021;
  box-shadow:0 30px 100px rgba(0,0,0,.6);
}
.close{
  position:absolute;
  top:10px;
  right:15px;
  border:0;
  background:transparent;
  color:#aaa6b7;
  font-size:26px;
}
.review-heading{
  display:flex;
  align-items:center;
  gap:12px;
  margin:18px 0 22px;
}
.review-heading h2{margin:0 0 4px;font-size:21px}
.review-heading p{margin:0;color:#817d90;font-size:10px}
.review-heading>.status{margin-left:auto}
.review-section{margin-top:18px}
.review-section h3{margin:0 0 10px;font-size:11px}
.detail-grid,.proof-grid{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:9px;
}
.detail{
  padding:11px;
  border-radius:11px;
  background:rgba(255,255,255,.035);
}
.detail small,.detail strong{display:block}
.detail small{color:#817d90;font-size:8px}
.detail strong{margin-top:4px;font-size:9px;word-break:break-word}
.proof,.verification-card{
  display:flex;
  align-items:center;
  gap:10px;
  padding:12px;
  border:1px solid rgba(255,255,255,.07);
  border-radius:12px;
  background:rgba(255,255,255,.025);
}
.proof-icon,.verification-icon{
  width:34px;height:34px;
  display:grid;place-items:center;
  flex-shrink:0;
  border-radius:9px;
  background:rgba(124,92,255,.1);
}
.proof>div:nth-child(2),.verification-card>div:nth-child(2){flex:1}
.proof strong,.proof span,.verification-card strong,.verification-card span{display:block}
.proof strong,.verification-card strong{font-size:9px}
.proof span,.verification-card span{
  margin-top:3px;
  color:#817d90;
  font-size:8px;
  word-break:break-word;
}
.secondary{
  padding:7px 9px;
  border:1px solid rgba(255,255,255,.08);
  background:#151329;
  color:#c4bfce;
  font-size:8px;
}
.modal-actions{
  display:flex;
  justify-content:flex-end;
  gap:9px;
  margin-top:22px;
}
.danger{
  padding:10px 13px;
  border:1px solid rgba(239,68,68,.2);
  background:rgba(239,68,68,.07);
  color:#fca5a5;
  font-size:9px;
}
.approve{
  padding:10px 14px;
  border:1px solid rgba(139,92,246,.2);
  background:linear-gradient(135deg,#6d3df0,#8057f6);
  color:#fff;
  font-size:9px;
}

/* login */
.login-page{
  display:grid;
  place-items:center;
  padding:20px;
}
.login-card{
  width:min(430px,100%);
  padding:32px;
  border:1px solid rgba(255,255,255,.09);
  border-radius:23px;
  background:rgba(17,16,33,.95);
  box-shadow:0 30px 100px rgba(0,0,0,.5);
}
.login-logo{width:48px;height:48px;margin-bottom:22px;font-size:20px}
.login-card h1{margin:8px 0 7px;font-size:29px;letter-spacing:-.035em}
.login-card>p{margin:0 0 22px;color:#817d90;font-size:11px;line-height:1.6}
.login-card form{display:grid;gap:14px}
.login-card label{
  display:grid;
  gap:6px;
  color:#aaa6b7;
  font-size:9px;
  font-weight:750;
}
.login-card input{
  width:100%;
  padding:12px;
  border:1px solid rgba(255,255,255,.1);
  border-radius:11px;
  outline:none;
  background:#0d0c1a;
  color:#fff;
}
.login-button{
  padding:12px;
  margin-top:5px;
  border:0;
  background:linear-gradient(135deg,#6d3df0,#8057f6);
  color:#fff;
  font-size:10px;
}
.demo-note{
  display:grid;
  gap:4px;
  margin-top:18px;
  padding:11px;
  border-radius:11px;
  background:rgba(124,92,255,.06);
}
.demo-note strong{color:#b7a7ff;font-size:8px}
.demo-note span{color:#817d90;font-size:8px}

@media(max-width:1050px){
  .two-column,.payment-summary-grid{grid-template-columns:1fr}
  .stats-grid,.report-grid,.payment-stats-grid{grid-template-columns:1fr 1fr}
}
@media(max-width:800px){
  .admin-shell{grid-template-columns:1fr}
  .admin-sidebar{display:none}
  .admin-content{padding:28px 18px 60px}
  .application-row{align-items:flex-start;flex-wrap:wrap}
  .proof-summary{width:100%}
}
@media(max-width:600px){
  .admin-topbar{height:auto;min-height:64px;padding:10px 13px}
  .admin-pill{display:none}
  .admin-content{padding:24px 14px 50px}
  .stats-grid,.report-grid,.detail-grid,.proof-grid,.payment-stats-grid{grid-template-columns:1fr}
  .page-header h1{font-size:28px}
  .review-heading{align-items:flex-start;flex-wrap:wrap}
  .review-heading>.status{margin-left:0}
  .modal-actions{display:grid;grid-template-columns:1fr}
  .payment-table-row{grid-template-columns:1fr 1fr}
  .payment-table-head span:nth-child(n+3){display:none}
}
`;
