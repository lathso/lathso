require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const {
  initializeApp,
  applicationDefault,
  getApps,
} = require("firebase-admin/app");

const {
  getFirestore,
  FieldValue,
} = require("firebase-admin/firestore");

const {
  getAuth,
} = require("firebase-admin/auth");

const app = express();

const PORT = process.env.PORT || 5000;


/* =====================================================
   FIREBASE ADMIN
   ===================================================== */

if (getApps().length === 0) {
  initializeApp({
    credential: applicationDefault(),
  });
}

const db = getFirestore();
const firebaseAuth = getAuth();


/* =====================================================
   RAZORPAY
   ===================================================== */

if (
  !process.env.RAZORPAY_KEY_ID ||
  !process.env.RAZORPAY_KEY_SECRET
) {
  console.warn(
    "Razorpay credentials are missing ⚠️"
  );
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


/* =====================================================
   MIDDLEWARE
   ===================================================== */

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);


/* =====================================================
   RAZORPAY WEBHOOK
   IMPORTANT: RAW REQUEST BODY
   ===================================================== */

app.post(
  "/api/payments/webhook",
  express.raw({
    type: "application/json",
  }),
  async (req, res) => {
    try {
      const signature =
        req.headers["x-razorpay-signature"];

      const webhookSecret =
        process.env.RAZORPAY_WEBHOOK_SECRET;

      if (!webhookSecret) {
        return res.status(500).json({
          success: false,
          message:
            "Webhook secret is not configured.",
        });
      }

      const expected = crypto
        .createHmac(
          "sha256",
          webhookSecret
        )
        .update(req.body)
        .digest("hex");

      if (signature !== expected) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid webhook signature.",
        });
      }

      const event = JSON.parse(
        req.body.toString("utf8")
      );

      const paymentEntity =
        event?.payload?.payment?.entity;

      const orderEntity =
        event?.payload?.order?.entity;

      const paymentId =
        paymentEntity?.id;

      const orderId =
        paymentEntity?.order_id ||
        orderEntity?.id;

      if (
        event.event ===
          "payment.captured" &&
        paymentId &&
        orderId
      ) {
        const orderRef =
          db
            .collection("paymentOrders")
            .doc(orderId);

        const orderSnap =
          await orderRef.get();

        if (orderSnap.exists) {
          await fulfillVerifiedPayment({
            orderId,
            paymentId,
            orderData:
              orderSnap.data(),
            source: "webhook",
          });
        }
      }

      return res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Razorpay webhook error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Webhook processing failed.",
      });
    }
  }
);


/* =====================================================
   JSON BODY
   ===================================================== */

app.use(express.json());


/* =====================================================
   MULTER
   Maximum file size = 50 MB
   ===================================================== */

const upload = multer({
  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      50 * 1024 * 1024,
  },

  fileFilter:
    (req, file, cb) => {
      const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf",
        "video/mp4",
        "video/webm",
        "video/quicktime",
      ];

      if (
        !allowedTypes.includes(
          file.mimetype
        )
      ) {
        return cb(
          new Error(
            "Unsupported file type. Please upload PDF, JPG, PNG, WEBP, MP4, WEBM or MOV."
          )
        );
      }

      cb(null, true);
    },
});


/* =====================================================
   OPENAI
   ===================================================== */

let openai = null;

if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY.trim(),
  });
} else {
  console.warn("OPENAI_API_KEY is missing ⚠️");
}


/* =====================================================
   FIREBASE AUTH HELPER
   ===================================================== */

async function requireFirebaseUser(
  req,
  res,
  next
) {
  try {
    const authHeader =
      req.headers.authorization ||
      "";

    if (
      !authHeader.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication required.",
      });
    }

    const idToken =
      authHeader
        .substring(
          "Bearer ".length
        )
        .trim();

    const decoded =
      await firebaseAuth.verifyIdToken(
        idToken
      );

    req.firebaseUser =
      decoded;

    return next();
  } catch (error) {
    console.error(
      "Firebase auth verification error:",
      error.message
    );

    return res.status(401).json({
      success: false,
      message:
        "Invalid or expired authentication token.",
    });
  }
}


/* =====================================================
   SUBSCRIPTION PLANS
   ===================================================== */

