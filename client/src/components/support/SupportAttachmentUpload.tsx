import { useRef, useState } from "react";
import { FileText, Image as ImageIcon, UploadCloud, X } from "lucide-react";
import {
  SUPPORT_ALLOWED_EXTENSIONS,
  SUPPORT_ALLOWED_MIME_TYPES,
  SUPPORT_MAX_FILE_BYTES,
} from "@shared/support";
import { useToast } from "@/hooks/use-toast";
import { formatFileSize } from "@/lib/support";
import { cn } from "@/lib/utils";

export interface SupportAttachmentUploadProps {
  selectedFile: File | null;
  previewUrl: string | null;
  onFileSelect: (file: File, previewUrl: string | null) => void;
  onFileRemove: () => void;
  label?: string;
  testIdPrefix?: string;
}

function isAllowedSupportFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase().trim();
  const ext = (file.name.split(".").pop() || "").toLowerCase().trim();
  const mimeValid = (SUPPORT_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
  const extValid = (SUPPORT_ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
  if (mime) {
    return mimeValid && extValid;
  }
  return extValid;
}

function isImageSupportFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase().trim();
  const ext = (file.name.split(".").pop() || "").toLowerCase().trim();
  return mime.startsWith("image/") || ["png", "jpg", "jpeg"].includes(ext);
}

export function SupportAttachmentUpload({
  selectedFile,
  previewUrl,
  onFileSelect,
  onFileRemove,
  label = "Attachment",
  testIdPrefix = "support-attachment",
}: SupportAttachmentUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  const clearNativeInput = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const processCandidateFile = (file: File) => {
    if (!isAllowedSupportFile(file)) {
      toast({
        variant: "destructive",
        title: "Invalid file type",
        description: "Selected file type is not allowed.",
      });
      clearNativeInput();
      return;
    }

    if (file.size > SUPPORT_MAX_FILE_BYTES) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "File size must not exceed 2MB.",
      });
      clearNativeInput();
      return;
    }

    if (isImageSupportFile(file)) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onFileSelect(file, typeof reader.result === "string" ? reader.result : null);
      };
      reader.readAsDataURL(file);
    } else {
      onFileSelect(file, null);
    }
  };

  const handleRemove = () => {
    onFileRemove();
    clearNativeInput();
  };

  return (
    <div className="w-full">
      {label && (
        <label className="mb-2.5 block text-sm font-normal text-[#323130]">
          {label}
        </label>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
        className="hidden"
        data-testid={`${testIdPrefix}-input`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            processCandidateFile(file);
          }
        }}
      />

      {selectedFile ? (
        <div
          className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
          data-testid={`${testIdPrefix}-selected`}
        >
          {previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt={selectedFile.name}
                className="block max-h-[220px] w-full object-cover"
                data-testid={`${testIdPrefix}-image-preview`}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/45" />
              <button
                type="button"
                aria-label="Remove file"
                data-testid={`${testIdPrefix}-remove-overlay`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="absolute top-2 right-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-red-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 bg-[#F7F8FA] py-7"
              data-testid={`${testIdPrefix}-pdf-banner`}
            >
              <FileText className="h-12 w-12 text-[#8B83F7]" />
              <span className="text-xs font-medium text-[#605E5C]">PDF document</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-3.5 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {previewUrl ? (
                <ImageIcon className="h-5 w-5 shrink-0 text-[#6C63FF]" />
              ) : (
                <FileText className="h-5 w-5 shrink-0 text-[#6C63FF]" />
              )}
              <div className="min-w-0">
                <p
                  className="max-w-[220px] truncate text-sm font-semibold text-slate-800 sm:max-w-xs"
                  title={selectedFile.name}
                  data-testid={`${testIdPrefix}-filename`}
                >
                  {selectedFile.name}
                </p>
                <p
                  className="text-[11px] text-slate-400"
                  data-testid={`${testIdPrefix}-filesize`}
                >
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                data-testid={`${testIdPrefix}-replace`}
                className="cursor-pointer text-xs font-medium text-[#6C63FF] hover:underline"
              >
                Replace
              </button>
              <button
                type="button"
                aria-label="Remove file"
                onClick={handleRemove}
                data-testid={`${testIdPrefix}-remove`}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          data-testid={`${testIdPrefix}-dropzone`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) {
              processCandidateFile(file);
            }
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-8 transition-colors",
            isDragging
              ? "border-[#6C63FF] bg-[#6C63FF]/[0.06]"
              : "border-slate-300 bg-[#FAFAFA] hover:border-[#6C63FF] hover:bg-[#6C63FF]/[0.04]",
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center rounded-full p-3.5 transition-colors",
              isDragging ? "bg-[#6C63FF]/15" : "bg-[#F0EEFF]",
            )}
          >
            <UploadCloud
              className={cn(
                "h-8 w-8 transition-colors",
                isDragging ? "text-[#6C63FF]" : "text-[#8B83F7]",
              )}
            />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800">
              Drag &amp; drop or{" "}
              <span className="text-[#6C63FF] underline underline-offset-2">
                browse files
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-400">
              PNG, JPG, PDF — max 2MB, single file only
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
