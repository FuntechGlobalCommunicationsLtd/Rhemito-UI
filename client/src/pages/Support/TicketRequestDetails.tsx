import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
} from "lucide-react";
import {
  replySupportTicketFormSchema,
  type ReplySupportTicketFormValues,
  type SupportTicketMessageItem,
} from "@shared/support";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SupportAttachmentUpload } from "@/components/support/SupportAttachmentUpload";
import { SupportSignInRequiredCard } from "@/components/support/SupportSignInRequiredCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  SUPPORT_TICKET_DETAIL_QUERY_KEY,
  fetchSupportTicketDetail,
  formatRelativeSupportTime,
  formatSupportDate,
  formatSupportStatusLabel,
  getInitialsFromName,
  invalidateSupportQueries,
  isSupportFurpAuthRequiredError,
  markSupportTicketRead,
  submitSupportTicketReply,
} from "@/lib/support";
import { cn } from "@/lib/utils";

function normalizeFileExt(ext: string | null | undefined): string {
  return String(ext ?? "")
    .replace(/^\./, "")
    .trim()
    .toLowerCase();
}

function isImageExtension(ext: string): boolean {
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(ext);
}

function buildDataUri(rawBase64: string, ext: string): string {
  if (rawBase64.startsWith("data:")) return rawBase64;
  if (ext === "pdf") {
    return `data:application/pdf;base64,${rawBase64}`;
  }
  const mimeSub = ext === "jpg" ? "jpeg" : ext || "png";
  return `data:image/${mimeSub};base64,${rawBase64}`;
}

function base64ToBlob(rawBase64: string, mimeType: string): Blob {
  const cleanBase64 = rawBase64.includes(",")
    ? rawBase64.split(",")[1] ?? ""
    : rawBase64;
  const byteChars = atob(cleanBase64);
  const chunks: BlobPart[] = [];
  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      bytes[i] = slice.charCodeAt(i);
    }
    chunks.push(bytes);
  }
  return new Blob(chunks, { type: mimeType });
}

function isResolvedOrClosed(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "resolved" || s === "closed";
}

