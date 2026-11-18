import type { Metadata } from "next";
import { DEMO } from "@/lib/demo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in · signfile" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={next} demo={{ email: DEMO.email, password: DEMO.password }} />;
}
