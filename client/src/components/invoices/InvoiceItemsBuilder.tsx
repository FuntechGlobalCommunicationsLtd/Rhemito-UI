/**
 * Invoice Items Builder — "generate an invoice on the go"
 *
 * PayPal-style line-item editor for the Send Invoice page: item rows
 * (description, optional detail, quantity × unit price), an optional discount
 * (percentage or fixed), an optional tax percentage and a note to the client.
 * Totals are computed live with the shared authoritative logic so the builder,
 * the review step and the server always agree.
 */

import { Plus, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeInvoiceTotals, itemDiscountAmount, type InvoiceTotals } from "@shared/invoice-logic";

export interface BuilderItem {
  id: string;
  name: string;
  description: string;
  quantity: string;
  unitAmount: string;
  discountType: BuilderDiscountType;
  discountValue: string;
}

export type BuilderDiscountType = "none" | "percent" | "fixed";

export function newBuilderItem(): BuilderItem {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    quantity: "1",
    unitAmount: "",
    discountType: "none",
    discountValue: "",
  };
}

const toNumber = (value: string): number => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const hasAtMostTwoDecimals = (value: string): boolean => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && Math.round(parsed * 100) === parsed * 100;
};

/** Optional per-item discount amount (percentage of the line, or fixed). */
export function itemDiscountOf(item: BuilderItem): number {
  return itemDiscountAmount({
    quantity: toNumber(item.quantity),
    unitAmount: toNumber(item.unitAmount),
    discountType: item.discountType === "none" ? null : item.discountType,
    discountValue: toNumber(item.discountValue),
  });
}

const isItemDiscountValid = (item: BuilderItem): boolean =>
  item.discountType === "none" ||
  (toNumber(item.discountValue) > 0 &&
    hasAtMostTwoDecimals(item.discountValue) &&
    (item.discountType !== "percent" || toNumber(item.discountValue) <= 100));

/** A row only counts when it has a name, a positive quantity × unit price and a valid discount. */
export function isItemComplete(item: BuilderItem): boolean {
  return Boolean(
    item.name.trim() &&
    toNumber(item.quantity) > 0 &&
    toNumber(item.unitAmount) > 0 &&
    hasAtMostTwoDecimals(item.quantity) &&
    hasAtMostTwoDecimals(item.unitAmount) &&
    isItemDiscountValid(item),
  );
}

export function areItemsValid(items: BuilderItem[]): boolean {
  return items.length > 0 && items.every(isItemComplete);
}

export function itemLineAmount(item: BuilderItem): number {
  return Math.round(toNumber(item.quantity) * toNumber(item.unitAmount) * 100) / 100;
}

/** Live totals for the builder (shared authoritative math, numeric adapter). */
export function builderTotals(
  items: BuilderItem[],
  taxRate: string,
  discountType: BuilderDiscountType,
  discountValue: string,
): InvoiceTotals {
  return computeInvoiceTotals({
    items: items.map((item) => ({
      quantity: toNumber(item.quantity),
      unitAmount: toNumber(item.unitAmount),
      discountType: item.discountType === "none" ? null : item.discountType,
      discountValue: item.discountType === "none" ? null : toNumber(item.discountValue),
    })),
    taxRate: taxRate.trim() ? toNumber(taxRate) : null,
    discountType: discountType === "none" ? null : discountType,
    discountValue: discountType === "none" ? null : toNumber(discountValue),
  });
}

interface InvoiceItemsBuilderProps {
  currency: string;
  currencySymbol: string;
  items: BuilderItem[];
  onItemsChange: (items: BuilderItem[]) => void;
  taxRate: string;
  onTaxRateChange: (value: string) => void;
  discountType: BuilderDiscountType;
  onDiscountTypeChange: (value: BuilderDiscountType) => void;
  discountValue: string;
  onDiscountValueChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
}

