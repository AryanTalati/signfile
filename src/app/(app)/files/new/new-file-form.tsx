"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Alert, Button, Card, Field } from "@/components/ui";
import { createFileAction, type CreateFileState } from "../actions";

export function NewFileForm(props: {
  templates: { id: string; name: string }[];
  templateId: string;
  problems: string[];
  firmFill: { key: string; label: string; required: boolean }[];
  countersign: boolean;
  firmFirst: boolean;
  mySavedSignature: string | null;
  team: { id: string; name: string; title: string | null; email: string; autoCountersign: boolean }[];
  defaultCountersignerId: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<CreateFileState, FormData>(createFileAction, {});
  const fe = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const blocked = props.problems.length > 0;
  const [signer, setSigner] = useState(v.countersignerId ?? props.defaultCountersignerId);
  const signerIsMe = signer === props.defaultCountersignerId;

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
            {props.firmFirst ? "Signs for your firm (before the client)" : "Countersigns for your firm"}
          </label>
          <select
            id="countersignerId"
            name="countersignerId"
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-base sm:text-sm"
          >
            {props.team.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.title ? `, ${u.title}` : ""}
              </option>
            ))}
          </select>
          {!props.firmFirst && (props.team.find((u) => u.id === signer)?.autoCountersign ? (
            <p className="text-sm text-muted" data-testid="auto-countersign-note">Countersigns automatically with their saved signature as soon as the client signs; the File then seals.</p>
          ) : (
            <p className="text-sm text-muted">They get their link after the client signs.</p>
          ))}
          {props.firmFirst && signerIsMe && props.mySavedSignature && (
            <label className="mt-2 flex items-start gap-3 rounded-lg border border-border p-3 text-sm" data-testid="sign-now">
              <input type="checkbox" name="signNow" defaultChecked className="mt-1" />
              <span>
                <span className="font-medium">Sign now with my saved signature</span>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img src={props.mySavedSignature} alt="Your saved signature" className="mt-1 block h-8 max-w-48 object-contain object-left" />
                <span className="block text-xs text-muted">I agree to sign this agreement electronically now. The client gets it as soon as you send.</span>
              </span>
            </label>
          )}
          {props.firmFirst && signerIsMe && !props.mySavedSignature && (
            <p className="text-sm text-muted">
              You sign first, then it goes to the client. Save your signature in <Link href="/settings" className="underline">Settings</Link> to sign while sending.
            </p>
          )}
          {props.firmFirst && !signerIsMe && <p className="text-sm text-muted">They sign first; the client gets it once they have.</p>}
          {fe.countersignerId && <p className="text-sm text-red-600">{fe.countersignerId}</p>}
        </Card>
      )}

      <Button type="submit" disabled={pending || blocked} className="self-start">
        {pending ? "Sending…" : "Send for signature"}
      </Button>
    </form>
  );
}
