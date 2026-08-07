import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "mockinterview.live — AI System Design Interviews",
  description:
    "Realistic AI-led mock system design interviews: a human-like interviewer that talks, watches you draw, interrupts with deep-dive questions, and scores you across every dimension of a real interview.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Apply saved theme before paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.setAttribute('data-theme',localStorage.getItem('mi_theme')||'dark')}catch(e){}` }} />
      </head>
      <body>
        <LanguageProvider>
          <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
        </LanguageProvider>
      </body>
    </html>
  );
}