export function InvoiceItemsBuilder({
  currency,
  currencySymbol,
  items,
  onItemsChange,
  taxRate,
  onTaxRateChange,
  discountType,
  onDiscountTypeChange,
  discountValue,
  onDiscountValueChange,
  notes,
  onNotesChange,
}: InvoiceItemsBuilderProps) {
  const totals = builderTotals(items, taxRate, discountType, discountValue);
  const hasIncompleteItem = items.some((item) => !isItemComplete(item));
  const taxInvalid = taxRate.trim() !== "" && (toNumber(taxRate) <= 0 || toNumber(taxRate) > 100);
  const discountInvalid =
    discountType !== "none" &&
    (discountValue.trim() === "" || toNumber(discountValue) <= 0 ||
      (discountType === "percent" && toNumber(discountValue) > 100));

  const updateItem = (index: number, patch: Partial<BuilderItem>) => {
    onItemsChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addItem = () => onItemsChange([...items, newBuilderItem()]);
  const removeItem = (index: number) => onItemsChange(items.filter((_, i) => i !== index));

  return (
    <div className="space-y-4" data-testid="invoice-items-builder">
      <div>
        <Label className="text-sm font-semibold text-foreground">
          Invoice Items <span className="text-destructive">*</span>
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Describe each item or service — the invoice total is calculated automatically.
        </p>
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div
            key={item.id}
            className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3"
            data-testid={`invoice-item-row-${index}`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <Input
                  placeholder="Item description (e.g. Consulting services)"
                  value={item.name}
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                  className="bg-white font-medium"
                  data-testid={`input-item-name-${index}`}
                  maxLength={100}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeItem(index)}
                disabled={items.length === 1}
                className="text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                data-testid={`button-remove-item-${index}`}
                aria-label={`Remove item ${index + 1}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, { quantity: e.target.value })}
                  className="bg-white"
                  data-testid={`input-item-qty-${index}`}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Unit Price ({currency})</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {currencySymbol}
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={item.unitAmount}
                    onChange={(e) => updateItem(index, { unitAmount: e.target.value })}
                    className="bg-white pl-7"
                    data-testid={`input-item-unit-${index}`}
                  />
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Input
                  placeholder="Detail (optional)"
                  value={item.description}
                  onChange={(e) => updateItem(index, { description: e.target.value })}
                  className="bg-white text-xs h-8"
                  data-testid={`input-item-detail-${index}`}
                  maxLength={500}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Discount (Optional)</Label>
                <div className="flex gap-1.5">
                  <Select
                    value={item.discountType}
                    onValueChange={(value) =>
                      updateItem(index, { discountType: value as BuilderDiscountType })
                    }
                  >
                    <SelectTrigger className="w-[64px] bg-white px-2" data-testid={`select-item-discount-type-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="fixed">{currencySymbol}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={item.discountValue}
                    onChange={(e) => updateItem(index, { discountValue: e.target.value })}
                    disabled={item.discountType === "none"}
                    className="bg-white flex-1 disabled:bg-slate-100/60 disabled:text-muted-foreground"
                    data-testid={`input-item-discount-${index}`}
                  />
                </div>
                {item.discountType !== "none" && !isItemDiscountValid(item) && (
                  <p className="text-[10px] text-destructive" data-testid={`error-item-discount-${index}`}>
                    {item.discountType === "percent" ? "Enter a percentage between 0 and 100." : "Enter a discount amount."}
                  </p>
                )}
              </div>
              <div className="space-y-1.5 text-right sm:text-right" data-testid={`text-item-amount-${index}`}>
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <p className="text-base font-semibold text-slate-900 leading-9">
                  {currencySymbol}
                  {itemLineAmount(item).toFixed(2)}
                </p>
                {itemDiscountOf(item) > 0 && (
                  <p className="text-[11px] font-medium text-teal" data-testid={`text-item-discount-${index}`}>
                    −{currencySymbol}
                    {itemDiscountOf(item).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasIncompleteItem && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5" data-testid="hint-complete-items">
          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          Every item needs a description, a quantity and a unit price before the invoice can be reviewed.
        </p>
      )}

      {/* Add item — directly under the last item row (PayPal-style) */}
      <button
        type="button"
        onClick={addItem}
        disabled={items.length >= 100}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 text-sm font-semibold text-primary transition-all hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="button-add-item"
      >
        <Plus className="w-4 h-4" />
        Add Item
      </button>

      {/* Discount and Tax */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div className="space-y-2">
          <Label className="text-sm">Discount (Optional)</Label>
          <div className="flex gap-2">
            <Select
              value={discountType}
              onValueChange={(value) => onDiscountTypeChange(value as BuilderDiscountType)}
            >
              <SelectTrigger className="w-36 bg-white" data-testid="select-discount-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No discount</SelectItem>
                <SelectItem value="percent">Percentage</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            {discountType === "percent" && (
              <div className="relative flex-1">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="0"
                  value={discountValue}
                  onChange={(e) => onDiscountValueChange(e.target.value)}
                  className="bg-white pr-7"
                  data-testid="input-discount-value"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            )}
            {discountType === "fixed" && (
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currencySymbol}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={discountValue}
                  onChange={(e) => onDiscountValueChange(e.target.value)}
                  className="bg-white pl-7"
                  data-testid="input-discount-value"
                />
              </div>
            )}
          </div>
          {discountInvalid && (
            <p className="text-[11px] text-destructive" data-testid="error-discount-value">
              {discountType === "percent"
                ? "Enter a discount percentage between 0 and 100."
                : "Enter a discount amount greater than zero."}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-sm" htmlFor="taxRate">Tax Percentage (Optional)</Label>
          <div className="relative">
            <Input
              id="taxRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="0"
              value={taxRate}
              onChange={(e) => onTaxRateChange(e.target.value)}
              className="bg-white pr-7"
              data-testid="input-tax-rate"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
          {taxInvalid && (
            <p className="text-[11px] text-destructive" data-testid="error-tax-rate">
              Enter a tax percentage between 0 and 100.
            </p>
          )}
        </div>
      </div>

      {/* Notes to client */}
      <div className="space-y-2">
        <Label className="text-sm" htmlFor="invoiceNotes">Notes to Client (Optional)</Label>
        <Textarea
          id="invoiceNotes"
          placeholder="Add a message that will appear on the invoice (e.g. payment terms or a thank-you note)"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="bg-white min-h-20"
          data-testid="input-invoice-notes"
          maxLength={500}
        />
      </div>

      {/* Totals */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2" data-testid="builder-totals">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Subtotal:</span>
          <span className="font-medium text-slate-800" data-testid="text-subtotal">
            {currencySymbol}{totals.subtotal.toFixed(2)} {currency}
          </span>
        </div>
        {totals.itemsDiscountTotal > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Items Discount:</span>
            <span className="font-medium text-teal" data-testid="text-items-discount-total">
              -{currencySymbol}{totals.itemsDiscountTotal.toFixed(2)} {currency}
            </span>
          </div>
        )}
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              Discount{discountType === "percent" && discountValue ? ` (${discountValue}%)` : ""}:
            </span>
            <span className="font-medium text-teal" data-testid="text-discount-amount">
              -{currencySymbol}{totals.discountAmount.toFixed(2)} {currency}
            </span>
          </div>
        )}
        {totals.taxAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tax{taxRate ? ` (${taxRate}%)` : ""}:</span>
            <span className="font-medium text-slate-800" data-testid="text-tax-amount">
              +{currencySymbol}{totals.taxAmount.toFixed(2)} {currency}
            </span>
          </div>
        )}
        <div className="h-px bg-primary/20" />
        <div className="flex justify-between items-baseline pt-1">
          <span className="font-semibold text-slate-900">Invoice Total:</span>
          <span className="font-bold text-lg text-primary" data-testid="text-invoice-total">
            {currencySymbol}{totals.total.toFixed(2)} {currency}
          </span>
        </div>
      </div>
    </div>
  );
}