const PLAN_CATALOG = {
  pay_per_doubt: {
    id: "pay_per_doubt",
    name: "Unlimited Doubts",
    amount: 29900,
    price: "₹299",
    period: "/ month",

    description:
      "Unlimited AI doubts for ₹299 per month",

    features: [
      "Unlimited AI doubts",
      "Text doubt support",
      "Image doubt support",
      "No per-doubt charges",
    ],
  },

  single_tutor: {
    id: "single_tutor",
    name: "Single Tutor Plan",
    amount: 49900,
    price: "₹499",
    period: "/ month",

    description:
      "1 Dedicated Tutor - 1 Hour Daily Session",

    features: [
      "1 Dedicated Tutor",
      "1 Hour Daily Session",
      "Regular tutor support",
      "Monthly learning plan",
    ],
  },

  multi_subject: {
    id: "multi_subject",
    name: "Multi-Subject Plan",
    amount: 99900,
    price: "₹999",
    period: "/ month",

    description:
      "3 Tutors - 45 Mins Daily Sessions",

    features: [
      "3 Tutors",
      "45 Mins Daily Sessions",
      "Multi-subject learning",
      "Regular tutor support",
    ],
  },
};


/* =====================================================
   GET PLAN
   ===================================================== */

function getPlan(planId) {
  return (
    PLAN_CATALOG[
      String(planId || "").trim()
    ] || null
  );
}


/* =====================================================
   PLATFORM COMMISSION
   Subscription only: 15% Lathso / 85% tutor pool.
   Wallet top-ups: 0% commission.
===================================================== */

const PLATFORM_COMMISSION_PERCENT = Math.min(100, Math.max(0, Number(process.env.PLATFORM_COMMISSION_PERCENT || 15)));

function calculateSubscriptionSplit(amountPaise) {
  const totalPaise = Number(amountPaise || 0);
  const platformCommissionPaise = Math.round(
    totalPaise * PLATFORM_COMMISSION_PERCENT / 100
  );
  return {
    totalPaise,
    platformCommissionPaise,
    tutorPoolPaise: Math.max(0, totalPaise - platformCommissionPaise),
  };
}

async function requireAdmin(req, res, next) {
  try {
    await requireFirebaseUser(req, res, async () => {
      const uid = req.firebaseUser.uid;
      const token = req.firebaseUser;
      const profileSnap = await db.collection("users").doc(uid).get();
      const profile = profileSnap.exists ? profileSnap.data() : {};
      const isAdmin =
        profile.role === "admin" ||
        token.admin === true ||
        token.role === "admin";
      if (!isAdmin) {
        return res.status(403).json({ success: false, message: "Admin access required." });
      }
      return next();
    });
  } catch (error) {
    console.error("Admin authorization error:", error);
    return res.status(403).json({ success: false, message: "Admin access required." });
  }
}


/* =====================================================
   FULFILL VERIFIED PAYMENT
   ===================================================== */

