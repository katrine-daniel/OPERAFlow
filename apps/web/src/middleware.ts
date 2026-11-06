import { NextResponse, type NextRequest } from 'next/server';

// UX-only redirect for visitors with no session cookie. Real authentication and
// authorisation are enforced by the API on every request.
export function middleware(req: NextRequest) {
  if (!req.cookies.get('of_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = req.nextUrl.pathname === '/' ? '' : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico).*)'],
};
