"use client";

import { useActionState, useState, useTransition } from "react";
import { LocalTime } from "@/components/local-time";
import { Button, Field } from "@/components/ui";
import { EVENT_NAMES, FILE_EVENTS, type FileEventType } from "@/lib/integrations/events";
import { type IntegrationState, retryDeliveryAction, saveMindAction, saveSlackAction, saveWebhookAction } from "./integrations-actions";

function EventBoxes({ selected }: { selected: string[] }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-sm font-medium">Events</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {FILE_EVENTS.map((e) => (
          <label key={e} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={`event:${e}`} defaultChecked={selected.includes(e)} />
            {EVENT_NAMES[e as FileEventType]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Status({ state, pending, label }: { state: IntegrationState; pending: boolean; label: string }) {
  return (
    <>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" name="intent" value="save" disabled={pending} className="py-2">
          {pending ? "Saving…" : label}
        </Button>
        {state.ok && <span className="text-sm text-green-700">Saved</span>}
      </div>
    </>
  );
}

export function WebhookForm(p: { url: string | null; hasSecret: boolean; events: string[] }) {
  const [state, action, pending] = useActionState<IntegrationState, FormData>(saveWebhookAction, {});
  const [secret, setSecret] = useState("");
  const generate = () => setSecret(Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join(""));
  return (
    <form action={action} className="mt-4 flex flex-col gap-3" data-testid="webhook-form">
      <Field label="Webhook URL" id="webhook-url" name="url" type="url" autoComplete="off" defaultValue={p.url ?? ""} placeholder="https://example.com/hooks/signfile" />
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            label="Signing secret"
            id="webhook-secret"
            name="secret"
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={p.hasSecret ? "Saved. Leave blank to keep it" : "At least 16 characters"}
          />
        </div>
        <button type="button" onClick={generate} className="rounded-lg border border-border px-3 py-2.5 text-sm">
          Generate
        </button>
      </div>
      {secret && <p className="break-all text-xs text-muted">Copy this now; it won&apos;t be shown again after you save: <code data-testid="new-secret">{secret}</code></p>}
      <p className="text-xs text-muted">Each POST has an <code>X-SignFile-Signature: sha256=…</code> header: HMAC-SHA256 of the raw body with this secret.</p>
      <EventBoxes selected={p.events} />
      <Status state={state} pending={pending} label="Save webhook" />
      {p.url && (
        <button type="submit" name="intent" value="off" className="self-start text-sm text-red-700 underline">
          Turn off webhook
        </button>
      )}
    </form>
  );
}

/** Write-only: the saved URL is a secret (anyone with it can post to the channel), so only a masked hint comes back. */
export function SlackForm(p: { saved: boolean; hint: string | null; events: string[] }) {
  const [state, action, pending] = useActionState<IntegrationState, FormData>(saveSlackAction, {});
  return (
    <form action={action} className="mt-4 flex flex-col gap-3" data-testid="slack-form">
      <Field
        label="Slack incoming-webhook URL"
        id="slack-url"
        name="url"
        type="url"
        autoComplete="off"
        placeholder={p.saved ? "URL saved. Leave blank to keep it" : "https://hooks.slack.com/services/…"}
        hint={p.saved && p.hint ? <span data-testid="slack-saved-hint">Current: {p.hint}</span> : "In Slack: Apps → Incoming Webhooks → Add to a channel, then paste the URL here."}
      />
      <EventBoxes selected={p.events} />
      <Status state={state} pending={pending} label="Save Slack" />
      {p.saved && (
        <button type="submit" name="intent" value="off" className="self-start text-sm text-red-700 underline">
          Turn off Slack
        </button>
      )}
    </form>
  );
}

export function DeliveryLog(p: { rows: { id: string; target: string; event: string; status: string; attempts: number; error: string | null; createdAt: string }[] }) {
  const [pending, start] = useTransition();
  if (!p.rows.length) return <p className="mt-3 text-sm text-muted">Nothing sent yet.</p>;
  return (
    <ul className="mt-3 divide-y divide-border text-sm" data-testid="delivery-log">
      {p.rows.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="delivery-row" data-status={d.status} data-event={d.event} data-target={d.target}>
          <span className="font-medium">{d.event}</span>
          <span className="text-muted">{d.target === "slack" ? "Slack" : d.target === "mind" ? "MIND" : "Webhook"}</span>
          <span className={d.status === "failed" ? "text-red-700" : d.status === "delivered" ? "text-green-700" : "text-muted"} data-testid="delivery-status">
            {d.status === "delivered" ? "Delivered" : d.status === "failed" ? `Failed after ${d.attempts} attempt${d.attempts === 1 ? "" : "s"}` : "Sending…"}
            {d.status !== "delivered" && d.error ? ` (${d.error})` : ""}
          </span>
          <span className="text-muted">
            <LocalTime iso={d.createdAt} />
          </span>
          {d.status === "failed" && (
            <button type="button" disabled={pending} onClick={() => start(() => retryDeliveryAction(d.id))} className="ml-auto rounded border border-border px-2 py-1 text-xs" data-testid="delivery-retry">
              Retry
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MindForm(p: { hasKey: boolean; enabled: boolean }) {
  const [state, action, pending] = useActionState<IntegrationState, FormData>(saveMindAction, {});
  return (
    <form action={action} className="mt-4 flex flex-col gap-3" data-testid="mind-form">
      <Field
        label="MIND API key"
        id="mind-key"
        name="key"
        type="password"
        autoComplete="off"
        placeholder={p.hasKey ? "Key saved. Leave blank to keep it" : "mind_…"}
        hint="In MIND: Settings → Developer → API Keys. Create one just for SignFile so you can revoke it on its own."
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={p.enabled} data-testid="mind-enabled" />
        Push completed Files to MIND
      </label>
      <Status state={state} pending={pending} label="Save MIND" />
      {p.hasKey && (
        <button type="submit" name="intent" value="remove" className="self-start text-sm text-red-700 underline">
          Remove key and turn off
        </button>
      )}
    </form>
  );
}
