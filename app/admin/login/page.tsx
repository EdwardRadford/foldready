import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin — Fold Ready',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="wrap">
      <div className="admin-login">
        <h1>Admin</h1>
        <form method="post" action="/api/admin/login" noValidate>
          <div className="field">
            <input
              type="password"
              name="token"
              placeholder="Admin token"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <button className="btn" type="submit">
            Sign in
          </button>
          {error ? <p className="err">That token is not right.</p> : null}
        </form>
      </div>
    </div>
  );
}
