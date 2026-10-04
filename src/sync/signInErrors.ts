/**
 * Supabase's sign-in errors, said as what to do next.
 *
 * Its own messages are written for developers — "Error sending confirmation
 * email" says something failed and nothing about where to look. Each case
 * here names the setting that causes it and where it lives in the dashboard.
 * Pure: the error's message, code and status in, a sentence out.
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
    case 'email_address_not_authorized':
      return (
        "Supabase's built-in email only sends to members of your Supabase team. Use the email " +
        'you log in to Supabase with, or invite this one to the team.'
      );
    case 'over_email_send_rate_limit':
      return 'Supabase only sends a few emails an hour. Wait a few minutes and try again — a code you already have still works.';
    case 'email_provider_disabled':
      return 'Email sign-in is switched off in Supabase: Authentication → Sign In / Providers → Email.';
    case 'signup_disabled':
      return 'Supabase is set not to create new accounts: Authentication → Sign In / Providers → Allow new users to sign up.';
    case 'email_address_invalid':
      return 'Supabase will not send to that address. Check it for a typo.';
  }

  // "Error sending confirmation email", "… magic link email": the email server
  // refused. With custom SMTP switched on, that server is the user's own.
  if (/error sending .*email/i.test(message)) {
    return (
      'Supabase could not send the email. If you set up your own email server ' +
      '(Authentication → Emails → SMTP Settings), it refused — switch custom SMTP off to use ' +
      "Supabase's own. Supabase's Logs → Auth says exactly why."
    );
  }

  if (status === 429) {
    return 'Supabase is limiting sign-in requests. Wait a few minutes and try again — a code you already have still works.';
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
