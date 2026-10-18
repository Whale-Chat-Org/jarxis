import { NextResponse } from 'next/server';

import { HttpError } from '@/lib/errors';
import { grants, identify } from '@/lib/rbac';

/** Choose the default destination from the live session and database grants. */
export async function GET(request: Request) {
  let destination: string;

  try {
    const identity = await identify(request.headers);
    const access = await grants(identity.userId);
    destination = access.permissions.has('dashboard:read') ? '/admin' : '/';
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 401)) throw error;
    destination = '/auth/sign-in';
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
