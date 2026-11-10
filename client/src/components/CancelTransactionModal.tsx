import { useState, type ReactElement } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export interface TransactionDetails {
  id: string;
  recipient: string;
  amount: string;
  service: string;
}

interface CancelTransactionModalProps {
  open: boolean;
  transaction: TransactionDetails | null;
  onConfirm: (transactionId: string) => Promise<void>;
  onCancel: () => void;
}

export function CancelTransactionModal({
  open,
  transaction,
  onConfirm,
  onCancel,
}: CancelTransactionModalProps): ReactElement | null {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    if (!transaction) return;
    setIsLoading(true);
    setError(null);
    try {
      await onConfirm(transaction.id);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeep = (): void => {
    if (isLoading) return;
    setError(null);
    onCancel();
  };

  if (!transaction) return null;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-2xl border border-border shadow-2xl">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="p-6 space-y-5"
        >
          {/* Icon */}
          <div className="flex justify-center">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
          </div>

          {/* Title & Description */}
          <div className="text-center space-y-2">
            <AlertDialogTitle className="font-display text-lg font-semibold text-gray-900">
              Cancel Transaction?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground leading-relaxed">
              This action cannot be undone. The following transaction will be permanently cancelled.
            </AlertDialogDescription>
          </div>

          {/* Transaction Details Card */}
          <div className="bg-muted border border-border rounded-lg p-4 space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-muted-foreground">Ref No.</span>
              <span className="text-xs font-semibold text-gray-900">{transaction.id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-muted-foreground">Recipient</span>
              <span className="text-xs font-semibold text-gray-900">{transaction.recipient}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-muted-foreground">Amount</span>
              <span className="text-xs font-semibold text-gray-900">{transaction.amount}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-muted-foreground">Service</span>
              <span className="text-xs font-semibold text-gray-900">{transaction.service}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-11 font-medium rounded-full border-[#d2d0ce] text-[#323130]"
              onClick={handleKeep}
              disabled={isLoading}
              autoFocus
              data-testid="button-keep-transaction"
            >
              Keep Transaction
            </Button>
            <Button
              variant="destructive"
              className="flex-1 h-11 font-medium rounded-full"
              onClick={handleConfirm}
              disabled={isLoading}
              data-testid="button-confirm-cancel"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                "Cancel Transaction"
              )}
            </Button>
          </div>

          {/* Inline error */}
          {error && (
            <p className="text-destructive text-xs mt-3 text-center">{error}</p>
          )}
        </motion.div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
