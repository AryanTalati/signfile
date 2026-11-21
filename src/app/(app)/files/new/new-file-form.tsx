"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { formatFirmValue, isDateFill } from "@/lib/fields/format";
import type { TermOffer } from "@/lib/ai/term-offers";
import { Alert, Button, Card, Field } from "@/components/ui";
import { createFileAction, type CreateFileState } from "../actions";

export function NewFileForm(props: {
  templates: { id: string; name: string }[];
  templateId: string;
  problems: string[];
  firmFill: { key: string; label: string; required: boolean; offer: TermOffer | null }[];
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
  const [sendNow, setSendNow] = useState(v.sendNow === undefined ? true : v.sendNow === "on");

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
            <FirmFillField key={f.key} f={f} isDate={isDateFill(f)} initial={v[`firm:${f.key}`]} error={fe[`firm:${f.key}`]} />
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
          {props.firmFirst && signerIsMe && props.mySavedSignature && sendNow && (
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

      <label className="flex items-start gap-3 text-sm" data-testid="send-now">
        <input type="checkbox" name="sendNow" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-medium">Send immediately</span>
          <span className="block text-xs text-muted">Turn off to save it as a Draft. Nothing goes out until you press Send now on the File.</span>
        </span>
      </label>
      <Button type="submit" disabled={pending || blocked} className="self-start">
        {pending ? (sendNow ? "Sending…" : "Saving…") : sendNow ? "Send for signature" : "Save as draft"}
      </Button>
    </form>
  );
}

/** Today's date in the sender's own time zone (yyyy-mm-dd), computed in the browser. */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A date picker for a firm-filled date (Effective Date…): defaults to today, stamped as "November 20, 2026". */
function DateFill(p: { label: string; name: string; initial?: string; error?: string; value: string; onValue: (v: string) => void }) {
  const { value, onValue: setValue } = p;
  // Set after mount: the server doesn't know the sender's date (and must not cache a stale one).
  useEffect(() => {
    if (!p.initial) setValue(localToday());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return (
    <Field
      label={p.label}
      name={p.name}
      type="date"
      autoComplete="off"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      error={p.error}
      hint={value ? `Appears in the agreement as ${formatFirmValue(value)}.` : undefined}
      data-testid="date-fill"
    />
  );
}

/**
 * A "Filled by you" field. If the AI review found a matching key term, it's offered with its
 * source quote; the firm accepts it with one click (never filled in automatically).
 */
function FirmFillField(p: { f: { key: string; label: string; required: boolean; offer: TermOffer | null }; isDate: boolean; initial?: string; error?: string }) {
  const label = p.f.label + (p.f.required ? "" : " (optional)");
  const name = `firm:${p.f.key}`;
  const [value, setValue] = useState(p.initial ?? "");
  const offer = p.f.offer;
  const offerUi = offer && value !== offer.fill && (
    <div className="-mt-2 rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900" data-testid="term-offer">
      From the agreement{offer.page ? ` (p.${offer.page})` : ""}: “{offer.quote}”{" "}
      <button type="button" className="ml-1 font-medium underline" onClick={() => setValue(offer.fill)} data-testid="use-term">
        Use {offer.value}
      </button>
    </div>
  );
  return (
    <>
      {p.isDate ? (
        <DateFill label={label} name={name} initial={p.initial} error={p.error} value={value} onValue={setValue} />
      ) : (
        <Field label={label} name={name} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} error={p.error} />
      )}
      {offerUi}
    </>
  );
}
