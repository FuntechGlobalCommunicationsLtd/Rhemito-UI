import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronLeft, ChevronUp, Loader2 } from "lucide-react";
import {
  createSupportTicketFormSchema,
  type CreateSupportTicketFormValues,
  type SupportTicketArea,
} from "@shared/support";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SupportAttachmentUpload } from "@/components/support/SupportAttachmentUpload";
import { SupportSignInRequiredCard } from "@/components/support/SupportSignInRequiredCard";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getQueryFn } from "@/lib/queryClient";
import {
  invalidateSupportQueries,
  isSupportFurpAuthRequiredError,
  submitNewSupportTicket,
} from "@/lib/support";

interface IssueAreaOption {
  id: string;
  testId: string;
  title: string;
  subtitle: string;
  wireValue: SupportTicketArea;
  requiresTxRef: boolean;
}

const ISSUE_AREAS: readonly IssueAreaOption[] = [
  {
    id: "failed-transaction",
    testId: "accordion-area-failed-transaction",
    title: "Failed transaction",
    subtitle:
      "Troubleshoot issues like declined payment, technical issues, data errors...",
    wireValue: "Failed Transaction",
    requiresTxRef: true,
  },
  {
    id: "recipients",
    testId: "accordion-area-recipients",
    title: "Recipients",
    subtitle: "Encounter issues with recipient details, transaction IDs",
    wireValue: "Recipients",
    requiresTxRef: false,
  },
  {
    id: "compliance",
    testId: "accordion-area-compliance",
    title: "KYC and compliance",
    subtitle:
      "Clarify issues with legal obligations, business documentation, personal and business data, fraud prevention and detection etc",
    wireValue: "KYC and Compliance",
    requiresTxRef: false,
  },
] as const;

