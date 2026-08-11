"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input, Select, Field } from "@/components/ui/input";
import type { ActionResult } from "@/app/actions/finance";

export type FieldSpec =
  | {
      kind: "text" | "number" | "date" | "money";
      name: string;
      label: string;
      hint?: string;
      required?: boolean;
      placeholder?: string;
      defaultValue?: string | number | null;
    }
  | {
      kind: "select";
      name: string;
      label: string;
      hint?: string;
      options: { value: string; label: string }[];
      defaultValue?: string | null;
    }
  | {
      kind: "checkbox";
      name: string;
      label: string;
      hint?: string;
      defaultChecked?: boolean;
    };

/**
 * A single sheet-based editor reused by every record type (bills, income,
 * goals, planned expenses, manual debts). One consistent editing pattern beats
 * five bespoke modals, and it keeps the "edit without burying functionality in
 * modal after modal" rule honest.
 */
export function EntityForm({
  trigger,
  title,
  description,
  fields,
  action,
  deleteAction,
  recordId,
  submitLabel = "Save",
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  fields: FieldSpec[];
  action: (form: FormData) => Promise<ActionResult>;
  deleteAction?: (form: FormData) => Promise<ActionResult>;
  recordId?: string;
  submitLabel?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit(formData: FormData) {
    if (recordId) formData.set("id", recordId);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.error ?? "We couldn't save that.");
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    if (!deleteAction || !recordId) return;
    const formData = new FormData();
    formData.set("id", recordId);
    startTransition(async () => {
      const result = await deleteAction(formData);
      if (!result.ok) {
        setError(result.error ?? "We couldn't remove that.");
        return;
      }
      setOpen(false);
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setConfirmDelete(false);
        }
      }}
    >
      <button type="button" onClick={() => setOpen(true)} className="contents">
        {trigger}
      </button>

      <SheetContent title={title} description={description}>
        <form action={submit}>
          {fields.map((field) => {
            if (field.kind === "checkbox") {
              return (
                <label
                  key={field.name}
                  className="mb-4 flex items-start gap-3 rounded-xl bg-[var(--color-surface-sunken)] p-3.5"
                >
                  <input
                    type="checkbox"
                    name={field.name}
                    defaultChecked={field.defaultChecked}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--color-ink)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium">
                      {field.label}
                    </span>
                    {field.hint ? (
                      <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-ink-muted)]">
                        {field.hint}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            }

            if (field.kind === "select") {
              return (
                <Field key={field.name} label={field.label} hint={field.hint}>
                  <Select
                    name={field.name}
                    defaultValue={field.defaultValue ?? undefined}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            }

            const inputType =
              field.kind === "money" || field.kind === "number"
                ? "number"
                : field.kind;

            return (
              <Field key={field.name} label={field.label} hint={field.hint}>
                <Input
                  name={field.name}
                  type={inputType}
                  required={field.required}
                  placeholder={field.placeholder}
                  defaultValue={field.defaultValue ?? undefined}
                  {...(field.kind === "money"
                    ? { step: "0.01", min: "0", inputMode: "decimal" as const }
                    : {})}
                  {...(field.kind === "number"
                    ? { inputMode: "numeric" as const }
                    : {})}
                />
              </Field>
            );
          })}

          {children}

          {error ? (
            <p
              role="alert"
              className="mb-3 rounded-xl bg-[var(--color-negative-soft)] px-3.5 py-2.5 text-[13px] text-[var(--color-negative)]"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" size="lg" className="w-full" disabled={isPending}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </form>

        {deleteAction && recordId ? (
          <div className="mt-3">
            {confirmDelete ? (
              <div className="rounded-xl bg-[var(--color-negative-soft)] p-3.5">
                <p className="text-[13px] text-[var(--color-negative)]">
                  Remove this permanently?
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={remove}
                    disabled={isPending}
                  >
                    Yes, remove
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-[var(--color-negative)]"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Standard "+ Add" affordance used across the Plan and Goals screens. */
export function AddButton({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]">
      <Plus className="size-3.5" />
      {label}
    </span>
  );
}
