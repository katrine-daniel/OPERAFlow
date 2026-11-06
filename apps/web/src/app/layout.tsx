import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OPERAFlow', template: '%s · OPERAFlow' },
  description: 'Travel operations automation',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans text-[14px] leading-5">{children}</body>
    </html>
  );
}
