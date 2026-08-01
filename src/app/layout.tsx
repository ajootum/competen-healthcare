import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

// COMP-HOME-001 repositions the product from "East African nurses" to a healthcare workforce intelligence
// platform. The root metadata said the old thing on every page in the app, including the ones a search
// engine indexes, so it moves with the homepage rather than being left to contradict it.
export const metadata: Metadata = {
  title: { default: "Competen — Healthcare Competency & Workforce Platform", template: "%s · Competen" },
  description:
    "Competen connects competency management, assessments, workforce operations, learning, quality and AI " +
    "into one configurable platform for healthcare organisations.",
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