async function fulfillVerifiedPayment({
  orderId,
  paymentId,
  orderData,
  source,
}) {
  if (
    !orderData ||
    orderData.fulfilled === true
  ) {
    return {
      fulfilled: true,
      alreadyFulfilled: true,
    };
  }

  /* ---------------------------------------------------
     FETCH PAYMENT DIRECTLY FROM RAZORPAY
     --------------------------------------------------- */

  const payment =
    await razorpay.payments.fetch(
      paymentId
    );

  if (
    !payment ||
    payment.status !==
      "captured"
  ) {
    throw new Error(
      "Payment is not captured."
    );
  }


  /* ---------------------------------------------------
     VERIFY ORDER
     --------------------------------------------------- */

  if (
    String(payment.order_id) !==
    String(orderId)
  ) {
    throw new Error(
      "Payment/order mismatch."
    );
  }


  /* ---------------------------------------------------
     VERIFY AMOUNT
     --------------------------------------------------- */

  if (
    Number(payment.amount) !==
    Number(orderData.amount)
  ) {
    throw new Error(
      "Payment amount mismatch."
    );
  }


  const uid =
    orderData.uid;

  if (!uid) {
    throw new Error(
      "Payment order has no user id."
    );
  }


  const batch =
    db.batch();

  const orderRef =
    db
      .collection(
        "paymentOrders"
      )
      .doc(orderId);

  const paymentRef =
    db
      .collection("payments")
      .doc(paymentId);


  /* ---------------------------------------------------
     PAYMENT ORDER
     --------------------------------------------------- */

  batch.set(
    orderRef,
    {
      fulfilled: true,

      status:
        "captured",

      paymentId,

      fulfilledAt:
        FieldValue.serverTimestamp(),

      fulfilledSource:
        source,

      updatedAt:
        FieldValue.serverTimestamp(),
    },
    {
      merge: true,
    }
  );


  /* ---------------------------------------------------
     PAYMENT RECORD
     --------------------------------------------------- */

  batch.set(
    paymentRef,
    {
      uid,

      orderId,

      paymentId,

      amount:
        Number(payment.amount),

      currency:
        payment.currency ||
        "INR",

      status:
        "captured",

      type:
        orderData.type ||
        "unknown",

      planId:
        orderData.planId ||
        null,

      createdAt:
        FieldValue.serverTimestamp(),
    },
    {
      merge: true,
    }
  );


  /* ===================================================
     SUBSCRIPTION PAYMENT
     =================================================== */

  if (
    orderData.type ===
    "subscription"
  ) {
    const plan =
      getPlan(
        orderData.planId
      );

    if (!plan) {
      throw new Error(
        "Unknown subscription plan."
      );
    }

    const split = calculateSubscriptionSplit(payment.amount);
    const hasTutorService = ["single_tutor", "multi_subject"].includes(plan.id);
    const tutorAllocationStatus = hasTutorService ? "pending" : "not_applicable";

    const subscriptionRef =
      db
        .collection(
          "subscriptions"
        )
        .doc(uid);

    batch.set(
      subscriptionRef,
      {
        userId: uid,

        planId: plan.id,

        planName:
          plan.name,

        price:
          plan.price,

        period:
          plan.period,

        description:
          plan.description,

        features:
          plan.features,

        active: true,

        paymentStatus:
          "paid",

        commissionPercent:
          PLATFORM_COMMISSION_PERCENT,

        subscriptionAmountPaise:
          split.totalPaise,

        platformCommissionPaise:
          split.platformCommissionPaise,

        tutorPoolPaise:
          split.tutorPoolPaise,

        tutorAllocationStatus,

        razorpayOrderId:
          orderId,

        razorpayPaymentId:
          paymentId,

        activatedAt:
          FieldValue.serverTimestamp(),

        updatedAt:
          FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      }
    );
    const revenueRef = db.collection("platformRevenue").doc(paymentId);
    batch.set(
      revenueRef,
      {
        paymentId,
        orderId,
        uid,
        type: "subscription",
        planId: plan.id,
        amountPaise: split.totalPaise,
        platformCommissionPaise: split.platformCommissionPaise,
        tutorPoolPaise: hasTutorService ? split.tutorPoolPaise : 0,
        tutorAllocationStatus,
        payoutStatus: hasTutorService ? "pending_tutor_allocation" : "not_applicable",
        status: "captured",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }


  /* ===================================================
     WALLET TOP-UP
     =================================================== */

  if (
    orderData.type ===
    "wallet_topup"
  ) {
    const walletRef =
      db
        .collection("wallets")
        .doc(uid);

    const walletTxnRef =
      walletRef
        .collection(
          "transactions"
        )
        .doc(paymentId);

    batch.set(
      walletRef,
      {
        userId: uid,

        balance:
          FieldValue.increment(
            Number(
              payment.amount
            )
          ),

        updatedAt:
          FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      }
    );

    batch.set(
      walletTxnRef,
      {
        userId: uid,

        type: "credit",

        amount:
          Number(
            payment.amount
          ),

        currency:
          payment.currency ||
          "INR",

        reason:
          "Wallet recharge",

        status:
          "completed",

        razorpayOrderId:
          orderId,

        razorpayPaymentId:
          paymentId,

        createdAt:
          FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      }
    );
  }


  /* ---------------------------------------------------
     COMMIT
     --------------------------------------------------- */

  await batch.commit();

  return {
    fulfilled: true,
    alreadyFulfilled: false,
  };
}


/* =====================================================
   HEALTH CHECK
   ===================================================== */

app.get(
  "/",
  (req, res) => {
    res.json({
      success: true,

      message:
        "Lathso AI Backend is running 🚀",

      payments:
        process.env
          .RAZORPAY_KEY_ID
          ? "configured"
          : "not configured",

      firebaseAdmin:
        "configured",
    });
  }
);


/* =====================================================
   CREATE RAZORPAY ORDER
   ===================================================== */

app.post(
  "/api/payments/create-order",
  requireFirebaseUser,
  async (req, res) => {
    try {
      const type =
        String(
          req.body?.type ||
            ""
        ).trim();

      const uid =
        req.firebaseUser.uid;

      let amount;

      let planId = null;

      let receiptPrefix =
        "lathso";


      /* ===============================================
         SUBSCRIPTION
         =============================================== */

      if (
        type ===
        "subscription"
      ) {
        planId =
          String(
            req.body?.planId ||
              ""
          ).trim();

        const plan =
          getPlan(planId);

        if (!plan) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid subscription plan.",
          });
        }

        amount =
          plan.amount;

        receiptPrefix =
          `sub_${plan.id}`;
      }


      /* ===============================================
         WALLET
         =============================================== */

      else if (
        type ===
        "wallet_topup"
      ) {
        const rupees =
          Number(
            req.body?.amount
          );

        if (
          !Number.isInteger(
            rupees
          ) ||
          rupees < 100 ||
          rupees > 100000
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Wallet amount must be between ₹100 and ₹100000.",
          });
        }

        amount =
          rupees * 100;

        receiptPrefix =
          "wallet";
      }


      /* ===============================================
         INVALID TYPE
         =============================================== */

      else {
        return res.status(400).json({
          success: false,
          message:
            "Unsupported payment type.",
        });
      }


      /* ===============================================
         RECEIPT
         =============================================== */

      const receipt =
        `${receiptPrefix}_${uid.slice(
          0,
          10
        )}_${Date.now()}`
          .slice(
            0,
            40
          );


      /* ===============================================
         CREATE RAZORPAY ORDER
         =============================================== */

      const order =
        await razorpay.orders.create({
          amount,

          currency:
            "INR",

          receipt,

          notes: {
            uid,

            type,

            ...(planId
              ? { planId }
              : {}),
          },
        });


      /* ===============================================
         FIRESTORE ORDER
         =============================================== */

      const orderSplit = type === "subscription"
        ? calculateSubscriptionSplit(amount)
        : { totalPaise: amount, platformCommissionPaise: 0, tutorPoolPaise: 0 };

      await db
        .collection(
          "paymentOrders"
        )
        .doc(order.id)
        .set({
          orderId:
            order.id,

          uid,

          type,

          planId,

          amount,

          currency:
            "INR",

          commissionPercent: type === "subscription" ? PLATFORM_COMMISSION_PERCENT : 0,
          platformCommissionPaise: orderSplit.platformCommissionPaise,
          tutorPoolPaise: orderSplit.tutorPoolPaise,

          status:
            "created",

          fulfilled:
            false,

          createdAt:
            FieldValue.serverTimestamp(),
        });


      /* ===============================================
         RESPONSE
         =============================================== */

      return res.json({
        success: true,

        keyId:
          process.env
            .RAZORPAY_KEY_ID,

        orderId:
          order.id,

        amount:
          order.amount,

        currency:
          order.currency,

        type,

        planId,
      });
    } catch (error) {
      console.error(
        "Create Razorpay order error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error?.error
            ?.description ||
          error.message ||
          "Could not create payment order.",
      });
    }
  }
);


