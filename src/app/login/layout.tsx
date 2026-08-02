import { pageMetadata } from "@/lib/marketing/site";

// Metadata for /login, which is a client component and therefore CANNOT export `metadata` itself -- the
// export is silently ignored on a "use client" page. Without this the page shipped with no canonical while
// sitting in the sitemap, which is the one combination that actively confuses a crawler: listed as worth
// indexing, and carrying no statement of which URL is the real one.
//
// A route layout is the smallest fix; splitting the page into a server shell around a client form would
// achieve the same thing and touch far more code.
export const metadata = pageMetadata({
  title: "Sign in — Competen",
  description: "Sign in to your Competen workspace.",
  path: "/login",
});

export default function Layout({ children }: { children: React.ReactNode }) { return children; }
