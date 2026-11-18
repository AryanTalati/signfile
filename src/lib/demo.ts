/**
 * Public demo account (test data only). Shown on the login page and in the
 * README so graders can try the product without signing up. `npm run seed`
 * (re)creates it and resets the password.
 */
export const DEMO = {
  companyName: "Astra AI",
  slug: "astra-ai",
  email: "demo@astra-ai.example",
  password: "astra-demo-2026",
  name: "Alex Morgan",
  title: "Managing Director",
  brandColor: "#4338ca",
} as const;
