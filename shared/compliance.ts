export interface ComplianceCompanyDetails {
  businessName: string | null;
  registrationNumber: string | null;
  businessType: string | null;
  address: string | null;
  country: string | null;
  city: string | null;
  postCode: string | null;
  directorName: string | null;
  directorGender: string | null;
}

export interface ComplianceProfileData {
  uid?: string | null;
  isBusinessProfile: boolean;
  fullName: string;
  occupation: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  birthCountry: string | null;
  address: string | null;
  city: string | null;
  postCode: string | null;
  residentCountry: string | null;
  nationality: string | null;
  identificationType: string | null;
  documentNo: string | null;
  issuingCountry: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  imageUrl: string | null;
  company: ComplianceCompanyDetails | null;
}

export interface ComplianceKycSummary {
  status: string | null;
  type: string | null;
  isTransactionAllowed: boolean;
  attempt: number | null;
}

export interface ComplianceOverviewResponse {
  source: "furp" | "local";
  profile: ComplianceProfileData | null;
  kyc: ComplianceKycSummary | null;
  journeyRecommended: boolean;
  hostedUrl?: string | null;
  journeyCode?: string | null;
  kycFlow?: string | null;
}
