import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "mockinterview.live — A clearer next interview",
  description:
    "Practice interviews for your role, review evidence-based feedback, and contribute new formats to an open-source platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        {/* Apply saved theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.setAttribute('data-theme',localStorage.getItem('mi_theme')||'light')}catch(e){}`,
          }}
        />
      </head>
      <body>
        <LanguageProvider>
          <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
        </LanguageProvider>
      </body>
    </html>
  );
}
