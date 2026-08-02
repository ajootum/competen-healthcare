import { pageMetadata } from "@/lib/marketing/site";

// See src/app/login/layout.tsx -- /signup is a client component and cannot export metadata either.
export const metadata = pageMetadata({
  title: "Create your Competen account",
  description: "Create a Competen account to get started.",
  path: "/signup",
});

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