/* =====================================================
   VERIFY RAZORPAY PAYMENT
   ===================================================== */

app.post(
  "/api/payments/verify",
  requireFirebaseUser,
  async (req, res) => {
    try {
      const {
        razorpay_payment_id:
          paymentId,

        razorpay_order_id:
          orderId,

        razorpay_signature:
          signature,
      } = req.body || {};


      if (
        !paymentId ||
        !orderId ||
        !signature
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Payment verification details are incomplete.",
        });
      }


      /* =============================================
         GET ORDER FROM FIRESTORE
         ============================================= */

      const orderRef =
        db
          .collection(
            "paymentOrders"
          )
          .doc(orderId);

      const orderSnap =
        await orderRef.get();

      if (!orderSnap.exists) {
        return res.status(404).json({
          success: false,
          message:
            "Payment order not found.",
        });
      }

      const orderData =
        orderSnap.data();


      /* =============================================
         ACCOUNT OWNERSHIP
         ============================================= */

      if (
        orderData.uid !==
        req.firebaseUser.uid
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Payment order does not belong to this account.",
        });
      }


      /* =============================================
         SIGNATURE VERIFICATION
         ============================================= */

      const generatedSignature =
        crypto
          .createHmac(
            "sha256",
            process.env
              .RAZORPAY_KEY_SECRET
          )
          .update(
            `${orderId}|${paymentId}`
          )
          .digest("hex");

      if (
        generatedSignature !==
        signature
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid payment signature.",
        });
      }


      /* =============================================
         VERIFY + FULFILL
         ============================================= */

      const result =
        await fulfillVerifiedPayment({
          orderId,

          paymentId,

          orderData,

          source:
            "checkout",
        });


      return res.json({
        success: true,

        message:
          result.alreadyFulfilled
            ? "Payment was already processed."
            : "Payment verified successfully.",

        type:
          orderData.type,

        planId:
          orderData.planId ||
          null,
      });
    } catch (error) {
      console.error(
        "Payment verification error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Payment verification failed.",
      });
    }
  }
);


