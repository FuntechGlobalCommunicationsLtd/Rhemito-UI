import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { demoModeEnabled } from "./config";
import { registerPromoRoutes, startPromo } from "./promo";
import { registerBonusRoutes, startBonus } from "./bonus";
import { registerRewardsRoutes } from "./rewardsRoutes";
import { registerFurpV1CompatRoutes } from "./furpV1CompatRoutes";
import { captureDevice } from "./deviceId";
import { registerAuthRoutes } from "./auth";
import { registerInvoiceRoutes } from "./invoiceRoutes";
import { registerRequestMoneyRoutes } from "./requestRoutes";
import { registerGroupPayRoutes } from "./groupPayRoutes";
import { registerSendMoneyRoutes } from "./sendMoneyRoutes";
import { registerPaymentsReceivedRoutes } from "./paymentsReceivedRoutes";
import {
  dispatchNotification,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  getActiveNotifications,
  getArchivedNotifications,
  getNotificationById,
  getUnreadCount,
  getUserPreferences,
  updateUserPreferences,
} from "./notificationService";
import type { NotificationEventType, NotificationPreferences as DBPrefs } from "@shared/schema";

// ─── Preferences shape adapter ───────────────────────────────────────────────
// The DB stores a flat structure (inAppEnabled, paymentEvents, quietHoursEnabled, …).
// The client works in a nested shape ({ channels, eventTypes, quietHours }).
// These two helpers translate between the wire format and the DB format so
// the client and server never have to care about the other side's layout.

interface ClientPrefs {
  channels: {
    inApp: boolean;
    browserPush: boolean;
    email: boolean;
    mobilePush: boolean;
  };
  eventTypes: {
    payment: boolean;
    transactionStatus: boolean;
    refund: boolean;
    kyc: boolean;
    security: boolean;
    system: boolean;
    marketing: boolean;
  };
  quietHours: {
    enabled: boolean;
    from: string;
    to: string;
    timezone: string;
  };
}

function dbToClientPrefs(p: DBPrefs): ClientPrefs {
  return {
    channels: {
      inApp: p.inAppEnabled,
      browserPush: p.webPushEnabled,
      email: p.emailEnabled,
      mobilePush: p.mobilePushEnabled,
    },
    eventTypes: {
      payment: p.paymentEvents,
      transactionStatus: p.transactionEvents,
      refund: p.refundEvents,
      kyc: p.kycEvents,
      security: p.securityEvents,
      system: p.maintenanceEvents,
      marketing: p.marketingEvents,
    },
    quietHours: {
      enabled: p.quietHoursEnabled,
      from: p.quietHoursStart ?? "22:00",
      to: p.quietHoursEnd ?? "08:00",
      timezone: "UTC",
    },
  };
}

