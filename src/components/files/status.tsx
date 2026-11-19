const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-neutral-100 text-neutral-700" },
  sent: { label: "Waiting for client", cls: "bg-blue-50 text-blue-800" },
  partially_signed: { label: "Waiting for countersign", cls: "bg-violet-50 text-violet-800" },
  completed: { label: "Signed", cls: "bg-green-50 text-green-800" },
  changes_requested: { label: "Changes requested", cls: "bg-amber-50 text-amber-800" },
  declined: { label: "Declined", cls: "bg-red-50 text-red-800" },
  voided: { label: "Voided", cls: "bg-neutral-100 text-neutral-600" },
  expired: { label: "Expired", cls: "bg-neutral-100 text-neutral-600" },
};

export function FileStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-neutral-100" };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${s.cls}`} data-testid="file-status">
      {s.label}
    </span>
  );
}