/* =====================================================
   GET WALLET BALANCE
   ===================================================== */

app.get(
  "/api/payments/wallet",
  requireFirebaseUser,
  async (req, res) => {
    try {
      const uid =
        req.firebaseUser.uid;

      const walletSnap =
        await db
          .collection("wallets")
          .doc(uid)
          .get();

      const balance =
        walletSnap.exists
          ? Number(
              walletSnap
                .data()
                ?.balance || 0
            )
          : 0;

      return res.json({
        success: true,

        balance:
          balance / 100,
      });
    } catch (error) {
      console.error(
        "Wallet read error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Could not load wallet.",
      });
    }
  }
);


/* =====================================================
   ADMIN PAYMENT REPORT
   Verified subscription revenue only.
===================================================== */

app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const revenueSnap = await db.collection("platformRevenue").get();
    const payoutSnap = await db.collection("tutorPayouts").get().catch(() => ({ docs: [] }));

    let todayRevenuePaise = 0;
    let platformCommissionPaise = 0;
    let tutorPoolPaise = 0;
    const transactions = [];

    revenueSnap.docs.forEach((d) => {
      const x = d.data() || {};
      const created = x.createdAt?.toDate ? x.createdAt.toDate() : null;
      const amount = Number(x.amountPaise || 0);
      const commission = Number(x.platformCommissionPaise || 0);
      const tutorPool = Number(x.tutorPoolPaise || 0);
      if (created && created >= start) todayRevenuePaise += amount;
      platformCommissionPaise += commission;
      tutorPoolPaise += tutorPool;
      transactions.push({
        id: d.id,
        paymentId: x.paymentId || d.id,
        planId: x.planId || "",
        amountPaise: amount,
        commissionPaise: commission,
        tutorPoolPaise: tutorPool,
        status: x.status || "captured",
        tutorAllocationStatus: x.tutorAllocationStatus || "pending",
        createdAt: created ? created.toISOString() : null,
      });
    });

    let tutorPayoutPaise = 0;
    payoutSnap.docs.forEach((d) => {
      tutorPayoutPaise += Number(d.data()?.amountPaise || 0);
    });

    let pendingWithdrawalPaise = 0;
    const tutorSnap = await db.collection("tutorEarnings").get();
    tutorSnap.docs.forEach((d) => {
      pendingWithdrawalPaise += Number(d.data()?.pendingPayoutPaise || 0);
    });

    transactions.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    return res.json({
      success: true,
      commissionPercent: PLATFORM_COMMISSION_PERCENT,
      todayRevenuePaise,
      platformCommissionPaise,
      tutorPoolPaise,
      tutorPayoutPaise,
      pendingWithdrawalPaise,
      transactions: transactions.slice(0, 100),
    });
  } catch (error) {
    console.error("Admin payment report error:", error);
    return res.status(500).json({ success: false, message: "Could not load payment report." });
  }
});

/* =====================================================
   ADMIN: ALLOCATE SUBSCRIPTION TO VERIFIED TUTORS
===================================================== */

