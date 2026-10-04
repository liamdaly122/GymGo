/**
 * Supabase's sign-in errors, said as what to do next.
 *
 * Its own messages are written for developers — "Invalid login credentials"
 * says the sign-in failed and nothing about the likeliest reason, an account
 * that was never created. Each case here names the setting or the step, and
 * where it lives in the Supabase dashboard. Pure: the error's message, code
 * and status in, a sentence out.
 */
export interface SignInError {
  message: string;
  /** Supabase Auth's error_code, when the response carried one. */
  code?: string | undefined;
  /** HTTP status; 0 when the request never reached Supabase. */
  status?: number | undefined;
}

/** Statuses a paused or struggling project answers with. */
const UNAVAILABLE = new Set([502, 503, 504, 540]);

export function explainSignInError({ message, code, status }: SignInError): string {
  switch (code) {
    case 'invalid_credentials':
      return (
        'Wrong email or password. If the account does not exist yet, create it in Supabase: ' +
        'Authentication → Users → Add user, with Auto Confirm User ticked.'
      );
    case 'email_not_confirmed':
      return (
        'That account has not been confirmed. Confirm it from the SQL Editor in Supabase — ' +
        'the line is in the backup guide, supabase/README.md.'
      );
    case 'email_provider_disabled':
      return 'Email sign-in is switched off in Supabase: Authentication → Sign In / Providers → Email.';
    case 'user_banned':
      return 'Supabase has blocked this account: Authentication → Users, open it, and unban it.';
  }

  if (status === 429) {
    return 'Supabase is limiting sign-in attempts. Wait a few minutes and try again.';
  }

  if (status === 0 || (status === undefined && /fetch|network|load failed/i.test(message))) {
    return 'Could not reach Supabase. Check your signal and try again.';
  }

  if (status !== undefined && (UNAVAILABLE.has(status) || status >= 500)) {
    return (
      `Supabase is not answering properly (${message}). A free project pauses after a week ` +
      'unused: if it has, restore it from the Supabase dashboard, then try again.'
    );
  }

  return message;
}
