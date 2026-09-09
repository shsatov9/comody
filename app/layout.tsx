import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'comody',
  description: 'チラシの特売品から献立を決めて、食べたものを記録する',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