app.post("/api/admin/subscription/allocate-tutors", requireAdmin, async (req, res) => {
  try {
    const paymentId = String(req.body?.paymentId || "").trim();
    const tutorIds = Array.isArray(req.body?.tutorIds) ? [...new Set(req.body.tutorIds.map(String).map(x => x.trim()).filter(Boolean))] : [];
    if (!paymentId || !tutorIds.length) {
      return res.status(400).json({ success: false, message: "paymentId and tutorIds are required." });
    }

    const revenueRef = db.collection("platformRevenue").doc(paymentId);
    const revenueSnap = await revenueRef.get();
    if (!revenueSnap.exists) return res.status(404).json({ success: false, message: "Subscription revenue record not found." });
    const revenue = revenueSnap.data();
    if (revenue.type !== "subscription") return res.status(400).json({ success: false, message: "Only subscription payments can be allocated." });
    if (revenue.tutorAllocationStatus === "allocated") return res.status(409).json({ success: false, message: "This subscription is already allocated." });

    const plan = getPlan(revenue.planId);
    if (!plan || !["single_tutor", "multi_subject"].includes(plan.id)) {
      return res.status(400).json({ success: false, message: "This plan does not have tutor earnings allocation." });
    }
    const requiredCount = plan.id === "multi_subject" ? 3 : 1;
    if (tutorIds.length !== requiredCount) {
      return res.status(400).json({ success: false, message: `${plan.name} requires exactly ${requiredCount} tutor(s).` });
    }

    const tutorProfiles = [];
    for (const tutorId of tutorIds) {
      const snap = await db.collection("users").doc(tutorId).get();
      const data = snap.exists ? snap.data() : null;
      if (!data || data.role !== "tutor" || data.verified !== true) {
        return res.status(400).json({ success: false, message: `Tutor ${tutorId} is not a verified tutor.` });
      }
      tutorProfiles.push({ tutorId, name: data.name || data.fullName || "Tutor" });
    }

    const totalTutorPool = Number(revenue.tutorPoolPaise || 0);
    const baseShare = Math.floor(totalTutorPool / requiredCount);
    const remainder = totalTutorPool - baseShare * requiredCount;
    const subscriptionRef = db.collection("subscriptions").doc(revenue.uid);

    await db.runTransaction(async (tx) => {
      const currentRevenue = (await tx.get(revenueRef)).data() || {};
      if (currentRevenue.tutorAllocationStatus === "allocated") throw new Error("ALREADY_ALLOCATED");
      const currentSubscription = (await tx.get(subscriptionRef)).data() || {};
      if (!currentSubscription || currentSubscription.planId !== plan.id) throw new Error("Subscription record mismatch.");

      tutorIds.forEach((tutorId, index) => {
        const share = baseShare + (index === 0 ? remainder : 0);
        const earningsRef = db.collection("tutorEarnings").doc(tutorId);
        const txnRef = earningsRef.collection("transactions").doc(paymentId);
        tx.set(txnRef, {
          tutorId, uid: revenue.uid, paymentId, planId: plan.id, type: "subscription_earning",
          amountPaise: share, status: "pending", createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(earningsRef, {
          tutorId, totalEarnedPaise: FieldValue.increment(share), pendingPayoutPaise: FieldValue.increment(share), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      tx.set(revenueRef, {
        tutorIds, tutorAllocationStatus: "allocated", payoutStatus: "pending_tutor_payout", updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(subscriptionRef, {
        tutorIds, tutorAllocationStatus: "allocated", tutorPoolPaise: totalTutorPool, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return res.json({ success: true, paymentId, tutorIds, tutorPoolPaise: totalTutorPool, tutorProfiles });
  } catch (error) {
    console.error("Tutor allocation error:", error);
    if (error.message === "ALREADY_ALLOCATED") return res.status(409).json({ success: false, message: "This subscription is already allocated." });
    return res.status(500).json({ success: false, message: error.message || "Could not allocate tutor earnings." });
  }
});

/* =====================================================
   ADMIN: RECORD TUTOR PAYOUT
===================================================== */

app.post("/api/admin/tutor-payout", requireAdmin, async (req, res) => {
  try {
    const tutorId = String(req.body?.tutorId || "").trim();
    const rupees = Number(req.body?.amount);
    const reference = String(req.body?.reference || "").trim();
    if (!tutorId || !Number.isInteger(rupees) || rupees <= 0 || !reference) {
      return res.status(400).json({ success: false, message: "tutorId, positive integer amount and payout reference are required." });
    }
    const amountPaise = rupees * 100;
    const earningsRef = db.collection("tutorEarnings").doc(tutorId);
    const payoutRef = db.collection("tutorPayouts").doc();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(earningsRef);
      const data = snap.exists ? snap.data() : {};
      const pending = Number(data.pendingPayoutPaise || 0);
      if (amountPaise > pending) throw new Error("PAYOUT_EXCEEDS_PENDING");
      tx.set(payoutRef, { tutorId, amountPaise, reference, status: "paid", adminUid: req.firebaseUser.uid, createdAt: FieldValue.serverTimestamp() });
      tx.set(earningsRef, { pendingPayoutPaise: FieldValue.increment(-amountPaise), paidOutPaise: FieldValue.increment(amountPaise), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return res.json({ success: true, payoutId: payoutRef.id, tutorId, amountPaise, reference });
  } catch (error) {
    if (error.message === "PAYOUT_EXCEEDS_PENDING") return res.status(400).json({ success: false, message: "Payout exceeds tutor's pending earnings." });
    console.error("Tutor payout error:", error);
    return res.status(500).json({ success: false, message: "Could not record tutor payout." });
  }
});

/* =====================================================
   AI QUESTION SOLVER
   ===================================================== */

app.post(
  "/api/solve-question",
  upload.single("image"),
  async (req, res) => {
    try {
      const question =
        req.body.question ||
        "";

      if (
        !req.file &&
        !question.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Please upload an image or type a question.",
        });
      }

      const content = [];


      /* -----------------------------------------------
         AI INSTRUCTIONS
         ----------------------------------------------- */

      content.push({
        type:
          "input_text",

        text: `
You are Lathso AI, an educational problem-solving assistant.

Your job is to help students understand problems,
not just give the final answer.

Follow this structure:

1. Understand the question
2. Identify the given information
3. Explain the concept/formula
4. Solve step by step
5. Show calculations clearly
6. Give the final answer
7. Give a short "Key Idea" for the student

Use simple student-friendly language.

If the uploaded image contains a question,
read it carefully before solving.

Student's typed question:

${
  question ||
  "No additional text provided."
}
        `,
      });


      /* -----------------------------------------------
         IMAGE
         ----------------------------------------------- */

      if (req.file) {
        const base64Image =
          req.file.buffer.toString(
            "base64"
          );

        content.push({
          type:
            "input_image",

          image_url:
            `data:${req.file.mimetype};base64,${base64Image}`,
        });
      }


      /* -----------------------------------------------
         OPENAI
         ----------------------------------------------- */

      if (!openai) {
        return res.status(503).json({
          success: false,
          message: "OpenAI API key is not configured on the server.",
        });
      }

      const response =
        await openai.responses.create({
          model:
            "gpt-5",

          input: [
            {
              role:
                "user",

              content,
            },
          ],
        });


      return res.json({
        success: true,

        answer:
          response.output_text ||
          "",
      });
    } catch (error) {
      console.error(
        "LATHSO AI ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          error.message ||
          "Unknown AI error",
      });
    }
  }
);


/* =====================================================
   LEGACY TUTOR FILE ROUTES
   Firebase Storage / Supabase Storage NOT USED
   ===================================================== */

app.post(
  "/api/tutor/upload",
  upload.single("file"),
  async (req, res) => {
    return res.status(501).json({
      success: false,

      message:
        "Tutor file storage is not enabled. No file was stored.",
    });
  }
);


app.post(
  "/api/tutor/file-url",
  async (req, res) => {
    return res.status(501).json({
      success: false,

      message:
        "Tutor file storage is not enabled.",
    });
  }
);


app.delete(
  "/api/tutor/file",
  async (req, res) => {
    return res.status(501).json({
      success: false,

      message:
        "Tutor file storage is not enabled.",
    });
  }
);


/* =====================================================
   GLOBAL ERROR HANDLER
   ===================================================== */

app.use(
  (error, req, res, next) => {
    console.error(
      "Lathso Server Error:",
      error
    );


    /* -----------------------------------------------
       FILE TOO LARGE
       ----------------------------------------------- */

    if (
      error.code ===
      "LIMIT_FILE_SIZE"
    ) {
      return res.status(413).json({
        success: false,

        message:
          "File is too large. Maximum size is 50 MB.",
      });
    }


    /* -----------------------------------------------
       INVALID FILE TYPE
       ----------------------------------------------- */

    if (
      error.message &&
      error.message.includes(
        "Unsupported file type"
      )
    ) {
      return res.status(400).json({
        success: false,

        message:
          error.message,
      });
    }


    /* -----------------------------------------------
       GENERAL ERROR
       ----------------------------------------------- */

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Internal server error.",
    });
  }
);


/* =====================================================
   START SERVER
   ===================================================== */

app.listen(
  PORT,
  () => {
    console.log(
      `Lathso AI Backend running on http://localhost:${PORT}`
    );

    console.log(
      `Payment order endpoint: http://localhost:${PORT}/api/payments/create-order`
    );
  }
);