function IssueAreaTicketForm({
  area,
  requiresTxRef,
  onAuthRequired,
}: {
  area: SupportTicketArea;
  requiresTxRef: boolean;
  onAuthRequired: () => void;
}) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const form = useForm<CreateSupportTicketFormValues>({
    resolver: zodResolver(
      createSupportTicketFormSchema,
    ) as unknown as Resolver<CreateSupportTicketFormValues>,
    defaultValues: {
      supportTicketArea: area,
      transactionReference: "",
      subject: "",
      message: "",
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (values: CreateSupportTicketFormValues) => {
      const formData = new FormData();
      formData.append("SupportTicketArea", values.supportTicketArea);
      if (
        values.supportTicketArea === "Failed Transaction" &&
        values.transactionReference.trim()
      ) {
        formData.append(
          "TransactionReference",
          values.transactionReference.trim(),
        );
      }
      formData.append("Subject", values.subject.trim());
      formData.append("Message", values.message.trim());
      if (selectedFile) {
        formData.append("Attachment", selectedFile);
      }
      return submitNewSupportTicket(formData);
    },
    onSuccess: async (res) => {
      await invalidateSupportQueries(queryClient, res.data?.referenceNumber);
      toast({
        title: "Request submitted",
        description: "Your enquiry has been successfully submitted.",
      });
      form.reset({
        supportTicketArea: area,
        transactionReference: "",
        subject: "",
        message: "",
      });
      setSelectedFile(null);
      setPreviewUrl(null);
      navigate("/support/my-tickets?status=NEW");
    },
    onError: (err) => {
      if (isSupportFurpAuthRequiredError(err)) {
        onAuthRequired();
      }
      toast({
        variant: "destructive",
        title: "Submission failed",
        description:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      });
    },
  });

  const handleSubmit = (values: CreateSupportTicketFormValues) => {
    submitMutation.mutate(values);
  };

  return (
    <div className="px-1 pt-5 pb-4">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          noValidate
          className="space-y-5"
        >
          {/* Mandatory fields on top (CLAUDE.md L38) */}
          {requiresTxRef && (
            <FormField
              control={form.control}
              name="transactionReference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-normal text-[#323130]">
                    Transaction reference*
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={field.value ?? ""}
                      type="text"
                      data-testid="input-ticket-tx-ref"
                      className="h-11 border-slate-200 bg-white text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <FormField
            control={form.control}
            name="subject"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-normal text-[#323130]">
                  Subject*
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="text"
                    data-testid="input-ticket-subject"
                    className="h-11 border-slate-200 bg-white text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-normal text-[#323130]">
                  Message*
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    data-testid="textarea-ticket-message"
                    className="min-h-[140px] resize-none border-slate-200 bg-white text-sm"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Optional Attachment below mandatory fields */}
          <SupportAttachmentUpload
            selectedFile={selectedFile}
            previewUrl={previewUrl}
            onFileSelect={(file, url) => {
              setSelectedFile(file);
              setPreviewUrl(url);
            }}
            onFileRemove={() => {
              setSelectedFile(null);
              setPreviewUrl(null);
            }}
            label="Attachment"
            testIdPrefix="create-ticket-attachment"
          />

          <div className="pt-2">
            <Button
              type="submit"
              disabled={submitMutation.isPending}
              data-testid="button-submit-ticket"
              className="h-11 w-full cursor-pointer rounded-full bg-[#2e5bff] px-8 text-sm font-medium text-white hover:bg-blue-700 sm:w-auto sm:min-w-[220px]"
            >
              {submitMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Submit request
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default function CreateTicket() {
  const [, navigate] = useLocation();
  const [expandedArea, setExpandedArea] = useState<SupportTicketArea | null>(
    null,
  );
  const [submitAuthRequired, setSubmitAuthRequired] = useState(false);

  const { data: unreadSupportData } = useQuery<{
    count: number;
    requiresFurpAuth?: boolean;
  } | null>({
    queryKey: ["/api/support/unread-count"],
    queryFn: getQueryFn<{ count: number; requiresFurpAuth?: boolean }>({
      on401: "returnNull",
    }),
    staleTime: 15_000,
  });

  const requiresFurpAuth =
    Boolean(unreadSupportData?.requiresFurpAuth) || submitAuthRequired;

  return (
    <DashboardLayout>
      <div data-testid="page-create-ticket" className="w-full pb-16">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Back"
            data-testid="button-back-my-tickets"
            onClick={() => navigate("/support/my-tickets")}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#323130] transition-colors hover:bg-slate-100"
          >
            <ChevronLeft className="h-6 w-6 stroke-[2.25]" />
          </button>
          <h1 className="font-display text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
            New ticket
          </h1>
        </div>

        {requiresFurpAuth ? (
          <SupportSignInRequiredCard />
        ) : (
          <>
            {/* Subheading */}
            <div className="mt-8 mb-6">
              <h2 className="text-[18px] font-medium text-[#323130]">
                Need help regarding
              </h2>
              <p className="mt-1.5 text-sm text-[#605E5C]">
                Select an appropriate area to which you need help
              </p>
            </div>

            {/* 3 Single-toggle expandable issue-area accordions */}
            <div className="space-y-3">
              {ISSUE_AREAS.map((area) => {
                const isExpanded = expandedArea === area.wireValue;
                return (
                  <div key={area.id} className="overflow-hidden rounded-[8px]">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      data-testid={area.testId}
                      onClick={() =>
                        setExpandedArea((prev) =>
                          prev === area.wireValue ? null : area.wireValue,
                        )
                      }
                      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-[8px] bg-[#F9F9FA] px-4 py-3.5 text-left transition-colors hover:bg-slate-200/50"
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[17px] font-medium text-[#323130]">
                          {area.title}
                        </h3>
                        <p className="mt-1 text-sm font-light text-[#605E5C]">
                          {area.subtitle}
                        </p>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 shrink-0 text-[#323130]" />
                      ) : (
                        <ChevronDown className="h-5 w-5 shrink-0 text-[#323130]" />
                      )}
                    </button>

                    {isExpanded && (
                      <IssueAreaTicketForm
                        key={area.wireValue}
                        area={area.wireValue}
                        requiresTxRef={area.requiresTxRef}
                        onAuthRequired={() => setSubmitAuthRequired(true)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
