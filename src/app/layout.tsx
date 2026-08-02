import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SITE_URL, DEFAULT_OG_IMAGE, OG_IMAGE_SIZE } from "@/lib/marketing/site";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

// Site-wide metadata. This is the DEFAULT for every page that does not set its own, which means it is what
// a search engine prints under /login, /signup and anything else without explicit metadata.
//
// THE DESCRIPTION USED TO NAME A FORBIDDEN PRODUCT. It read "Competen connects competency management,
// assessments, workforce operations, learning, quality and AI into one configurable platform" -- and
// WEB-STRAT-001 forbids "Competency Management" on any public page. It survived because the disclosure
// harness reads VISIBLE TEXT, and meta content lives in an attribute that tag-stripping throws away. So the
// one place the rule was being broken was the one place nothing was looking, on a string that Google
// renders under the search result. The harness now scans titles, descriptions and social tags too.
//
// metadataBase is what turns the relative OG image path below into an absolute URL. Without it Next warns
// and falls back to localhost, which produces cards that look right in development and are broken for
// every person who is ever shown one.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Competen — Healthcare. Empowered.", template: "%s · Competen" },
  description:
    "Competen helps students, professionals, practices and hospitals build capability, deliver better " +
    "care and improve outcomes.",
  // NO `alternates.canonical` HERE. It would be inherited by every page in the application, declaring each
  // one a duplicate of the homepage and asking search engines not to index any of them separately -- which
  // would quietly cancel out the sitemap. Public pages set their own via pageMetadata().
  openGraph: {
    type: "website",
    siteName: "Competen",
    locale: "en_GB",
    url: SITE_URL,
    title: "Competen — Healthcare. Empowered.",
    description:
      "Competen helps students, professionals, practices and hospitals build capability, deliver better " +
      "care and improve outcomes.",
    images: [{ ...OG_IMAGE_SIZE, url: DEFAULT_OG_IMAGE, alt: "Healthcare professionals at work" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Competen — Healthcare. Empowered.",
    description:
      "Competen helps students, professionals, practices and hospitals build capability, deliver better " +
      "care and improve outcomes.",
    images: [DEFAULT_OG_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <head>
        {/* Apply the persisted sidebar-collapsed state before paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('sb-collapsed')==='1')document.documentElement.classList.add('sb-collapsed')}catch(e){}" }} />
      </head>
      <body className="min-h-full flex flex-col bg-white text-gray-900">{children}</body>
    </html>
  );
}
