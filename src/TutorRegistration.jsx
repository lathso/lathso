import React, { useState } from "react";
import { auth, db } from "./firebase.js";
import { supabase } from "./lib/supabase.js";
import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

export default function TutorRegistration({ onBack, onSubmitted }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "Mathematics",
    qualification: "",
    experience: "",
    location: "",
    classes: "Class 8 - 10",
    educationProof: null,
    idProof: null,
    verification: "Demo Video",
    demoVideo: null,
    interviewDate: "",
    interviewTime: "",
  });

  const [submitted, setSubmitted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function update(field, value) {
    setForm((old) => ({
      ...old,
      [field]: value,
    }));
    setErrorMessage("");
  }

  function validateFile(file, kind) {
    if (!file) {
      return kind === "video"
        ? "Please select your demo video."
        : "Please select the required document.";
    }

    const maxSize =
      kind === "video"
        ? 100 * 1024 * 1024
        : 10 * 1024 * 1024;

    if (file.size > maxSize) {
      return kind === "video"
        ? "Demo video must be 100 MB or smaller."
        : "Documents must be 10 MB or smaller.";
    }

    if (kind === "video") {
      if (!file.type.startsWith("video/")) {
        return "Please select a valid video file.";
      }
    } else {
      const allowed = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp",
      ];

      if (!allowed.includes(file.type)) {
        return "Please upload PDF, JPG, PNG or WEBP.";
      }
    }

    return "";
  }

  async function uploadTutorFile(file, folder, tutorId) {
    const apiBase =
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:5000";

    const body = new FormData();
    body.append("file", file);
    body.append("tutorId", tutorId);
    body.append("folder", folder);

    const response = await fetch(
      `${apiBase}/api/tutor/upload`,
      {
        method: "POST",
        body,
      }
    );

    let result = null;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        "Backend returned an invalid response."
      );
    }

    if (!response.ok || !result?.success) {
      throw new Error(
        result?.message ||
          "File upload failed."
      );
    }

    return result;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (submitting) return;

    setErrorMessage("");

    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.phone.trim() ||
      !form.qualification.trim() ||
      !form.experience.trim() ||
      !form.location.trim() ||
      !form.educationProof ||
      !form.idProof
    ) {
      setErrorMessage(
        "Please complete all required fields."
      );
      return;
    }

    if (
      form.verification === "Demo Video" &&
      !form.demoVideo
    ) {
      setErrorMessage(
        "Please upload/select your demo video."
      );
      return;
    }

    if (
      form.verification === "Interview" &&
      (!form.interviewDate ||
        !form.interviewTime)
    ) {
      setErrorMessage(
        "Please select interview date and time."
      );
      return;
    }

    const educationError = validateFile(
      form.educationProof,
      "document"
    );

    if (educationError) {
      setErrorMessage(educationError);
      return;
    }

    const idError = validateFile(
      form.idProof,
      "document"
    );

    if (idError) {
      setErrorMessage(idError);
      return;
    }

    if (form.verification === "Demo Video") {
      const demoError = validateFile(
        form.demoVideo,
        "video"
      );

      if (demoError) {
        setErrorMessage(demoError);
        return;
      }
    }

    const user = auth.currentUser;

    if (!user) {
      setErrorMessage(
        "Your login session has expired. Please log in again."
      );
      return;
    }

    try {
      setSubmitting(true);

      setUploadProgress(
        "Uploading education certificate..."
      );

      const educationUpload =
        await uploadTutorFile(
          form.educationProof,
          "education-proof",
          user.uid
        );

      setUploadProgress(
        "Uploading government ID..."
      );

      const idUpload =
        await uploadTutorFile(
          form.idProof,
          "id-proof",
          user.uid
        );

      let demoUpload = null;

      if (
        form.verification === "Demo Video"
      ) {
        setUploadProgress(
          "Uploading teaching demo video..."
        );

        demoUpload =
          await uploadTutorFile(
            form.demoVideo,
            "demo-video",
            user.uid
          );
      }

      setUploadProgress(
        "Saving verification application..."
      );

      const application = {
        tutor_id: user.uid,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        subject: form.subject,
        qualification: form.qualification.trim(),
        education: form.qualification.trim(),
        experience: `${form.experience.trim()} Years`,
        location: form.location.trim(),
        classes: form.classes,
        education_proof: educationUpload.path,
        education_proof_name: educationUpload.name,
        id_proof: idUpload.path,
        id_proof_name: idUpload.name,
        verification: form.verification,
        demo_video: demoUpload?.path || "",
        demo_video_name: demoUpload?.name || "",
        interview_date: form.verification === "Interview" ? form.interviewDate || null : null,
        interview_time: form.verification === "Interview" ? form.interviewTime || null : null,
        status: "Pending",
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: savedApplication, error: applicationError } =
        await supabase
          .from("tutor_applications")
          .insert(application)
          .select()
          .single();

      if (applicationError) {
        console.error("Supabase application error:", applicationError);
        throw new Error(applicationError.message || "Could not save tutor application.");
      }

      await setDoc(
        doc(db, "users", user.uid),
        {
          fullName: application.name,
          email: application.email,
          phone: application.phone,
          role: "tutor",
          subject: application.subject,
          education: application.education,
          experience: application.experience,
          location: application.location,
          classes: application.classes,
          verified: false,
          available: false,
          verificationStatus: "Pending",
          latestTutorApplicationId: savedApplication.id,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const existing =
        JSON.parse(localStorage.getItem("learnoraTutorApplications")) || [];

      const localApplication = {
        ...application,
        id: savedApplication.id,
        tutorId: application.tutor_id,
        submittedAt: application.submitted_at,
        educationProof: application.education_proof,
        educationProofPath: application.education_proof,
        educationProofName: application.education_proof_name,
        idProof: application.id_proof,
        idProofPath: application.id_proof,
        idProofName: application.id_proof_name,
        demoVideo: application.demo_video,
        demoVideoPath: application.demo_video,
        demoVideoName: application.demo_video_name,
      };

      localStorage.setItem(
        "learnoraTutorApplications",
        JSON.stringify([localApplication, ...existing])
      );

      setSubmitted(true);
      setUploadProgress("");

      if (onSubmitted) {
        onSubmitted(localApplication);
      }
    } catch (error) {
      console.error(
        "Tutor verification submit error:",
        error
      );

      setErrorMessage(
        error?.message ||
          "Could not submit verification. Please try again."
      );
    } finally {
      setSubmitting(false);
      setUploadProgress("");
    }
  }

  if (submitted) {
    return (
      <section className="tutor-registration-page">
        <div className="tr-success">
          <div className="tr-success-icon">✓</div>

          <span className="tr-eyebrow">APPLICATION SUBMITTED</span>

          <h1>Application sent successfully 🎉</h1>

          <p>
            Your tutor application has been submitted to Lathso Admin.
            Our team will verify your education proofs and teaching
            verification.
          </p>

          <div className="tr-success-box">
            <div>
              <span>Status</span>
              <strong>⏳ Pending Verification</strong>
            </div>

            <div>
              <span>Verification Method</span>
              <strong>{form.verification}</strong>
            </div>
          </div>

          <button className="tr-primary" onClick={onBack}>
            Back to Tutor Dashboard →
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="tutor-registration-page">
      <style>{registrationCSS}</style>

      <div className="tr-header">
        <div>
          <span className="tr-eyebrow">BECOME A LATHSO TUTOR</span>

          <h1>Tutor Verification Application 👨‍🏫</h1>

          <p>
            Complete your profile and submit your proofs for Admin
            verification.
          </p>
        </div>

        <button className="tr-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>

      {errorMessage && (
        <div className="tr-error" role="alert">
          ⚠️ {errorMessage}
        </div>
      )}

      {uploadProgress && (
        <div className="tr-upload-progress" role="status">
          <span className="tr-spinner" />
          <span>{uploadProgress}</span>
        </div>
      )}

      <form className="tr-form" onSubmit={handleSubmit}>
        {/* PROFILE */}

        <div className="tr-card">
          <div className="tr-card-title">
            <div className="tr-number">01</div>

            <div>
              <h2>Personal & Teaching Profile</h2>
              <p>Tell us about yourself.</p>
            </div>
          </div>

          <div className="tr-grid">
            <Field
              label="Full Name *"
              value={form.name}
              onChange={(v) => update("name", v)}
              placeholder="Enter your full name"
            />

            <Field
              label="Email *"
              type="email"
              value={form.email}
              onChange={(v) => update("email", v)}
              placeholder="you@example.com"
            />

            <Field
              label="Phone Number *"
              value={form.phone}
              onChange={(v) => update("phone", v)}
              placeholder="9876543210"
            />

            <label>
              Subject *
              <select
                value={form.subject}
                onChange={(e) => update("subject", e.target.value)}
              >
                <option>Mathematics</option>
                <option>Physics</option>
                <option>Chemistry</option>
                <option>Biology</option>
                <option>English</option>
                <option>Computer Science</option>
              </select>
            </label>

            <Field
              label="Highest Qualification *"
              value={form.qualification}
              onChange={(v) => update("qualification", v)}
              placeholder="Example: M.Sc Mathematics"
            />

            <Field
              label="Teaching Experience *"
              value={form.experience}
              onChange={(v) => update("experience", v)}
              placeholder="Example: 5"
              type="number"
            />

            <Field
              label="City / Location *"
              value={form.location}
              onChange={(v) => update("location", v)}
              placeholder="Example: Nellore"
            />

            <label>
              Classes You Teach *
              <select
                value={form.classes}
                onChange={(e) => update("classes", e.target.value)}
              >
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

        {/* DOCUMENTS */}

        <div className="tr-card">
          <div className="tr-card-title">
            <div className="tr-number">02</div>

            <div>
              <h2>Education & Identity Proofs</h2>
              <p>These documents will be reviewed by Admin.</p>
            </div>
          </div>

          <div className="tr-grid">
            <FileField
              label="Education Certificate *"
              value={form.educationProof}
              onChange={(v) => update("educationProof", v)}
              accept=".pdf,.jpg,.jpeg,.png,.webp"
            />

            <FileField
              label="Government ID Proof *"
              value={form.idProof}
              onChange={(v) => update("idProof", v)}
              accept=".pdf,.jpg,.jpeg,.png,.webp"
            />
          </div>

          <div className="tr-info">
            🎓 <strong>Why do we need this?</strong>
            <span>
              Lathso verifies tutor qualifications before allowing
              them to teach students.
            </span>
          </div>
        </div>

        {/* VERIFICATION */}

        <div className="tr-card">
          <div className="tr-card-title">
            <div className="tr-number">03</div>

            <div>
              <h2>Teaching Verification</h2>
              <p>Choose one verification method.</p>
            </div>
          </div>

          <div className="verification-choice">
            <button
              type="button"
              className={
                form.verification === "Demo Video"
                  ? "choice active"
                  : "choice"
              }
              onClick={() => update("verification", "Demo Video")}
            >
              <span>🎥</span>

              <div>
                <strong>Demo Video</strong>
                <small>Submit a short teaching demo.</small>
              </div>
            </button>

            <button
              type="button"
              className={
                form.verification === "Interview"
                  ? "choice active"
                  : "choice"
              }
              onClick={() => update("verification", "Interview")}
            >
              <span>🎤</span>

              <div>
                <strong>Interview</strong>
                <small>Choose an interview slot.</small>
              </div>
            </button>
          </div>

          {form.verification === "Demo Video" && (
            <div className="verification-input">
              <label>
                Demo Video *
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) =>
                    update(
                      "demoVideo",
                      e.target.files?.[0]?.name || ""
                    )
                  }
                />
              </label>

              {form.demoVideo && (
                <div className="selected-file">
                  🎥 {form.demoVideo.name}
                </div>
              )}
            </div>
          )}

          {form.verification === "Interview" && (
            <div className="tr-grid verification-input">
              <label>
                Interview Date *
                <input
                  type="date"
                  value={form.interviewDate}
                  onChange={(e) =>
                    update("interviewDate", e.target.value)
                  }
                />
              </label>

              <label>
                Interview Time *
                <input
                  type="time"
                  value={form.interviewTime}
                  onChange={(e) =>
                    update("interviewTime", e.target.value)
                  }
                />
              </label>
            </div>
          )}
        </div>

        {/* SUBMIT */}

        <div className="tr-submit">
          <div>
            <strong>Ready to submit?</strong>
            <span>
              Admin will review your application before approval.
            </span>
          </div>

          <button
            className="tr-primary"
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? "Submitting..."
              : "Submit for Verification →"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}) {
  return (
    <label>
      {label}

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function FileField({
  label,
  value,
  onChange,
  accept,
}) {
  return (
    <label>
      {label}

      <input
        type="file"
        accept={accept}
        onChange={(e) =>
          onChange(e.target.files?.[0] || null)
        }
      />

      {value && (
        <div className="selected-file">
          📄 {value.name}
        </div>
      )}
    </label>
  );
}

const registrationCSS = `
.tutor-registration-page {
  width: 100%;
}

.tr-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 26px;
}

.tr-eyebrow {
  color: #a78bfa;
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .15em;
}

.tr-header h1 {
  margin: 8px 0 7px;
  font-size: 34px;
  letter-spacing: -.035em;
}

.tr-header p {
  margin: 0;
  color: #858193;
  font-size: 11px;
}

.tr-form {
  display: grid;
  gap: 16px;
}

.tr-card {
  padding: 22px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 19px;
  background: rgba(255,255,255,.035);
}

.tr-card-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.tr-number {
  width: 35px;
  height: 35px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 10px;
  background: rgba(124,92,255,.12);
  color: #b9aaff;
  font-size: 9px;
  font-weight: 900;
}

.tr-card-title h2 {
  margin: 0 0 4px;
  font-size: 16px;
}

.tr-card-title p {
  margin: 0;
  color: #817d90;
  font-size: 9px;
}

.tr-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 13px;
}

.tr-card label {
  display: grid;
  gap: 6px;
  color: #aaa6b7;
  font-size: 9px;
  font-weight: 750;
}

.tr-card input,
.tr-card select {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
  outline: none;
  background: #0d0c1a;
  color: white;
}

.tr-card input:focus,
.tr-card select:focus {
  border-color: rgba(139,92,246,.55);
}

.tr-info {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 14px;
  padding: 12px;
  border-radius: 11px;
  background: rgba(124,92,255,.06);
  color: #817d90;
  font-size: 9px;
}

.tr-info strong {
  color: #b9aaff;
}

.selected-file {
  margin-top: 7px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(34,197,94,.07);
  color: #86efac;
  font-size: 8px;
}

.verification-choice {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.choice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 13px;
  background: rgba(255,255,255,.025);
  color: white;
  text-align: left;
}

.choice:hover {
  border-color: rgba(139,92,246,.3);
}

.choice.active {
  border-color: rgba(139,92,246,.6);
  background: rgba(124,92,255,.1);
}

.choice > span {
  font-size: 24px;
}

.choice strong,
.choice small {
  display: block;
}

.choice strong {
  font-size: 10px;
}

.choice small {
  margin-top: 4px;
  color: #817d90;
  font-size: 8px;
}

.verification-input {
  margin-top: 15px;
}

.tr-secondary {
  padding: 9px 13px;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
  background: #151329;
  color: #ddd9eb;
  font-size: 9px;
  font-weight: 800;
}

.tr-error {
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(248,113,113,.25);
  border-radius: 11px;
  background: rgba(248,113,113,.08);
  color: #fca5a5;
  font-size: 10px;
  line-height: 1.5;
}

.tr-upload-progress {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 14px;
  padding: 11px 14px;
  border: 1px solid rgba(139,92,246,.2);
  border-radius: 11px;
  background: rgba(124,92,255,.07);
  color: #c4b5fd;
  font-size: 10px;
}

.tr-spinner {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  border: 2px solid rgba(255,255,255,.2);
  border-top-color: #a78bfa;
  border-radius: 50%;
  animation: tr-spin .8s linear infinite;
}

@keyframes tr-spin {
  to {
    transform: rotate(360deg);
  }
}

.tr-primary {
  padding: 11px 16px;
  border: 1px solid rgba(167,139,250,.2);
  border-radius: 10px;
  background: linear-gradient(135deg,#6d3df0,#8057f6);
  color: white;
  font-size: 10px;
  font-weight: 850;
  box-shadow: 0 8px 24px rgba(109,61,240,.2);
  cursor: pointer;
}

.tr-primary:disabled {
  opacity: .65;
  cursor: not-allowed;
}

.tr-submit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
  border: 1px solid rgba(139,92,246,.2);
  border-radius: 17px;
  background: rgba(124,92,255,.06);
}

.tr-submit strong,
.tr-submit span {
  display: block;
}

.tr-submit strong {
  font-size: 11px;
}

.tr-submit span {
  margin-top: 4px;
  color: #817d90;
  font-size: 9px;
}

.tr-success {
  max-width: 650px;
  margin: 60px auto;
  padding: 40px;
  border: 1px solid rgba(34,197,94,.2);
  border-radius: 22px;
  background: rgba(255,255,255,.035);
  text-align: center;
}

.tr-success-icon {
  width: 65px;
  height: 65px;
  display: grid;
  place-items: center;
  margin: 0 auto 20px;
  border-radius: 20px;
  background: rgba(34,197,94,.1);
  color: #86efac;
  font-size: 30px;
  font-weight: 900;
}

.tr-success h1 {
  margin: 9px 0;
  font-size: 27px;
}

.tr-success > p {
  color: #817d90;
  font-size: 11px;
  line-height: 1.7;
}

.tr-success-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 22px 0;
}

.tr-success-box div {
  padding: 13px;
  border-radius: 12px;
  background: rgba(255,255,255,.035);
}

.tr-success-box span,
.tr-success-box strong {
  display: block;
}

.tr-success-box span {
  color: #817d90;
  font-size: 8px;
}

.tr-success-box strong {
  margin-top: 5px;
  font-size: 10px;
}

@media(max-width:650px) {
  .tr-header,
  .tr-submit {
    flex-direction: column;
  }

  .tr-grid,
  .verification-choice,
  .tr-success-box {
    grid-template-columns: 1fr;
  }

  .tr-header h1 {
    font-size: 27px;
  }

  .tr-success {
    padding: 25px 18px;
  }

  .tr-submit .tr-primary {
    width: 100%;
  }
}
`;