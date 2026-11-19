"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { createFileAction, type CreateFileState } from "../actions";

export function NewFileForm(props: {
  templates: { id: string; name: string }[];
  templateId: string;
  problems: string[];
  firmFill: { key: string; label: string; required: boolean }[];
  countersign: boolean;
  team: { id: string; name: string; title: string | null; email: string }[];
  defaultCountersignerId: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<CreateFileState, FormData>(createFileAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const blocked = props.problems.length > 0;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="templateId" className="text-sm font-medium">
            Agreement
          </label>
          <select
            id="templateId"
            name="templateId"
            defaultValue={props.templateId}
            onChange={(e) => router.push(`/files/new?template=${e.target.value}`)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base sm:text-sm"
          >
            {props.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {fe.templateId && <p className="text-sm text-red-600">{fe.templateId}</p>}
        </div>
        {blocked && (
          <Alert>
            This template isn&apos;t ready: {props.problems[0]}{" "}
            <Link className="underline" href={`/templates/${props.templateId}`}>
              Fix the fields
            </Link>
          </Alert>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-semibold">Client</h2>
        <Field label="Client's legal name" name="clientLegalName" required defaultValue={v.clientLegalName} error={fe.clientLegalName} hint="As it should appear on the agreement." />
        <Field label="Reference (optional)" name="reference" defaultValue={v.reference} error={fe.reference} hint="Your job or project number." />
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-semibold">Who signs for the client</h2>
        <Field label="Name" name="signerName" autoComplete="off" required defaultValue={v.signerName} error={fe.signerName} />
        <Field label="Title (optional)" name="signerTitle" autoComplete="off" defaultValue={v.signerTitle} error={fe.signerTitle} />
        <Field label="Email" name="signerEmail" type="email" autoComplete="off" required defaultValue={v.signerEmail} error={fe.signerEmail} />
      </Card>

      {props.firmFill.length > 0 && (
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="font-semibold">Filled by you</h2>
            <p className="text-sm text-muted">These go into the agreement before it&apos;s sent. The client sees them but can&apos;t change them.</p>
          </div>
          {props.firmFill.map((f) => (
            <Field key={f.key} label={f.label + (f.required ? "" : " (optional)")} name={`firm:${f.key}`} defaultValue={v[`firm:${f.key}`]} error={fe[`firm:${f.key}`]} />
          ))}
        </Card>
      )}

      {props.countersign && (
        <Card className="flex flex-col gap-1.5 p-5">
          <label htmlFor="countersignerId" className="font-semibold">
            Countersigns for your firm
          </label>
          <select
            id="countersignerId"
            name="countersignerId"
            defaultValue={v.countersignerId ?? props.defaultCountersignerId}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base sm:text-sm"
          >
            {props.team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.title ? `, ${u.title}` : ""}
              </option>
            ))}
          </select>
          <p className="text-sm text-muted">They get their link after the client signs.</p>
          {fe.countersignerId && <p className="text-sm text-red-600">{fe.countersignerId}</p>}
        </Card>
      )}

      <Button type="submit" disabled={pending || blocked} className="self-start">
        {pending ? "Sending…" : "Send for signature"}
      </Button>
    </form>
  );
}
