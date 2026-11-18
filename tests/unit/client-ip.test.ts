import assert from "node:assert/strict";
import { test } from "node:test";
import { getClientIp } from "../../src/lib/http/client-ip";

const prod = { production: true };
const dev = { production: false };
const h = (o: Record<string, string>) => new Headers(o);

// Real header sets captured from https://signfile.onrender.com on Nov 18, 2026.
const live = {
  "cf-connecting-ip": "70.162.26.248",
  "true-client-ip": "70.162.26.248",
  "x-forwarded-for": "70.162.26.248, 104.23.160.252, 10.29.232.158",
};
const spoofedXff = { ...live, "x-forwarded-for": "1.2.3.4,70.162.26.248, 104.22.193.27, 10.31.22.165" };

test("uses Cloudflare's CF-Connecting-IP on Render", () => {
  assert.equal(getClientIp(h(live), prod), "70.162.26.248");
});

test("a spoofed X-Forwarded-For is ignored", () => {
  assert.equal(getClientIp(h(spoofedXff), prod), "70.162.26.248");
});

test("falls back to True-Client-IP", () => {
  assert.equal(getClientIp(h({ "true-client-ip": "2001:db8::1", "x-forwarded-for": "1.2.3.4" }), prod), "2001:db8::1");
});

test("production never trusts X-Forwarded-For alone", () => {
  assert.equal(getClientIp(h({ "x-forwarded-for": "1.2.3.4" }), prod), null);
});

test("garbage values are rejected", () => {
  assert.equal(getClientIp(h({ "cf-connecting-ip": "not-an-ip", "true-client-ip": "<script>" }), prod), null);
});

test("dev without a proxy uses the first X-Forwarded-For entry", () => {
  assert.equal(getClientIp(h({ "x-forwarded-for": "127.0.0.1, 10.0.0.1" }), dev), "127.0.0.1");
  assert.equal(getClientIp(h({}), dev), null);
});
