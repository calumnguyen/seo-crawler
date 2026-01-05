import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Login - SEO Web Crawler',
  description: 'Sign in to access the SEO Web Crawler Dashboard',
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}


