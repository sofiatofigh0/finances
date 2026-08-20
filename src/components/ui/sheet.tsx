"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Bottom sheet on mobile, centred panel on larger screens. Used for every
 * edit flow so the app never buries functionality in modal-after-modal.
 */
export function SheetContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-3xl border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-2xl",
          "sm:inset-x-auto sm:left-1/2 sm:bottom-auto sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-2">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-tight">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-full p-2 text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-sunken)]"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="safe-bottom overflow-y-auto px-5 pb-6">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
