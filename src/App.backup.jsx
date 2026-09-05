import { useRef, useState } from "react";
import "./index.css";

/* =========================================================
   LEARNORA
   Complete V1 Student UI
   ========================================================= */

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

/* =========================================================
   DEMO DATA
   ========================================================= */

const INITIAL_TUTORS = [
  {
    id: 1,
    name: "Demo Mathematics Tutor",
    subject: "Mathematics",
    location: "RK Valley",
    mode: "Home + Online",
    rating: 4.8,
    qualification: "M.Sc Mathematics",
    experience: "5+ Years",
    fee: "₹300 / session",
    available: true,
  },
  {
    id: 2,
    name: "Demo Physics Mentor",
    subject: "Physics",
    location: "RK Valley",
    mode: "Online",
    rating: 4.9,
    qualification: "M.Tech Physics",
    experience: "7+ Years",
    fee: "₹350 / session",
    available: true,
  },
  {
    id: 3,
    name: "Verified Chemistry Tutor",
    subject: "Chemistry",
    location: "Nearby",
    mode: "Home Tuition",
    rating: 4.7,
    qualification: "M.Sc Chemistry",
    experience: "4+ Years",
    fee: "₹300 / session",
    available: true,
  },
  {
    id: 4,
    name: "Biology Learning Mentor",
    subject: "Biology",
    location: "Online",
    mode: "Online",
    rating: 4.8,
    qualification: "M.Sc Biology",
    experience: "6+ Years",
    fee: "₹400 / session",
    available: true,
  },
];

/* =========================================================
   LOGO
   ========================================================= */

function Logo() {
  return (
    <div className="learnora-logo">
      <div className="logo-mark">L</div>
      <span>learnora</span>
    </div>
  );
}

/* =========================================================
   HOME / ROLE SELECT
   ========================================================= */

