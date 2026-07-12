import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Sign in with a Bluesky app password | Corgi",
  description:
    "Connect your Bluesky account to vote on Corgi's feed ranking. App passwords are scoped, revocable, and never your real password.",
  alternates: { canonical: "/sign-in/" },
}

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
