PORTALIS - Class notes, reviewers, quizzes, and funds (Supabase + GitHub Pages)

FEATURES
  - Login using student number only (format 00-00-000).
  - Signup with student number, full name, birthdate, and password.
  - Profile full name, contact details, about text, and avatar.
  - Notes with admin-controlled importance, including a pink Neutral color.
  - KaTeX math in reviewer text: use $...$ or \( ... \) inline and $$...$$ or
    \[ ... \] for displayed math.
  - Weekly class fund (₱10 per student), cumulative unpaid totals, and admin
    collection tracking. Admins can create other funds and add periods.
  - Anonymous confessions and a suggestion button; admins can see suggestion
    authors and manage submissions.
  - Reviewer quizzes, saved attempts, score summaries, and admin attempt graph.

SETUP
  1. Run setup.sql in Supabase -> SQL Editor.
  2. Run migration_features.sql in the same SQL Editor.
  3. Run migration_student_number_birthdays.sql after migration_features.sql.
     Do not rerun migration_features.sql after this migration; it restores
     legacy username fields. If setup.sql
     is reapplied later, rerun the remaining migrations in order afterward.
  4. For a standard Supabase Auth setup, run migration_optional_email.sql,
     then migration_supabase_auth_restore.sql. If migration_custom_auth.sql
     was already applied, run only migration_supabase_auth_restore.sql.
     The restore script reinstates signup/email triggers and creates profiles
     for Auth users that are missing them. It supports the existing
     portalis_auth_users table, but does not undo migration_custom_auth.sql
     or recover Auth users that were deleted.
     Signup uses a generated internal Auth email; Profile can request a change
     to the user's actual Supabase Auth email. Confirm the email change from
     the message sent to the new address.
  4a. Run migration_fix_profile_update.sql, then migration_profile_email_confirm.sql
     (safe to re-run). They let students save their profile, and make the profile
     email change only after the student confirms it from the email Supabase sends.
  4b. Run migration_fix_auth_deletes.sql (safe to re-run). It puts the foreign
     keys back on auth.users so deleting a user in Supabase frees their
     student number for signup, and removes the unused custom-auth tables.
  5. Set the Supabase Auth settings (Dashboard -> Authentication):
       - Sign In / Providers -> Email -> turn OFF "Confirm email".
         Students sign up with a hidden address (<student number>@login.portalis.invalid)
         that cannot receive mail, so with Confirm email ON nobody could sign in.
       - Sign In / Providers -> Email -> turn OFF "Secure email change".
         With it ON, Supabase also asks the hidden login address to confirm an
         email change and fails with: Email address "...@login.portalis.invalid" is
         invalid. With it OFF, only the new address has to confirm.
       - URL Configuration -> set Site URL to the GitHub Pages address and add
         <site>/profile.html to Redirect URLs, or the confirmation link in the email
         sends students to the wrong page.
       - For confirmation emails to reach real students, enable custom SMTP
         (Authentication -> Emails -> SMTP Settings, e.g. Brevo or Resend). The
         built-in mailer only sends to your Supabase team members, about 2 per hour.
       - If accounts were created while Confirm email was ON, confirm the hidden ones:
           update auth.users set email_confirmed_at = now()
           where email_confirmed_at is null and lower(email) like '%@login.portalis.invalid';
  6. Deploy the student-number login, email-change, and admin deletion
     functions:
       supabase functions deploy username-login --no-verify-jwt
       supabase functions deploy auth-email-update --no-verify-jwt
       supabase functions deploy admin-delete-user --no-verify-jwt
     The functions verify the Supabase Auth session themselves. Remove any
     previously deployed student-auth function. Do not run
     migration_custom_auth.sql for this Auth setup.
  7. Create an account, then make it admin in SQL (replace the student number):
       update public.profiles set role = 'admin' where student_number = '00-00-000';
  8. Upload the Portalis folder to GitHub Pages and configure config.js with the
     project's Supabase URL and anon key. Never put a service-role key there.

FAILED TO FETCH / CANNOT REACH THE SIGN-IN SERVICE
  Login calls the username-login Edge Function. Open diagnose.html on your
  live site; it checks the project, endpoint, and signed-in database access.
  Deploy missing functions from the repository root:
      supabase functions deploy username-login --no-verify-jwt
      supabase functions deploy auth-email-update --no-verify-jwt
  In the Dashboard, turn OFF "Verify JWT" for both functions so the browser's
  preflight and login requests reach their own session checks.
  - Paused or wrong project: check config.js SUPABASE_URL and that the project
    is not paused in the Supabase Dashboard.

EMAIL CHANGE FROM PROFILE
  A student enters an email on Profile and saves. Supabase emails a confirmation link
  to the NEW address; the email only changes after the link is clicked, then it stays.
  The student number remains the login before and after.
  - "Email address ...@login.portalis.invalid is invalid"  -> turn OFF Secure email change.
  - "Email address not authorized"  -> the built-in mailer only sends to team members;
    set up custom SMTP.
  - No email arrives -> check spam, SMTP settings, and the 2/hour built-in limit.
  - Link opens the wrong page -> fix Site URL and Redirect URLs (setup step 5).
  - After confirming a real email, signing in by student number uses the username-login
    Edge Function, so it must be deployed (and config.js needs the sb_publishable_ key).

EXISTING USERS
  Admins should use Admin -> Edit student # to assign a unique student number
  to each existing account that does not already have one. Student-number
  login resolves the account's current Supabase Auth email, so a confirmed
  email change does not alter the login identifier. Signed-in users can
  change their password from Profile. If migration_custom_auth.sql was
  already applied, migration_supabase_auth_restore.sql can restore signup
  profile creation while preserving its foreign keys. It cannot recover
  Auth accounts deleted by the custom-auth flow; affected users need an
  administrator-led account recovery.
  Birthdays are shown as a pinned greeting on the public Notes board for the
  current calendar day in Asia/Manila. Only names whose birthday is today are
  returned to the authenticated client; full birthdates are not exposed there.

FUND COLLECTIONS
  The migration creates Class Fund at ₱10 and backfills every weekly period
  from Week 1 (Aug 31–Sept 6, 2026) through the current week. Re-run
  migration_student_number_birthdays.sql to add newly elapsed weeks; existing periods are
  preserved. Admins can also add other funds and periods in Class funds.
  Unpaid amounts accumulate automatically across periods. Mark payments per
  student and period.

ADMIN RULES
  - Only admins can change note importance, approve/reject/delete notes,
    delete comments/confessions/suggestions/users, change roles, or manage funds.
    Deleting a user removes their Supabase Auth account and cascades to their
    Portalis data, freeing the student number for a new account.
  - Confessions show no author identity to other users.
  - Quiz answer keys remain server-side; grading is performed by Supabase.

BULK QUESTION FORMAT (blank line between questions)
  Q: What is the capital of the Philippines?
  A) Cebu
  B) Manila
  C) Davao
  Answer: B

  Q: Keyword used to declare an integer in Java?
  Answer: int