function Home({ onSelectRole }) {
  return (
    <div className="home-page">
      <header className="topbar">
        <Logo />

        <div className="version-badge">
          LEARNORA V1.0
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
          {Object.entries(ROLES).map(([key, role]) => (
            <button
              key={key}
              className="role-card"
              onClick={() => onSelectRole(key)}
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
          ))}
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

/* =========================================================
   LOGIN
   ========================================================= */

function Login({
  role,
  onBack,
  onLogin,
}) {
  const [isSignup, setIsSignup] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const roleData = ROLES[role];

  function submitLogin() {
    if (!email.trim() || !password.trim()) {
      alert("Please enter your email/phone and password.");
      return;
    }

    onLogin({
      name: name.trim() || "Student",
      email: email.trim(),
    });
  }

  return (
    <div className="login-page">
      <header className="topbar">
        <Logo />

        <button
          className="back-button"
          onClick={onBack}
        >
          ← Back
        </button>
      </header>

      <main className="login-layout">
        <section className="login-left">
          <div className="login-welcome">
            <div className="welcome-role">
              {roleData.icon}
            </div>

            <h1>
              Welcome {roleData.name}! 👋
            </h1>

            <p>
              {role === "student"
                ? "Let's continue your learning journey."
                : role === "parent"
                ? "Stay connected with your child's learning."
                : "Share knowledge. Inspire students."}
            </p>
          </div>

          <div className="login-visual">
            <div className="floating-icon icon-one">
              🤖
            </div>

            <div className="floating-icon icon-two">
              💡
            </div>

            <div className="big-learning-icon">
              {roleData.icon}
            </div>

            <div className="floating-icon icon-three">
              📚
            </div>
          </div>
        </section>

        <section className="login-card">
          <div className="login-main-icon">
            {roleData.icon}
          </div>

          <h2>
            {roleData.name} Login
          </h2>

          <p className="login-subtitle">
            {isSignup
              ? "Create your Learnora account"
              : "Login to access your dashboard"}
          </p>

          <div className="login-tabs">
            <button
              className={!isSignup ? "active" : ""}
              onClick={() => setIsSignup(false)}
            >
              Login
            </button>

            <button
              className={isSignup ? "active" : ""}
              onClick={() => setIsSignup(true)}
            >
              Sign Up
            </button>
          </div>

          {isSignup && (
            <input
              className="login-input"
              placeholder="Full name"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
            />
          )}

          <input
            className="login-input"
            placeholder="Email or phone number"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
          />

          <input
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
          />

          <div className="login-options">
            <label>
              <input type="checkbox" />
              Remember me
            </label>

            <button
              type="button"
              onClick={() =>
                alert(
                  "Password reset feature will be connected to the backend."
                )
              }
            >
              Forgot password?
            </button>
          </div>

          <button
            className="login-submit"
            onClick={submitLogin}
          >
            {isSignup
              ? "Create Account"
              : "Login"}
          </button>

          <div className="login-divider">
            <span />
            or continue with
            <span />
          </div>

          <div className="social-buttons">
            <button
              type="button"
              onClick={() =>
                alert("Google login will be connected later.")
              }
            >
              🌈
            </button>

            <button
              type="button"
              onClick={() =>
                alert("Facebook login will be connected later.")
              }
            >
              f
            </button>

            <button
              type="button"
              onClick={() =>
                alert("Apple login will be connected later.")
              }
            >
              
            </button>
          </div>

          <p className="demo-text">
            Learnora V1.0 • Demo authentication
          </p>
        </section>
      </main>
    </div>
  );
}

/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({
  activePage,
  setActivePage,
  onLogout,
  studentName,
}) {
  const navItems = [
    {
      id: "home",
      icon: "⌂",
      label: "Home",
    },
    {
      id: "ai",
      icon: "🤖",
      label: "AI Problem Solver",
    },
    {
      id: "tutors",
      icon: "👨‍🏫",
      label: "Find Tutor",
    },
    {
      id: "sessions",
      icon: "📅",
      label: "My Sessions",
    },
    {
      id: "profile",
      icon: "👤",
      label: "Profile",
    },
  ];

  return (
    <aside className="sidebar">
      <Logo />

      <div className="student-account">
        <span>🎓</span>

        <div>
          <strong>
            {studentName || "Student"}
          </strong>

          <small>
            Learnora V1.0
          </small>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={
              activePage === item.id
                ? "nav-link active"
                : "nav-link"
            }
            onClick={() =>
              setActivePage(item.id)
            }
          >
            <span>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="help-box">
          <strong>
            Need more clarity?
          </strong>

          <p>
            Connect with a verified human tutor.
          </p>

          <button
            type="button"
            onClick={() =>
              setActivePage("tutors")
            }
          >
            Find Tutor →
          </button>
        </div>

        <button
          className="logout-button"
          onClick={onLogout}
        >
          ↪ Logout
        </button>
      </div>
    </aside>
  );
}

/* =========================================================
   PAGE HEADER
   ========================================================= */

function PageHeader({
  title,
  subtitle,
  icon,
  children,
}) {
  return (
    <div className="dashboard-header">
      <div>
        <h1>
          {icon && `${icon} `}
          {title}
        </h1>

        <p>
          {subtitle}
        </p>
      </div>

      {children}
    </div>
  );
}

/* =========================================================
   STUDENT HOME
   ========================================================= */

function StudentHome({
  studentName,
  stats,
  setActivePage,
  sessions,
}) {
  const upcomingSession =
    sessions.length > 0
      ? sessions[0]
      : null;

  return (
    <>
      <PageHeader
        title={`Good afternoon, ${
          studentName || "Student"
        }`}
        subtitle="What would you like to learn today?"
      >
        <button
          className="notification-button"
          onClick={() =>
            alert(
              "No new notifications right now."
            )
          }
        >
          🔔
        </button>
      </PageHeader>

      {/* STATS */}

      <div className="stats-grid">
        <div className="stat-card">
          <strong>
            {stats.problemsSolved}
          </strong>
          <span>
            Problems Solved
          </span>
        </div>

        <div className="stat-card">
          <strong>
            {stats.tutorSessions}
          </strong>
          <span>
            Tutor Sessions
          </span>
        </div>

        <div className="stat-card">
          <strong>
            {stats.progress}%
          </strong>
          <span>
            Learning Progress
          </span>
        </div>

        <div className="stat-card">
          <strong>
            {stats.streak}
          </strong>
          <span>
            Study Streak
          </span>
        </div>
      </div>

      {/* MAIN FEATURES */}

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
            ask Learnora AI directly.
          </p>

          <button
            className="primary-button"
            onClick={() =>
              setActivePage("ai")
            }
          >
            Ask Learnora AI →
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

      {/* UPCOMING SESSION */}

      {upcomingSession && (
        <div className="upcoming-session">
          <div>
            <span className="section-label">
              UPCOMING SESSION
            </span>

            <h3>
              {upcomingSession.tutor}
            </h3>

            <p>
              {upcomingSession.subject} •{" "}
              {upcomingSession.date} •{" "}
              {upcomingSession.time}
            </p>
          </div>

          <button
            className="secondary-button small"
            onClick={() =>
              setActivePage("sessions")
            }
          >
            View Session →
          </button>
        </div>
      )}

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
          onClick={() =>
            setActivePage("tutors")
          }
        >
          Get Human Tutor →
        </button>
      </div>
    </>
  );
}

/* =========================================================
   AI PROBLEM SOLVER
   ========================================================= */

function AIPage({
  questionImage,
  setQuestionImage,
  questionText,
  setQuestionText,
  aiLoading,
  aiSolved,
  solveProblem,
  removeImage,
  fileInputRef,
}) {
  function handleImage(file) {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert(
        "Please select an image file."
      );
      return;
    }

    const imageURL =
      URL.createObjectURL(file);

    setQuestionImage(imageURL);
  }

  function handleFileChange(event) {
    const file =
      event.target.files?.[0];

    handleImage(file);
  }

  return (
    <section className="ai-page">
      <PageHeader
        title="Learnora AI"
        subtitle="Upload a question photo or type your question to get step-by-step help."
        icon="🤖"
      />

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

      {/* AI RESULT */}

      <div className="ai-result">
        {aiLoading ? (
          <div className="ai-loading">
            <div className="loading-orb">
              🤖
            </div>

            <h3>
              Learnora AI is reading your question...
            </h3>

            <p>
              Understanding the problem and
              preparing a step-by-step explanation.
            </p>

            <div className="loading-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : aiSolved ? (
          <div className="solution-result">
            <div className="solution-header">
              <div className="solution-icon">
                ✓
              </div>

              <div>
                <h3>
                  Solution Ready
                </h3>

                <p>
                  Learnora AI understood your question.
                </p>
              </div>
            </div>

            <div className="solution-content">
              <div className="solution-label">
                STEP-BY-STEP EXPLANATION
              </div>

              <p>
                Your question has been received.
                The AI explanation area is ready
                for the real AI backend.
              </p>

              <div className="demo-solution">
                <strong>
                  Example format
                </strong>

                <p>
                  Step 1 — Understand the given values.
                </p>

                <p>
                  Step 2 — Select the correct formula.
                </p>

                <p>
                  Step 3 — Substitute the values.
                </p>

                <p>
                  Step 4 — Calculate the result.
                </p>

                <strong>
                  Final Answer → AI generated answer
                </strong>
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-ai">
            <div className="empty-ai-icon">
              ✦
            </div>

            <h3>
              Your AI solution will appear here
            </h3>

            <p>
              Upload a question photo or
              type a question to get started.
            </p>
          </div>
        )}
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
      </div>
    </section>
  );
}

/* =========================================================
   TUTOR CARD
   ========================================================= */

function TutorCard({
  tutor,
  onBook,
}) {
  return (
    <div className="tutor-card">
      <div className="tutor-top">
        <div className="tutor-avatar">
          {tutor.name.charAt(0)}
        </div>

        <div>
          <h3>
            {tutor.name}
          </h3>

          <p>
            {tutor.subject}
          </p>
        </div>

        <span className="verified">
          ✓
        </span>
      </div>

      <div className="tutor-details">
        <span>
          📍 {tutor.location}
        </span>

        <span>
          ⭐ {tutor.rating} Rating
        </span>

        <span>
          🎓 Qualification Verified
        </span>

        <span>
          💼 {tutor.experience}
        </span>
      </div>

      <div className="tutor-tags">
        <span>
          {tutor.mode}
        </span>

        <span>
          {tutor.fee}
        </span>
      </div>

      <div className="tutor-footer">
        <strong>
          {tutor.available
            ? "Available"
            : "Unavailable"}
        </strong>

        <button
          className="primary-button small"
          onClick={() => onBook(tutor)}
          disabled={!tutor.available}
        >
          View & Book
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   FIND TUTOR
   ========================================================= */

function TutorPage({
  tutors,
  onBook,
}) {
  const [classValue, setClassValue] =
    useState("");

  const [subjectValue, setSubjectValue] =
    useState("");

  const [locationValue, setLocationValue] =
    useState("");

  const [searchPerformed, setSearchPerformed] =
    useState(false);

  const filteredTutors = tutors.filter(
    (tutor) => {
      const classMatches = true;

      const subjectMatches =
        !subjectValue ||
        tutor.subject === subjectValue;

      const locationMatches =
        !locationValue ||
        locationValue === "Nearby"
          ? true
          : tutor.location === locationValue ||
            tutor.mode === locationValue;

      return (
        classMatches &&
        subjectMatches &&
        locationMatches
      );
    }
  );

  function handleSearch() {
    setSearchPerformed(true);
  }

  function clearFilters() {
    setClassValue("");
    setSubjectValue("");
    setLocationValue("");
    setSearchPerformed(false);
  }

  return (
    <section>
      <PageHeader
        title="Find a Tutor"
        subtitle="Find verified online and local tutors."
        icon="👨‍🏫"
      />

      <div className="search-panel">
        <select
          value={classValue}
          onChange={(event) =>
            setClassValue(event.target.value)
          }
        >
          <option value="">
            Select Class
          </option>

          <option>Class 8</option>
          <option>Class 9</option>
          <option>Class 10</option>
          <option>Class 11</option>
          <option>Class 12</option>
          <option>JEE</option>
          <option>NEET</option>
        </select>

        <select
          value={subjectValue}
          onChange={(event) =>
            setSubjectValue(event.target.value)
          }
        >
          <option value="">
            Select Subject
          </option>

          <option>Mathematics</option>
          <option>Physics</option>
          <option>Chemistry</option>
          <option>Biology</option>
        </select>

        <select
          value={locationValue}
          onChange={(event) =>
            setLocationValue(event.target.value)
          }
        >
          <option value="">
            Location
          </option>

          <option>RK Valley</option>
          <option>Nearby</option>
          <option>Online</option>
        </select>

        <button
          className="primary-button"
          onClick={handleSearch}
        >
          Search
        </button>

        {(classValue ||
          subjectValue ||
          locationValue) && (
          <button
            className="secondary-button"
            onClick={clearFilters}
          >
            Clear
          </button>
        )}
      </div>

      {searchPerformed && (
        <div className="search-result-info">
          Showing{" "}
          <strong>
            {filteredTutors.length}
          </strong>{" "}
          tutor
          {filteredTutors.length !== 1
            ? "s"
            : ""}{" "}
          matching your search.
        </div>
      )}

      <div className="tutor-grid">
        {filteredTutors.length > 0 ? (
          filteredTutors.map((tutor) => (
            <TutorCard
              key={tutor.id}
              tutor={tutor}
              onBook={onBook}
            />
          ))
        ) : (
          <div className="empty-state">
            <div>
              🔎
            </div>

            <h3>
              No tutors found
            </h3>

            <p>
              Try changing your class,
              subject or location.
            </p>

            <button
              className="primary-button"
              onClick={clearFilters}
            >
              Reset Search
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* =========================================================
   BOOKING MODAL
   ========================================================= */

function BookingModal({
  tutor,
  onClose,
  onConfirm,
}) {
  const [date, setDate] =
    useState("");

  const [time, setTime] =
    useState("");

  const [mode, setMode] =
    useState(
      tutor?.mode?.includes("Online")
        ? "Online"
        : "Home Tuition"
    );

  if (!tutor) return null;

  function confirmBooking() {
    if (!date || !time) {
      alert(
        "Please select date and time."
      );
      return;
    }

    onConfirm({
      tutor,
      date,
      time,
      mode,
    });
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
    >
      <div
        className="booking-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <button
          className="modal-close"
          onClick={onClose}
        >
          ×
        </button>

        <div className="booking-icon">
          👨‍🏫
        </div>

        <h2>
          Book Tutor
        </h2>

        <p className="booking-tutor-name">
          {tutor.name}
        </p>

        <div className="booking-info">
          <span>
            📚 {tutor.subject}
          </span>

          <span>
            ⭐ {tutor.rating}
          </span>

          <span>
            💰 {tutor.fee}
          </span>
        </div>

        <label>
          Session Date
          <input
            type="date"
            value={date}
            onChange={(event) =>
              setDate(event.target.value)
            }
          />
        </label>

        <label>
          Session Time
          <select
            value={time}
            onChange={(event) =>
              setTime(event.target.value)
            }
          >
            <option value="">
              Select time
            </option>

            <option>
              09:00 AM
            </option>

            <option>
              10:00 AM
            </option>

            <option>
              11:00 AM
            </option>

            <option>
              04:00 PM
            </option>

            <option>
              05:00 PM
            </option>

            <option>
              06:00 PM
            </option>

            <option>
              07:00 PM
            </option>
          </select>
        </label>

        <label>
          Session Mode
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value)
            }
          >
            <option>
              Online
            </option>

            <option>
              Home Tuition
            </option>
          </select>
        </label>

        <div className="booking-actions">
          <button
            className="secondary-button"
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="primary-button"
            onClick={confirmBooking}
          >
            Confirm Booking →
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SESSIONS
   ========================================================= */

function SessionsPage({
  sessions,
  setActivePage,
}) {
  return (
    <section>
      <PageHeader
        title="My Sessions"
        subtitle="Manage your online and offline tutor sessions."
        icon="📅"
      />

      {sessions.length === 0 ? (
        <div className="empty-state">
          <div>
            📅
          </div>

          <h3>
            No sessions yet
          </h3>

          <p>
            Your booked tutor sessions
            will appear here.
          </p>

          <button
            className="primary-button"
            onClick={() =>
              setActivePage("tutors")
            }
          >
            Find a Tutor
          </button>
        </div>
      ) : (
        <div className="sessions-list">
          {sessions.map((session) => (
            <div
              className="session-card"
              key={session.id}
            >
              <div className="session-date">
                <strong>
                  {session.date}
                </strong>

                <span>
                  {session.time}
                </span>
              </div>

              <div className="session-main">
                <h3>
                  {session.tutor}
                </h3>

                <p>
                  {session.subject}
                </p>

                <div className="session-tags">
                  <span>
                    {session.mode}
                  </span>

                  <span>
                    ✓ Confirmed
                  </span>
                </div>
              </div>

              <button
                className="secondary-button small"
                onClick={() =>
                  alert(
                    `Session with ${session.tutor} is confirmed.`
                  )
                }
              >
                View Details
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   PROFILE
   ========================================================= */

function ProfilePage({
  studentName,
  studentEmail,
  stats,
}) {
  const [editing, setEditing] =
    useState(false);

  const [name, setName] =
    useState(studentName || "Student");

  const [email, setEmail] =
    useState(studentEmail || "");

  const [saved, setSaved] =
    useState(false);

  function saveProfile() {
    setEditing(false);
    setSaved(true);

    setTimeout(() => {
      setSaved(false);
    }, 2000);
  }

  return (
    <section>
      <PageHeader
        title="My Profile"
        subtitle="Manage your Learnora learning profile."
        icon="👤"
      />

      <div className="profile-card">
        <div className="profile-avatar">
          {name
            ? name.charAt(0).toUpperCase()
            : "S"}
        </div>

        {!editing ? (
          <>
            <h2>
              {name}
            </h2>

            <p>
              {email || "Learnora Student"}
            </p>

            <div className="profile-status">
              ✓ Account active
            </div>

            <div className="profile-stats">
              <div>
                <strong>
                  {stats.problemsSolved}
                </strong>

                <span>
                  Problems
                </span>
              </div>

              <div>
                <strong>
                  {stats.tutorSessions}
                </strong>

                <span>
                  Sessions
                </span>
              </div>

              <div>
                <strong>
                  {stats.progress}%
                </strong>

                <span>
                  Progress
                </span>
              </div>
            </div>

            <button
              className="primary-button"
              onClick={() =>
                setEditing(true)
              }
            >
              Edit Profile
            </button>
          </>
        ) : (
          <div className="profile-edit">
            <h2>
              Edit Profile
            </h2>

            <input
              className="login-input"
              value={name}
              onChange={(event) =>
                setName(event.target.value)
              }
              placeholder="Full name"
            />

            <input
              className="login-input"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="Email"
            />

            <div className="profile-edit-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  setEditing(false)
                }
              >
                Cancel
              </button>

              <button
                className="primary-button"
                onClick={saveProfile}
              >
                Save Changes
              </button>
            </div>
          </div>
        )}

        {saved && (
          <div className="profile-saved">
            ✓ Profile updated successfully
          </div>
        )}
      </div>
    </section>
  );
}

/* =========================================================
   STUDENT DASHBOARD
   ========================================================= */

function StudentDashboard({
  onLogout,
  studentName,
  studentEmail,
}) {
  const [activePage, setActivePage] =
    useState("home");

  /* AI */

  const [questionImage, setQuestionImage] =
    useState(null);

  const [questionText, setQuestionText] =
    useState("");

  const [aiLoading, setAiLoading] =
    useState(false);

  const [aiSolved, setAiSolved] =
    useState(false);

  const fileInputRef =
    useRef(null);

  /* TUTORS */

  const [tutors] =
    useState(INITIAL_TUTORS);

  /* BOOKING */

  const [selectedTutor, setSelectedTutor] =
    useState(null);

  /* SESSIONS */

  const [sessions, setSessions] =
    useState([]);

  /* STATS */

  const [stats, setStats] =
    useState({
      problemsSolved: 0,
      tutorSessions: 0,
      progress: 0,
      streak: 0,
    });

  /* =====================================================
     AI IMAGE
     ===================================================== */

  function removeImage() {
    setQuestionImage(null);
    setAiSolved(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  /* =====================================================
     AI SOLVER
     ===================================================== */

  function solveProblem() {
    if (
      !questionImage &&
      !questionText.trim()
    ) {
      alert(
        "Please upload a question photo or type a question first."
      );

      return;
    }

    setAiLoading(true);
    setAiSolved(false);

    /*
      Demo AI processing.

      Later this function can be replaced
      with the real Learnora AI API call.
    */

    setTimeout(() => {
      setAiLoading(false);
      setAiSolved(true);

      setStats((previous) => ({
        ...previous,
        problemsSolved:
          previous.problemsSolved + 1,
        progress:
          Math.min(
            previous.progress + 2,
            100
          ),
        streak:
          previous.streak === 0
            ? 1
            : previous.streak,
      }));
    }, 1800);
  }

  /* =====================================================
     BOOKING
     ===================================================== */

  function openBooking(tutor) {
    setSelectedTutor(tutor);
  }

  function closeBooking() {
    setSelectedTutor(null);
  }

  function confirmBooking(data) {
    const newSession = {
      id: Date.now(),
      tutor: data.tutor.name,
      subject: data.tutor.subject,
      date: data.date,
      time: data.time,
      mode: data.mode,
    };

    setSessions((previous) => [
      newSession,
      ...previous,
    ]);

    setStats((previous) => ({
      ...previous,
      tutorSessions:
        previous.tutorSessions + 1,
      progress:
        Math.min(
          previous.progress + 5,
          100
        ),
    }));

    setSelectedTutor(null);
    setActivePage("sessions");

    alert(
      `Session booked successfully with ${data.tutor.name}!`
    );
  }

  /* =====================================================
     LOGOUT
     ===================================================== */

  function handleLogout() {
    const shouldLogout =
      window.confirm(
        "Are you sure you want to logout?"
      );

    if (shouldLogout) {
      onLogout();
    }
  }

  return (
    <div className="dashboard-layout">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        onLogout={handleLogout}
        studentName={
          studentName || "Student"
        }
      />

      <main className="dashboard-main">

        {/* =============================================
            HOME
        ============================================= */}

        {activePage === "home" && (
          <StudentHome
            studentName={
              studentName || "Student"
            }
            stats={stats}
            setActivePage={setActivePage}
            sessions={sessions}
          />
        )}

        {/* =============================================
            AI
        ============================================= */}

        {activePage === "ai" && (
          <AIPage
            questionImage={questionImage}
            setQuestionImage={setQuestionImage}
            questionText={questionText}
            setQuestionText={setQuestionText}
            aiLoading={aiLoading}
            aiSolved={aiSolved}
            solveProblem={solveProblem}
            removeImage={removeImage}
            fileInputRef={fileInputRef}
          />
        )}

        {/* =============================================
            TUTORS
        ============================================= */}

        {activePage === "tutors" && (
          <TutorPage
            tutors={tutors}
            onBook={openBooking}
          />
        )}

        {/* =============================================
            SESSIONS
        ============================================= */}

        {activePage === "sessions" && (
          <SessionsPage
            sessions={sessions}
            setActivePage={setActivePage}
          />
        )}

        {/* =============================================
            PROFILE
        ============================================= */}

        {activePage === "profile" && (
          <ProfilePage
            studentName={
              studentName || "Student"
            }
            studentEmail={
              studentEmail || ""
            }
            stats={stats}
          />
        )}
      </main>

      {/* ===============================================
          BOOKING MODAL
      =============================================== */}

      {selectedTutor && (
        <BookingModal
          tutor={selectedTutor}
          onClose={closeBooking}
          onConfirm={confirmBooking}
        />
      )}
    </div>
  );
}

/* =========================================================
   PARENT DASHBOARD
   ========================================================= */

function ParentDashboard({
  onLogout,
  studentName,
}) {
  return (
    <div className="placeholder-page">
      <Logo />

      <div className="placeholder-card">
        <div className="placeholder-icon">
          👨‍👩‍👧
        </div>

        <h1>
          Parent Dashboard
        </h1>

        <p>
          Parent dashboard is being prepared
          for the next Learnora release.
        </p>

        <div className="placeholder-features">
          <span>
            📊 Learning Progress
          </span>

          <span>
            📅 Session Tracking
          </span>

          <span>
            👨‍🏫 Tutor Updates
          </span>

          <span>
            🔔 Notifications
          </span>
        </div>

        <button
          className="primary-button"
          onClick={onLogout}
        >
          ← Back to Learnora
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   TUTOR DASHBOARD
   ========================================================= */

function TutorDashboard({
  onLogout,
}) {
  return (
    <div className="placeholder-page">
      <Logo />

      <div className="placeholder-card">
        <div className="placeholder-icon">
          👨‍🏫
        </div>

        <h1>
          Tutor Dashboard
        </h1>

        <p>
          Tutor tools are being prepared
          for the next Learnora release.
        </p>

        <div className="placeholder-features">
          <span>
            👨‍🎓 Student Requests
          </span>

          <span>
            📅 Sessions
          </span>

          <span>
            💰 Earnings
          </span>

          <span>
            ⭐ Tutor Rating
          </span>
        </div>

        <button
          className="primary-button"
          onClick={onLogout}
        >
          ← Back to Learnora
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [selectedRole, setSelectedRole] =
    useState(null);

  const [loggedIn, setLoggedIn] =
    useState(false);

  const [user, setUser] =
    useState({
      name: "Student",
      email: "",
    });

  /* ================================================
     LOGIN SUCCESS
  ================================================ */

  function handleLogin(userData) {
    setUser({
      name:
        userData?.name ||
        "Student",
      email:
        userData?.email ||
        "",
    });

    setLoggedIn(true);
  }

  /* ================================================
     LOGOUT
  ================================================ */

  function handleLogout() {
    setLoggedIn(false);
    setSelectedRole(null);

    setUser({
      name: "Student",
      email: "",
    });
  }

  /* ================================================
     STUDENT
  ================================================ */

  if (
    loggedIn &&
    selectedRole === "student"
  ) {
    return (
      <StudentDashboard
        onLogout={handleLogout}
        studentName={user.name}
        studentEmail={user.email}
      />
    );
  }

  /* ================================================
     PARENT
  ================================================ */

  if (
    loggedIn &&
    selectedRole === "parent"
  ) {
    return (
      <ParentDashboard
        onLogout={handleLogout}
        studentName={user.name}
      />
    );
  }

  /* ================================================
     TUTOR
  ================================================ */

  if (
    loggedIn &&
    selectedRole === "tutor"
  ) {
    return (
      <TutorDashboard
        onLogout={handleLogout}
      />
    );
  }

  /* ================================================
     LOGIN
  ================================================ */

  if (selectedRole) {
    return (
      <Login
        role={selectedRole}
        onBack={() =>
          setSelectedRole(null)
        }
        onLogin={handleLogin}
      />
    );
  }

  /* ================================================
     HOME
  ================================================ */

  return (
    <Home
      onSelectRole={setSelectedRole}
    />
  );
}

export default App;