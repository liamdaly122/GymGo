import { describe, expect, it } from 'vitest';
import { explainSignInError } from './signInErrors';

/**
 * The owner's first sign-in failed with Supabase's "Error sending
 * confirmation email" and nothing else to go on: the cause was a custom SMTP
 * server, and the fix a switch in the dashboard. Each answer here has to name
 * the setting, not restate the failure.
 */
describe('explaining a sign-in that failed', () => {
  it('points a refused email at the SMTP settings and the logs', () => {
    for (const message of ['Error sending confirmation email', 'Error sending magic link email']) {
      const text = explainSignInError({ message, code: 'unexpected_failure', status: 500 });
      expect(text).toMatch(/SMTP Settings/);
      expect(text).toMatch(/Logs → Auth/);
    }
  });

  it('says who the built-in email will send to', () => {
    const text = explainSignInError({
      message: 'Email address "a@b.c" cannot be used as it is not authorized',
      code: 'email_address_not_authorized',
      status: 400,
    });
    expect(text).toMatch(/Supabase team/);
    expect(text).toMatch(/log in to Supabase with/);
  });

  it('says to wait when the hourly limit is hit, and that a code in hand still works', () => {
    for (const error of [
      { message: 'email rate limit exceeded', code: 'over_email_send_rate_limit', status: 429 },
      { message: 'Too many requests', status: 429 },
    ]) {
      const text = explainSignInError(error);
      expect(text).toMatch(/Wait a few minutes/);
      expect(text).toMatch(/code you already have still works/);
    }
  });

  it('names the switch when email sign-in or new accounts are turned off', () => {
    expect(explainSignInError({ message: 'Email logins are disabled', code: 'email_provider_disabled', status: 400 })).toMatch(
      /Sign In \/ Providers → Email/,
    );
    expect(explainSignInError({ message: 'Signups not allowed for otp', code: 'signup_disabled', status: 422 })).toMatch(
      /Allow new users to sign up/,
    );
  });

  it('asks for a second look at an address Supabase will not take', () => {
    expect(
      explainSignInError({ message: 'Email address "x" is invalid', code: 'email_address_invalid', status: 400 }),
    ).toMatch(/typo/);
  });

  it('tells no signal apart from a server problem', () => {
    expect(explainSignInError({ message: 'Failed to fetch', status: 0 })).toMatch(/Check your signal/);
    expect(explainSignInError({ message: 'Load failed' })).toMatch(/Check your signal/);

    const paused = explainSignInError({ message: 'Service Unavailable', status: 503 });
    expect(paused).toMatch(/pauses after a week/);
    expect(paused).toMatch(/Service Unavailable/);
  });

  it("passes anything it does not recognise through in Supabase's words", () => {
    expect(explainSignInError({ message: 'Something new', code: 'brand_new_code', status: 400 })).toBe('Something new');
  });
});