function clientToDbPrefs(c: Partial<ClientPrefs>): Partial<DBPrefs> {
  const out: Partial<DBPrefs> = {};
  if (c.channels) {
    if (c.channels.inApp !== undefined) out.inAppEnabled = c.channels.inApp;
    if (c.channels.browserPush !== undefined) out.webPushEnabled = c.channels.browserPush;
    if (c.channels.email !== undefined) out.emailEnabled = c.channels.email;
    if (c.channels.mobilePush !== undefined) out.mobilePushEnabled = c.channels.mobilePush;
  }
  if (c.eventTypes) {
    // AC 1.5 — critical categories (payment, transactionStatus, kyc) cannot be
    // turned off via this endpoint. Even if the client sends false, force true.
    out.paymentEvents = true;
    out.transactionEvents = true;
    out.kycEvents = true;
    if (c.eventTypes.refund !== undefined) out.refundEvents = c.eventTypes.refund;
    if (c.eventTypes.security !== undefined) out.securityEvents = c.eventTypes.security;
    if (c.eventTypes.system !== undefined) out.maintenanceEvents = c.eventTypes.system;
    if (c.eventTypes.marketing !== undefined) out.marketingEvents = c.eventTypes.marketing;
  }
  if (c.quietHours) {
    if (c.quietHours.enabled !== undefined) out.quietHoursEnabled = c.quietHours.enabled;
    if (c.quietHours.from !== undefined) out.quietHoursStart = c.quietHours.from;
    if (c.quietHours.to !== undefined) out.quietHoursEnd = c.quietHours.to;
  }
  return out;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Remember each signed-in customer's device (used by the referral self-referral check)
  app.use("/api", captureDevice);
  // Auth routes
  registerAuthRoutes(app);
  // Send Invoice MVP1 routes (also starts the invoice reminder/expiry sweep)
  registerInvoiceRoutes(app);
  // Request Money routes (strict auth, corridors, webhooks, QR, sweeps)
  registerRequestMoneyRoutes(app);
  // GroupPay funding campaigns (server-owned campaigns + public share links)
  registerGroupPayRoutes(app);
  // Send Money transactions (server-owned store behind the wizard + Dashboard)
  registerSendMoneyRoutes(app);
  registerRewardsRoutes(app);
  registerFurpV1CompatRoutes(app);
  // Received Payments (merged view of settled/in-flight money-in payments)
  registerPaymentsReceivedRoutes(app);
  // Promo codes live in Mito Money; the promo module forwards to it (server/promo, PROMO-RHEMITO spec).
  registerPromoRoutes(app);
  startPromo();
  // Bonus credit lives in Mito Money; the bonus module forwards to it (server/bonus, BONUS-RHEMITO spec).
  registerBonusRoutes(app);
  startBonus();

  // --- Rewards (Refer & Earn, bonus wallet) — see rewardsRoutes.ts ---

  // --- Payout Provider & Bank Endpoints ---

  const NIGERIA_BANKS = [
    { code: "044", name: "Access Bank Nigeria Plc" },
    { code: "058", name: "Guaranty Trust Bank (GTBank)" },
    { code: "011", name: "First Bank of Nigeria" },
    { code: "057", name: "Zenith Bank" },
    { code: "033", name: "United Bank for Africa (UBA)" },
    { code: "050", name: "Ecobank Nigeria" },
    { code: "070", name: "Fidelity Bank" },
    { code: "214", name: "First City Monument Bank (FCMB)" },
    { code: "032", name: "Union Bank of Nigeria" },
    { code: "035", name: "Wema Bank" },
    { code: "50515", name: "Moniepoint Microfinance Bank" },
    { code: "999992", name: "OPay Digital Services" },
    { code: "50211", name: "Kuda Bank" },
    { code: "232", name: "Sterling Bank" },
    { code: "221", name: "Stanbic IBTC Bank" },
  ];

  // GET /api/banks?country=NG (or GB, US, CA)
  app.get("/api/banks", (req: Request, res: Response) => {
    try {
      const country = ((req.query.country as string) || "NG").toUpperCase();
      if (country === "NG" || country === "NIGERIA") {
        return res.json({ country: "NG", banks: NIGERIA_BANKS });
      }
      if (country === "GB" || country === "UNITED KINGDOM") {
        return res.json({
          country: "GB",
          banks: [
            { code: "BARC", name: "Barclays" },
            { code: "HSBC", name: "HSBC UK" },
            { code: "LLOY", name: "Lloyds Bank" },
            { code: "NATW", name: "NatWest" },
            { code: "SANT", name: "Santander UK" },
            { code: "MONZ", name: "Monzo Bank" },
            { code: "REVL", name: "Revolut" },
          ],
        });
      }
      if (country === "US" || country === "UNITED STATES") {
        return res.json({
          country: "US",
          banks: [
            { code: "CHAS", name: "JPMorgan Chase" },
            { code: "BOFA", name: "Bank of America" },
            { code: "WELL", name: "Wells Fargo" },
            { code: "CITI", name: "Citibank" },
          ],
        });
      }
      if (country === "CA" || country === "CANADA") {
        return res.json({
          country: "CA",
          banks: [
            { code: "001", name: "Bank of Montreal" },
            { code: "002", name: "Scotiabank" },
            { code: "003", name: "Royal Bank of Canada" },
            { code: "004", name: "Toronto-Dominion Bank" },
            { code: "006", name: "National Bank of Canada" },
            { code: "010", name: "CIBC" },
          ],
        });
      }
      return res.json({ country, banks: [] });
    } catch (error) {
      console.error("GET /api/banks error:", error);
      return res.status(500).json({ error: "Failed to fetch banks" });
    }
  });

  // POST /api/banks/resolve - Account-name verification endpoint
  app.post("/api/banks/resolve", async (req: Request, res: Response) => {
    try {
      const { bankCode, accountNumber, country, payerNameHint } = req.body;
      const cleanAcc = String(accountNumber ?? "").trim();
      const isNg = !country || String(country).toUpperCase() === "NG" || String(country).toUpperCase() === "NIGERIA";
      const validLength = isNg ? /^\d{10}$/.test(cleanAcc) : /^\d{6,12}$/.test(cleanAcc);
      if (!cleanAcc || !validLength) {
        return res.status(400).json({
          verified: false,
          message: "We could not verify this bank account. Check the selected bank and account number and try again.",
        });
      }
      if (!bankCode) {
        return res.status(400).json({
          verified: false,
          message: "Please select a bank for account verification.",
        });
      }

      // If user is logged in, use their verified profile name or fallback mock name
      let accountName = payerNameHint && String(payerNameHint).trim() ? String(payerNameHint).trim().toUpperCase() : "JOHN DOE";
      if (!payerNameHint && req.session?.userId) {
        const user = await storage.getAuthUserById(req.session.userId);
        if (user) {
          if (user.accountType === "business" && user.businessName) {
            accountName = user.businessName.toUpperCase();
          } else if (user.firstName || user.lastName) {
            accountName = [user.firstName, user.middleName, user.lastName]
              .filter(Boolean)
              .join(" ")
              .toUpperCase();
          }
        }
      }

      // Artificial slight delay for realistic verification UX
      await new Promise((resolve) => setTimeout(resolve, 350));

      return res.json({
        verified: true,
        accountName,
        bankCode,
        accountNumber,
      });
    } catch (error) {
      console.error("POST /api/banks/resolve error:", error);
      return res.status(500).json({
        verified: false,
        message: "We could not verify this bank account. Check the selected bank and account number and try again.",
      });
    }
  });

  // ─── Notification Routes ─────────────────────────────────────────────────

  /**
   * Auth guard — reusable inline helper.
   * Falls back to a default prototype user when no session is present,
   * matching the pattern used by /api/promocodes/validate and /api/rewards/summary.
   * Swap this for a strict check when the auth flow is wired end-to-end.
   */
  function requireAuth(req: Request, _res: Response): string | null {
    return req.session?.userId ?? "user_123";
  }

  // GET /api/notifications — active list, paginated
  app.get("/api/notifications", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const notifications = await getActiveNotifications(userId, page);
      const unreadCount = await getUnreadCount(userId);
      return res.json({ data: notifications, meta: { page, pageSize: 20, unreadCount } });
    } catch (err) {
      console.error("GET /api/notifications error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch notifications" } });
    }
  });

  // GET /api/notifications/unread-count
  app.get("/api/notifications/unread-count", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const count = await getUnreadCount(userId);
      return res.json({ count });
    } catch (err) {
      console.error("GET /api/notifications/unread-count error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch unread count" } });
    }
  });

  // GET /api/notifications/preferences — returns the client nested shape
  app.get("/api/notifications/preferences", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const prefs = await getUserPreferences(userId);
      // Return as a bare nested object so useQuery can read prefs.channels.inApp directly
      return res.json(dbToClientPrefs(prefs));
    } catch (err) {
      console.error("GET /api/notifications/preferences error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch preferences" } });
    }
  });

  // GET /api/notifications/archive — archived list, paginated
  app.get("/api/notifications/archive", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const notifications = await getArchivedNotifications(userId, page);
      return res.json({ data: notifications, meta: { page, pageSize: 20 } });
    } catch (err) {
      console.error("GET /api/notifications/archive error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch archive" } });
    }
  });

  // PATCH /api/notifications/read-all — mark all read
  app.patch("/api/notifications/read-all", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      await markAllNotificationsRead(userId);
      return res.json({ success: true });
    } catch (err) {
      console.error("PATCH /api/notifications/read-all error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to mark all as read" } });
    }
  });

  // PATCH /api/notifications/preferences — accepts client nested shape
  app.patch("/api/notifications/preferences", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const patch = clientToDbPrefs(req.body ?? {});
      const updated = await updateUserPreferences(userId, patch);
      // Dispatch a confirmation in-app notification
      await dispatchNotification({ userId, type: "preferences_updated", data: {} });
      return res.json(dbToClientPrefs(updated));
    } catch (err) {
      console.error("PATCH /api/notifications/preferences error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to update preferences" } });
    }
  });

  // GET /api/notifications/:id — fetch a single notification
  app.get("/api/notifications/:id", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const notification = await getNotificationById(req.params.id, userId);
      if (!notification) {
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found" } });
      }
      return res.json({ data: notification });
    } catch (err) {
      console.error("GET /api/notifications/:id error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch notification" } });
    }
  });

  // PATCH /api/notifications/:id/read — mark one read
  app.patch("/api/notifications/:id/read", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      await markNotificationRead(req.params.id, userId);
      return res.json({ success: true });
    } catch (err) {
      console.error("PATCH /api/notifications/:id/read error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to mark notification as read" } });
    }
  });

  // DELETE /api/notifications/:id — dismiss (soft archive)
  app.delete("/api/notifications/:id", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      await dismissNotification(req.params.id, userId);
      return res.status(204).send();
    } catch (err) {
      console.error("DELETE /api/notifications/:id error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to dismiss notification" } });
    }
  });

  // POST /api/notifications/dispatch — client-triggered notification dispatch
  app.post("/api/notifications/dispatch", async (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { type, data = {} } = req.body as { type: NotificationEventType; data: Record<string, unknown> };
      if (!type) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "type is required" } });
      }
      await dispatchNotification({ userId, type, data });
      const count = await getUnreadCount(userId);
      return res.json({ success: true, unreadCount: count });
    } catch (err) {
      console.error("POST /api/notifications/dispatch error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to dispatch notification" } });
    }
  });

  // POST /api/notifications/test — DEV ONLY: dispatch a test notification
  app.post("/api/notifications/test", async (req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
    }

    const userId = requireAuth(req, res);
    if (!userId) return;

    try {
      const { type, data = {} } = req.body as { type: NotificationEventType; data: Record<string, unknown> };
      if (!type) {
        return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "type is required" } });
      }
      await dispatchNotification({ userId, type, data });
      const count = await getUnreadCount(userId);
      return res.json({ success: true, unreadCount: count });
    } catch (err) {
      console.error("POST /api/notifications/test error:", err);
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to dispatch test notification" } });
    }
  });

  return httpServer;
}
