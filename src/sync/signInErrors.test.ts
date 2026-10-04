import { describe, expect, it } from 'vitest';
import { explainSignInError } from './signInErrors';

/**
 * Supabase's own messages say a sign-in failed and nothing about where to
 * look: the owner's first attempt showed only "Error sending confirmation
 * email". Each answer here has to name the step or the setting.
 */
describe('explaining a sign-in that failed', () => {
  /**
   * Supabase gives one answer for a wrong password and an account nobody has
   * made, and on a first sign-in the second is likelier.
   */
  it('says how to make the account when the credentials are refused', () => {
    const text = explainSignInError({ message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 });
    expect(text).toMatch(/Wrong email or password/);
    expect(text).toMatch(/Authentication → Users → Add user/);
    expect(text).toMatch(/Auto Confirm User/);
  });

  it('points an unconfirmed account at the guide rather than at deleting it', () => {
    // Deleting the account would take its backup with it: rows cascade.
    const text = explainSignInError({ message: 'Email not confirmed', code: 'email_not_confirmed', status: 400 });
    expect(text).toMatch(/SQL Editor/);
    expect(text).toMatch(/supabase\/README\.md/);
    expect(text).not.toMatch(/delete/i);
  });

  it('names the switch when email sign-in is turned off, or the account is blocked', () => {
    expect(explainSignInError({ message: 'Email logins are disabled', code: 'email_provider_disabled', status: 400 })).toMatch(
      /Sign In \/ Providers → Email/,
    );
    expect(explainSignInError({ message: 'User is banned', code: 'user_banned', status: 400 })).toMatch(/unban/);
  });

  it('says to wait when Supabase is limiting attempts', () => {
    expect(explainSignInError({ message: 'Request rate limit reached', code: 'over_request_rate_limit', status: 429 })).toMatch(
      /Wait a few minutes/,
    );
  });

  it('tells no signal apart from a paused or failing project', () => {
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