function TicketMessageCard({
  item,
  idx,
  onOpenImageLightbox,
  onPreviewPdf,
  onDownloadAttachment,
}: {
  item: SupportTicketMessageItem;
  idx: number;
  onOpenImageLightbox: (src: string, fileName: string) => void;
  onPreviewPdf: (base64: string) => void;
  onDownloadAttachment: (
    base64: string,
    ext: string,
    fileName?: string,
  ) => void;
}) {
  const isBackOffice = item.role === "BackOffice User";
  const ext = normalizeFileExt(item.fileExtension);
  const hasAttachment = Boolean(item.fileAttachment && ext);
  const isImage = hasAttachment && isImageExtension(ext);
  const isPdf = hasAttachment && ext === "pdf";
  const imageSrc =
    isImage && item.fileAttachment
      ? buildDataUri(item.fileAttachment, ext)
      : null;

  return (
    <article
      data-testid={`ticket-message-${idx}`}
      className={cn(
        "rounded-xl p-5 transition-colors",
        isBackOffice
          ? "bg-[#F8F8F8]"
          : "border border-[#F1F1F1] bg-white shadow-xs",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#3b88eb] text-sm font-semibold text-white"
        >
          {getInitialsFromName(item.userName)}
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <h3 className="text-[16px] font-bold text-[#323130]">
              {item.userName}
            </h3>
            <p
              className="text-sm text-[#605E5C]"
              title={formatSupportDate(item.lastactivity)}
            >
              {formatRelativeSupportTime(item.lastactivity)}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-[16px] font-bold text-[#323130]">Message</p>
            <p className="text-[15px] leading-relaxed whitespace-pre-line text-[#323130]">
              {item.note}
            </p>
          </div>

          {hasAttachment && item.fileAttachment && (
            <div className="space-y-2 pt-1">
              <p className="text-[16px] font-bold text-[#323130]">Attachment</p>
              <div
                data-testid={`ticket-attachment-${idx}`}
                className="group relative w-fit min-w-[192px] overflow-hidden rounded-lg border border-[#E0E0E0] bg-white transition-shadow hover:border-blue-300 hover:shadow-sm"
              >
                {isImage && imageSrc ? (
                  <div className="relative h-32 w-48 overflow-hidden">
                    <img
                      src={imageSrc}
                      alt={item.fileName || "Attachment"}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label="Preview attachment"
                        data-testid={`button-preview-attachment-${idx}`}
                        onClick={() =>
                          onOpenImageLightbox(
                            imageSrc,
                            item.fileName || `Attachment.${ext}`,
                          )
                        }
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/95 text-[#323130] shadow-md transition-transform hover:scale-105"
                      >
                        <Eye className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-32 w-48 flex-col items-center justify-center gap-2 bg-[#F9F9F9] px-3">
                    <FileText className="h-10 w-10 text-[#323130]" />
                    <span className="max-w-full truncate text-xs font-semibold text-[#323130]">
                      {ext.toUpperCase()} document
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-[#F1F1F1] bg-white px-3 py-2">
                  <div>
                    <span className="block text-xs font-medium text-[#605E5C]">
                      File type
                    </span>
                    <span className="block text-sm font-bold text-[#323130]">
                      {ext.toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isPdf && (
                      <button
                        type="button"
                        aria-label="Preview document"
                        title="View document"
                        data-testid={`button-preview-attachment-${idx}`}
                        onClick={() => onPreviewPdf(item.fileAttachment!)}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#323130] transition-colors hover:bg-[#F3F2F1] hover:text-[#2e5bff]"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      aria-label="Download attachment"
                      title="Download"
                      data-testid={`button-download-attachment-${idx}`}
                      onClick={() =>
                        onDownloadAttachment(
                          item.fileAttachment!,
                          ext,
                          item.fileName,
                        )
                      }
                      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[#323130] transition-colors hover:bg-[#F3F2F1] hover:text-[#2e5bff]"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default function TicketRequestDetails() {
  const [, params] = useRoute<{ id: string }>("/my-tickets/request-details/:id");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const ticketId = decodeURIComponent(params?.id ?? "").replace(/^#/, "").trim();

  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [replyAuthRequired, setReplyAuthRequired] = useState(false);
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [replyPreviewUrl, setReplyPreviewUrl] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    name: string;
  } | null>(null);

  const {
    data: detail,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: [SUPPORT_TICKET_DETAIL_QUERY_KEY, ticketId, pageNo, pageSize],
    queryFn: () => fetchSupportTicketDetail(ticketId, pageNo, pageSize),
    enabled: Boolean(ticketId),
    staleTime: 10_000,
  });

  // Immediately sync Sidebar & Header unread notification counts on load
  useEffect(() => {
    if (!detail?.referenceNumber) return;
    void markSupportTicketRead(detail.referenceNumber)
      .catch(() => {
        // Detail GET already marks notifications read server-side; ignore fallback error
      })
      .finally(() => {
        void queryClient.invalidateQueries({
          queryKey: ["/api/support/unread-count"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/notifications/unread-count"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/notifications"],
        });
      });
  }, [detail?.referenceNumber, queryClient]);

  const replyForm = useForm<ReplySupportTicketFormValues>({
    resolver: zodResolver(replySupportTicketFormSchema),
    defaultValues: {
      message: "",
    },
  });

  const resetReplyComposer = () => {
    replyForm.reset({ message: "" });
    setReplyFile(null);
    setReplyPreviewUrl(null);
  };

  const replyMutation = useMutation({
    mutationFn: async (values: ReplySupportTicketFormValues) => {
      const ref = detail?.referenceNumber || ticketId;
      const formData = new FormData();
      formData.append("referenceNumber", ref);
      formData.append("message", values.message.trim());
      if (replyFile) {
        formData.append("Attachment", replyFile);
      }
      return submitSupportTicketReply(formData);
    },
    onSuccess: async () => {
      const ref = detail?.referenceNumber || ticketId;
      toast({
        title: "Ticket updated",
        description: "Ticket updated successfully!",
      });
      setIsReplyOpen(false);
      resetReplyComposer();
      setPageNo(1);
      await invalidateSupportQueries(queryClient, ref);
    },
    onError: (err) => {
      if (isSupportFurpAuthRequiredError(err)) {
        setReplyAuthRequired(true);
      }
      toast({
        variant: "destructive",
        title: "Unable to send reply",
        description:
          err instanceof Error
            ? err.message
            : "Failed to update support ticket.",
      });
    },
  });

  const handleDownloadAttachment = (
    base64: string,
    ext: string,
    fileName?: string,
  ) => {
    try {
      const mime =
        ext === "pdf"
          ? "application/pdf"
          : `image/${ext === "jpg" ? "jpeg" : ext}`;
      const blob = base64ToBlob(base64, mime);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const cleanName =
        fileName && fileName.includes(".")
          ? fileName
          : `${fileName || "Attachment"}.${ext}`;
      anchor.download = cleanName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 250);
    } catch {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: "Unable to download this attachment.",
      });
    }
  };

  const handlePreviewPdf = (base64: string) => {
    try {
      const blob = base64ToBlob(base64, "application/pdf");
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast({
        variant: "destructive",
        title: "Preview unavailable",
        description: "Unable to preview PDF document.",
      });
    }
  };

  const messages = detail?.tickets?.data ?? [];
  const totalPages = Math.max(1, detail?.tickets?.totalPages ?? 1);
  const currentPage = detail?.tickets?.currentPage ?? pageNo;
  const resolvedClosed = isResolvedOrClosed(detail?.status);

  return (
    <DashboardLayout>
      <div data-testid="page-ticket-details" className="w-full pb-16">
        {isLoading && (
          <div className="space-y-6" data-testid="ticket-detail-skeleton">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-md" />
              <Skeleton className="h-8 w-80" />
            </div>
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-44 w-full rounded-xl" />
          </div>
        )}

        {!isLoading &&
          ((isError && isSupportFurpAuthRequiredError(error)) ||
            replyAuthRequired) && (
            <div>
              <div className="mb-8 flex items-center gap-3">
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
                  Ticket details
                </h1>
              </div>

              <SupportSignInRequiredCard />
            </div>
          )}

        {isError &&
          !isLoading &&
          !isSupportFurpAuthRequiredError(error) &&
          !replyAuthRequired && (
          <div>
            <div className="mb-8 flex items-center gap-3">
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
                Ticket details
              </h1>
            </div>

            <div
              data-testid="ticket-detail-error"
              className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/70 px-6 py-14 text-center"
            >
              <AlertCircle className="mb-4 h-14 w-14 text-red-400" />
              <h2 className="text-lg font-semibold text-[#323130]">
                Ticket access restricted
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-[#605E5C]">
                {error instanceof Error
                  ? error.message
                  : "We encountered an issue fetching your support ticket."}
              </p>
              <div className="mt-6 flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/support/my-tickets")}
                  className="cursor-pointer"
                >
                  Back to my tickets
                </Button>
                <Button
                  type="button"
                  onClick={() => void refetch()}
                  data-testid="button-retry-ticket-detail"
                  className="cursor-pointer bg-[#2e5bff] text-white hover:bg-blue-700"
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !isError && !replyAuthRequired && detail && (
          <>
            {/* Header */}
            <div>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  aria-label="Back"
                  data-testid="button-back-my-tickets"
                  onClick={() => navigate("/support/my-tickets")}
                  className="mt-0.5 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#323130] transition-colors hover:bg-slate-100"
                >
                  <ChevronLeft className="h-6 w-6 stroke-[2.25]" />
                </button>
                <h1 className="font-display text-2xl font-light tracking-tight text-[#323130] md:text-[30px]">
                  #{detail.referenceNumber} {detail.summary}
                </h1>
              </div>

              <div className="mt-2 ml-11 flex flex-wrap items-center gap-4 text-sm">
                <span
                  className="text-[#605E5C]"
                  data-testid="ticket-detail-date"
                >
                  {formatSupportDate(detail.lastactivity || detail.requested)}
                </span>
                <span
                  data-testid="ticket-detail-status"
                  className={cn(
                    "rounded-md px-2 py-0.5 font-normal",
                    resolvedClosed ? "text-emerald-700" : "text-[#2e5bff]",
                  )}
                >
                  {formatSupportStatusLabel(detail.status)}
                </span>
              </div>
            </div>

            {/* Reply trigger & inline composer */}
            <div className="mt-8">
              {resolvedClosed && (
                <p
                  data-testid="ticket-reopen-hint"
                  className="mb-2.5 text-sm text-[#323130]"
                >
                  Reply to this ticket to open it
                </p>
              )}

              <button
                type="button"
                aria-expanded={isReplyOpen}
                data-testid="button-toggle-ticket-reply"
                onClick={() => setIsReplyOpen((prev) => !prev)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md bg-[#F9F9FA] px-4 py-3 text-left transition-colors hover:bg-slate-100"
              >
                <Pencil className="h-4 w-4 text-[#323130]" />
                <span className="text-[15px] font-normal text-[#323130]">
                  Reply
                </span>
              </button>

              {isReplyOpen && (
                <div
                  data-testid="panel-ticket-reply-composer"
                  className="mt-4 rounded-xl border border-slate-200 bg-white p-5"
                >
                  <Form {...replyForm}>
                    <form
                      onSubmit={replyForm.handleSubmit((vals) =>
                        replyMutation.mutate(vals),
                      )}
                      noValidate
                      className="space-y-4"
                    >
                      {/* Mandatory Description* above optional Attachment */}
                      <FormField
                        control={replyForm.control}
                        name="message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-normal text-[#323130]">
                              Description*
                            </FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                data-testid="textarea-ticket-reply"
                                className="min-h-[130px] resize-none border-slate-200 bg-white text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <SupportAttachmentUpload
                        selectedFile={replyFile}
                        previewUrl={replyPreviewUrl}
                        onFileSelect={(file, url) => {
                          setReplyFile(file);
                          setReplyPreviewUrl(url);
                        }}
                        onFileRemove={() => {
                          setReplyFile(null);
                          setReplyPreviewUrl(null);
                        }}
                        label="Attachment"
                        testIdPrefix="reply-ticket-attachment"
                      />

                      <div className="flex flex-col-reverse gap-3 pt-4 sm:max-w-md sm:flex-row">
                        <Button
                          type="button"
                          variant="outline"
                          data-testid="button-cancel-ticket-reply"
                          onClick={() => {
                            setIsReplyOpen(false);
                            resetReplyComposer();
                          }}
                          className="h-10 flex-1 cursor-pointer border-slate-300 text-[#323130]"
                        >
                          Cancel request
                        </Button>
                        <Button
                          type="submit"
                          disabled={replyMutation.isPending}
                          data-testid="button-submit-ticket-reply"
                          className="h-10 flex-1 cursor-pointer bg-[#2e5bff] text-white hover:bg-blue-700"
                        >
                          {replyMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Submit request
                        </Button>
                      </div>
                    </form>
                  </Form>
                </div>
              )}
            </div>

            {/* Conversation thread */}
            <div className="mt-6 space-y-5" data-testid="ticket-thread-list">
              {messages.map((item, idx) => (
                <TicketMessageCard
                  key={item.id || `${item.lastactivity}-${idx}`}
                  item={item}
                  idx={idx}
                  onOpenImageLightbox={(src, name) =>
                    setLightboxImage({ src, name })
                  }
                  onPreviewPdf={handlePreviewPdf}
                  onDownloadAttachment={handleDownloadAttachment}
                />
              ))}
            </div>

            {/* Thread pagination */}
            {totalPages > 1 && (
              <div
                data-testid="ticket-thread-pagination"
                className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  data-testid="button-thread-prev"
                  onClick={() => setPageNo((prev) => Math.max(1, prev - 1))}
                  className="cursor-pointer"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Prev
                </Button>

                <div className="flex flex-wrap items-center gap-3 text-sm text-[#323130]">
                  <span>
                    Page <strong className="font-semibold">{currentPage}</strong>{" "}
                    of <strong className="font-semibold">{totalPages}</strong>
                  </span>

                  <Select
                    value={String(pageSize)}
                    onValueChange={(val) => {
                      setPageSize(Number(val));
                      setPageNo(1);
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-28 text-xs"
                      data-testid="select-thread-page-size"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 10, 20, 50].map((sz) => (
                        <SelectItem key={sz} value={String(sz)}>
                          Show {sz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  data-testid="button-thread-next"
                  onClick={() =>
                    setPageNo((prev) => Math.min(totalPages, prev + 1))
                  }
                  className="cursor-pointer"
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}

            {/* Dismissible image attachment lightbox modal */}
            <Dialog
              open={Boolean(lightboxImage)}
              onOpenChange={(open) => {
                if (!open) setLightboxImage(null);
              }}
            >
              <DialogContent
                className="max-w-3xl bg-white"
                data-testid="dialog-attachment-lightbox"
              >
                <DialogHeader>
                  <DialogTitle className="text-base font-semibold text-[#323130]">
                    Attachment preview
                  </DialogTitle>
                  <DialogDescription className="text-xs text-[#605E5C]">
                    {lightboxImage?.name ?? "Uploaded image attachment"}
                  </DialogDescription>
                </DialogHeader>

                {lightboxImage && (
                  <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-slate-50 p-2">
                    <img
                      src={lightboxImage.src}
                      alt={lightboxImage.name}
                      className="max-h-[66vh] w-auto max-w-full rounded object-contain"
                    />
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="button-close-attachment-lightbox"
                    onClick={() => setLightboxImage(null)}
                    className="cursor-pointer"
                  >
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
