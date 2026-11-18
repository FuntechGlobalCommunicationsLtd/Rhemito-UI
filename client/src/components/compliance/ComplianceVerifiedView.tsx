import { CheckCircle2 } from "lucide-react";
import type { ComplianceCompanyDetails, ComplianceProfileData } from "@shared/compliance";
import { formatComplianceDate } from "@/lib/compliance";

export interface ComplianceVerifiedViewProps {
  profile: ComplianceProfileData;
  kycType: string | null;
}

function ComplianceRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | null | undefined;
  testId?: string;
}) {
  const cleanValue = String(value ?? "").trim();
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[15px] font-normal text-[#605e5c]">{label}</span>
      <span
        data-testid={testId}
        className="text-right text-[15px] font-medium text-[#323130]"
      >
        {cleanValue || "—"}
      </span>
    </div>
  );
}

function BusinessVerificationSection({
  company,
}: {
  company: ComplianceCompanyDetails;
}) {
  return (
    <section data-testid="compliance-business-section">
      <h2 className="py-5 text-[18px] font-medium text-[#323130]">
        Business verification
      </h2>
      <div className="space-y-4 pb-6">
        <ComplianceRow
          label="Business name"
          value={company.businessName}
          testId="compliance-field-business-name"
        />
        <ComplianceRow
          label="Registration number"
          value={company.registrationNumber}
          testId="compliance-field-business-reg-no"
        />
        {Boolean(company.businessType?.trim()) && (
          <ComplianceRow
            label="Business type"
            value={company.businessType}
            testId="compliance-field-business-type"
          />
        )}
        <ComplianceRow
          label="Address"
          value={company.address}
          testId="compliance-field-business-address"
        />
        <ComplianceRow
          label="Country"
          value={company.country}
          testId="compliance-field-business-country"
        />
        <ComplianceRow
          label="City"
          value={company.city}
          testId="compliance-field-business-city"
        />
        <ComplianceRow
          label="Post code"
          value={company.postCode}
          testId="compliance-field-business-postcode"
        />
      </div>
    </section>
  );
}

function PersonalInformationRows({
  profile,
  includeExtendedDocumentFields,
}: {
  profile: ComplianceProfileData;
  includeExtendedDocumentFields: boolean;
}) {
  const formattedDob = profile.dateOfBirth
    ? formatComplianceDate(profile.dateOfBirth)
    : "—";

  return (
    <div className="space-y-4 pb-6">
      <ComplianceRow
        label="Full name"
        value={profile.fullName}
        testId="compliance-field-full-name"
      />

      {Boolean(profile.occupation?.trim()) && (
        <ComplianceRow
          label="Occupation"
          value={profile.occupation}
          testId="compliance-field-occupation"
        />
      )}

      <ComplianceRow
        label="Date of birth"
        value={formattedDob}
        testId="compliance-field-dob"
      />

      <ComplianceRow
        label="Gender"
        value={profile.gender}
        testId="compliance-field-gender"
      />

      {includeExtendedDocumentFields && Boolean(profile.birthCountry?.trim()) && (
        <ComplianceRow
          label="Birth country"
          value={profile.birthCountry}
          testId="compliance-field-birth-country"
        />
      )}

      {includeExtendedDocumentFields && Boolean(profile.nationality?.trim()) && (
        <ComplianceRow
          label="Nationality"
          value={profile.nationality}
          testId="compliance-field-nationality"
        />
      )}

      <ComplianceRow
        label="Address"
        value={profile.address}
        testId="compliance-field-address"
      />

      <ComplianceRow
        label="City"
        value={profile.city}
        testId="compliance-field-city"
      />

      <ComplianceRow
        label="Post code"
        value={profile.postCode}
        testId="compliance-field-postcode"
      />

      <ComplianceRow
        label="Resident country"
        value={profile.residentCountry}
        testId="compliance-field-country"
      />

      {includeExtendedDocumentFields && Boolean(profile.documentNo?.trim()) && (
        <ComplianceRow
          label="Document no"
          value={profile.documentNo}
          testId="compliance-field-document-no"
        />
      )}

      {includeExtendedDocumentFields && Boolean(profile.issuingCountry?.trim()) && (
        <ComplianceRow
          label="Issuing country"
          value={profile.issuingCountry}
          testId="compliance-field-issuing-country"
        />
      )}

      {includeExtendedDocumentFields && Boolean(profile.issueDate?.trim()) && (
        <ComplianceRow
          label="Issue date"
          value={formatComplianceDate(profile.issueDate)}
          testId="compliance-field-issue-date"
        />
      )}

      {includeExtendedDocumentFields && Boolean(profile.expiryDate?.trim()) && (
        <ComplianceRow
          label="Expiry date"
          value={formatComplianceDate(profile.expiryDate)}
          testId="compliance-field-expiry-date"
        />
      )}
    </div>
  );
}

