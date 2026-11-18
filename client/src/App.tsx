import React, { Component, ErrorInfo, ReactNode } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotificationContextProvider } from "@/contexts/NotificationContext";
import { ContactsProvider } from "@/contexts/ContactsContext";
import Dashboard from "@/pages/Dashboard";
import CollectionAccount from "@/pages/CollectionAccount";
import Transactions from "@/pages/Transactions";
import Invoices from "@/pages/Invoices";
import RequestPayment from "@/pages/RequestPayment";
import RequestCheckout from "@/pages/RequestCheckout";
import SendInvoice from "@/pages/SendInvoice";
import SentInvoiceDetails from "@/pages/SentInvoiceDetails";
import InvoiceView from "@/pages/InvoiceView";
import SenderDetail from "@/pages/SenderDetail";
import SendersRecipients from "@/pages/SendersRecipients";
import AddBeneficiaryPage from "@/pages/Beneficiaries/AddBeneficiaryPage";
import BeneficiaryDetailPage from "@/pages/Beneficiaries/BeneficiaryDetailPage";
import EditBeneficiaryPage from "@/pages/Beneficiaries/EditBeneficiaryPage";
import PayoutAccounts from "@/pages/PayoutAccounts";
import SendMoney from "@/pages/SendMoney";
import BonusAndDiscounts from "@/pages/BonusAndDiscounts";
import ReferralLanding from "@/pages/ReferralLanding";
import Marketing from "@/pages/Marketing";
import GroupPayDashboard from "@/pages/GroupPay/GroupPayDashboard";
import CreateCampaign from "@/pages/GroupPay/CreateCampaign";
import CampaignDetails from "@/pages/GroupPay/CampaignDetails";
import ContributorView from "@/pages/GroupPay/ContributorView";
import MobilePaymentSimulator from "@/pages/MobilePaymentSimulator";
import NotFound from "@/pages/not-found";
import SampleTicket from "@/components/SampleTicket";
import Login from "@/pages/Auth/Login";
import SignInSignUp from "@/pages/Auth/SignInSignUp";
import LandingPage from "@/pages/LandingPage";
import NotificationPreferences from "@/pages/NotificationPreferences";
import Settings from "@/pages/Settings";
import NotificationArchive from "@/pages/NotificationArchive";
import NotificationDetail from "@/pages/NotificationDetail";
import BankTransferDesigns from "@/pages/BankTransferDesigns";
import CompliancePage, { KycVerificationPage, KycReturnPage } from "@/pages/Compliance";
import SupportHub from "@/pages/Support/SupportHub";
import SupportFaq from "@/pages/Support/SupportFaq";
import MyTickets from "@/pages/Support/MyTickets";
import CreateTicket from "@/pages/Support/CreateTicket";
import TicketRequestDetails from "@/pages/Support/TicketRequestDetails";
import MitoViewHome from "@/pages/MitoView/MitoViewHome";
import MitoViewArticle from "@/pages/MitoView/MitoViewArticle";
import MitoViewUnsubscribe from "@/pages/MitoView/MitoViewUnsubscribe";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 text-red-900 border border-red-200 rounded m-4">
          <h1 className="text-xl font-bold mb-2">Something went wrong.</h1>
          <pre className="text-sm overflow-auto max-w-full bg-white p-2 rounded border border-red-100">
            {this.state.error?.toString()}
            <br />
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/overview/collectionaccount" component={CollectionAccount} />
      <Route path="/transactions" component={Transactions} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/request-payment" component={RequestPayment} />
      <Route path="/send-invoice" component={SendInvoice} />
      {/* /payments, /payment-requests and /sent-invoices were consolidated
          into the Dashboard Transactions table (/?type=<filter>) */}
      <Route path="/sent-invoices/:id" component={SentInvoiceDetails} />
      <Route path="/show-qr-code"><Redirect to="/request-payment" /></Route>
      <Route path="/send-money" component={SendMoney} />
      <Route path="/send/status" component={SendMoney} />
      <Route path="/send/statuspaybybank" component={SendMoney} />
      {/* Senders and Recipients were consolidated into one page; the sender
          and beneficiary detail/add/edit views keep their own routes. */}
      <Route path="/senders-recipients" component={SendersRecipients} />
      <Route path="/senders/:email" component={SenderDetail} />
      <Route path="/beneficiaries/add" component={AddBeneficiaryPage} />
      <Route path="/beneficiaries/add-beneficiaries" component={AddBeneficiaryPage} />
      <Route path="/beneficiaries/edit-beneficiary/:id" component={EditBeneficiaryPage} />
      <Route path="/beneficiaries/:id/edit" component={EditBeneficiaryPage} />
      <Route path="/beneficiaries/:id" component={BeneficiaryDetailPage} />
      <Route path="/beneficiaries-details/:id" component={BeneficiaryDetailPage} />
      <Route path="/payout-accounts" component={PayoutAccounts} />
      <Route path="/pay/e/:id" component={RequestCheckout} />
      <Route path="/pay/:id" component={RequestCheckout} />
      <Route path="/invoice/:id" component={InvoiceView} />
      <Route path="/bonus-discounts" component={BonusAndDiscounts} />
      <Route path="/rewards" component={BonusAndDiscounts} />
      <Route path="/ref/:code" component={ReferralLanding} />
      <Route path="/refer/:code" component={ReferralLanding} />
      <Route path="/marketing" component={Marketing} />
      <Route path="/group-pay" component={GroupPayDashboard} />
      <Route path="/group-pay/create" component={CreateCampaign} />
      <Route path="/group-pay/:id" component={CampaignDetails} />
      <Route path="/contribute/:campaignId" component={ContributorView} />
      <Route path="/mobile-payment" component={MobilePaymentSimulator} />
      <Route path="/sample-ticket" component={SampleTicket} />
      <Route path="/login" component={Login} />
      <Route path="/sign-in-sign-up" component={SignInSignUp} />
      <Route path="/home" component={LandingPage} />
      <Route path="/settings/notifications" component={NotificationPreferences} />
      <Route path="/settings" component={Settings} />
      <Route path="/notifications/archive" component={NotificationArchive} />
      <Route path="/notifications/:id" component={NotificationDetail} />
      <Route path="/bank-transfer-designs" component={BankTransferDesigns} />
      <Route path="/compliance" component={CompliancePage} />
      <Route path="/kyc/return" component={KycReturnPage} />
      <Route path="/kyc/status" component={KycReturnPage} />
      <Route path="/kyc" component={KycVerificationPage} />
      <Route path="/support" component={SupportHub} />
      <Route path="/support/faq" component={SupportFaq} />
      <Route path="/support/my-tickets" component={MyTickets} />
      <Route path="/support/create-ticket" component={CreateTicket} />
      <Route path="/support/TicketForm" component={CreateTicket} />
      <Route path="/my-tickets/request-details/:id" component={TicketRequestDetails} />
      <Route path="/mitoview/unsubscribe" component={MitoViewUnsubscribe} />
      <Route path="/mitoview/:slug" component={MitoViewArticle} />
      <Route path="/mitoview" component={MitoViewHome} />
      <Route path="/blog/:slug">
        {(params) => <Redirect to={`/mitoview/${params.slug}`} />}
      </Route>
      <Route path="/blog">
        <Redirect to="/mitoview" />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <NotificationContextProvider>
          <ContactsProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </ContactsProvider>
        </NotificationContextProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