export function ComplianceVerifiedView({
  profile,
  kycType,
}: ComplianceVerifiedViewProps) {
  const isAmlAddressMode = !kycType || kycType.trim().toUpperCase() === "AMLADDR";

  if (isAmlAddressMode) {
    return (
      <div data-testid="compliance-aml-verified" className="w-full lg:pr-12">
        {profile.isBusinessProfile && profile.company ? (
          <>
            <BusinessVerificationSection company={profile.company} />
            <div className="h-px w-full bg-[#e1dfdd]" />

            <section>
              <h2 className="py-5 text-[18px] font-medium text-[#323130]">
                Identity verification
              </h2>
              <div className="space-y-4 pb-6">
                <ComplianceRow
                  label="Identification type"
                  value={profile.identificationType || "Address verification"}
                  testId="compliance-field-id-type"
                />
              </div>
            </section>
            <div className="h-px w-full bg-[#e1dfdd]" />

            <section>
              <h2 className="py-5 text-[18px] font-medium text-[#323130]">
                Personal information
              </h2>
              <PersonalInformationRows
                profile={profile}
                includeExtendedDocumentFields={false}
              />
            </section>
          </>
        ) : (
          <>
            <h2 className="py-5 text-[18px] font-medium text-[#323130]">
              AML address verification
            </h2>
            <div className="h-px w-full bg-[#e1dfdd]" />

            <h2 className="py-5 text-[18px] font-medium text-[#323130]">
              Personal information
            </h2>
            <PersonalInformationRows
              profile={profile}
              includeExtendedDocumentFields={false}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="compliance-identity-verified"
      className="flex w-full flex-col-reverse gap-8 lg:flex-row lg:items-start lg:gap-16"
    >
      <div className="min-w-0 flex-1">
        {profile.isBusinessProfile && profile.company && (
          <>
            <BusinessVerificationSection company={profile.company} />
            <div className="h-px w-full bg-[#e1dfdd]" />
          </>
        )}

        <section>
          <h2 className="py-5 text-[18px] font-medium text-[#323130]">
            Identity verification
          </h2>
          <div className="space-y-4 pb-6">
            <ComplianceRow
              label="Identification type"
              value={profile.identificationType}
              testId="compliance-field-id-type"
            />
          </div>
        </section>

        <div className="h-px w-full bg-[#e1dfdd]" />

        <section>
          <h2 className="py-5 text-[18px] font-medium text-[#323130]">
            Personal information
          </h2>
          <PersonalInformationRows
            profile={profile}
            includeExtendedDocumentFields
          />
        </section>

        {Boolean(profile.imageUrl?.trim()) && (
          <>
            <div className="h-px w-full bg-[#e1dfdd]" />
            <section className="pb-6">
              <h2 className="py-5 text-[18px] font-medium text-[#323130]">
                Photo verification
              </h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 w-fit max-w-xs">
                <img
                  src={profile.imageUrl!}
                  alt="Verified identity photo"
                  className="max-h-56 w-auto object-cover"
                />
              </div>
            </section>
          </>
        )}
      </div>

      <div
        data-testid="compliance-already-verified-badge"
        className="w-full max-w-[250px] shrink-0 self-center rounded-md border-2 border-[#c7e0f4] bg-white p-5 text-center lg:self-start"
      >
        <CheckCircle2 className="mx-auto my-5 h-16 w-16 text-[#1E8E3E]" />
        <p className="text-lg font-medium text-[#323130]">Already verified</p>
      </div>
    </div>
  );
}
