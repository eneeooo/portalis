PORTALIS - Class notes, reviewers, quizzes, and funds (Supabase + GitHub Pages)

FEATURES
  - Login using student number only (format 00-00-000).
  - Sign in to the pre-created class 12 account with student number and the initial
    password `@Default`; change the password after first sign-in.
  - Profile full name, birthday, contact details, about text, and avatar.
  - Notes with admin- and officer-controlled importance, including a pink Neutral color.
  - KaTeX math in reviewer text: use $...$ or \( ... \) inline and $$...$$ or
    \[ ... \] for displayed math.
  - Weekly class fund (₱10 per student), cumulative unpaid totals, and admin/
    officer collection tracking. Admins and officers can create other funds,
    add periods, and delete mistaken custom funds.
  - Anonymous confessions and a suggestion button; only admins can see suggestion
    authors and manage submissions.
  - Public birthday sticky notes with an on-demand birthday melody, animated
    confetti, private received wishes, and birthday-student greetings visible to everyone.
  - Reviewer quizzes, saved attempts, score summaries, class rankings, and admin attempt graph.
  - Officer moderation page for reviewing pending notes, managing all notes, and deleting suggestions.
  - Admin-only student and officer password resets to @Default.
  - Class representatives have position titles displayed in place of their account-role badge.
  - Admin and Officer names display a title card on notes, comments, birthday wishes, and suggestions.

SETUP
  1. Run setup.sql in Supabase -> SQL Editor.
  2. Run migration_features.sql in the same SQL Editor.
  3. Run migration_student_number_birthdays.sql after migration_features.sql.
     Do not rerun migration_features.sql after this migration; it restores
     legacy username fields. If setup.sql
     is reapplied later, rerun the remaining migrations in order afterward.
  3a. Run migration_birthday_wishes.sql after
      migration_student_number_birthdays.sql to enable public birthday wishes.
  3b. Run migration_birthday_wishes_privacy.sql after
      migration_birthday_wishes.sql. It limits wish visibility to the student
      celebrating their birthday and prevents the celebrant from sending
      themselves a wish; they can share a public birthday message instead.
  3c. Run migration_birthday_public_message.sql after
      migration_birthday_wishes_privacy.sql. It lets the birthday student
      share a public greeting or thank-you while keeping received wishes private.
  3c1. Run migration_staff_author_titles.sql after
       migration_birthday_public_message.sql. It enables staff title cards on
       public author names while keeping profile roles private.
  3d. Run migration_confession_feelings_fund_admin.sql after
      migration_student_number_birthdays.sql. It adds confession feelings,
      restricts fund payment rosters to admins and officers, and seeds the ₱10 weekly
      Class Fund from Aug 31–Sept 6, 2026 through the current week.
  3e. Run migration_fund_advance_payments.sql after
      migration_confession_feelings_fund_admin.sql. It enables editable
      cumulative payments and automatic oldest-week-first allocation.
      Whole-fund XLSX export and print reports are available from Class funds.
  3f. Run migration_officer_role.sql after migration_fund_advance_payments.sql.
      It enables the Officer role, which has the same feature access as Admin
      except for the Admin page and suggestions. Officers use the Officer tab for
      the review queue and all notes. Deploy the updated admin-delete-user Edge Function
      for Officer user deletion.
  3f1. Run migration_fund_delete_guard.sql after migration_officer_role.sql.
       It ensures only Admins and Officers can manage funds and protects the
       standard Class Fund from deletion.
  3f2. Run migration_fund_periods_and_advances.sql after
       migration_fund_delete_guard.sql. It lets staff remove collection periods
       while preserving and reallocating collected payments.
  3f3. Run migration_fund_current_weeks.sql after
       migration_fund_periods_and_advances.sql. It removes advance-generated
       future weeks and keeps Class Fund at Week 1 through the current Manila
       week. Advance amounts remain recorded but do not create future dues.
  3f4. Run migration_admin_confession_authors.sql after
       migration_confession_feelings_fund_admin.sql. It allows only Admin-role
       accounts (not Officers) to see confession authors on the Confessions page.
  3f5. Run migration_admin_only_suggestions.sql after migration_features.sql.
       It restricts suggestion viewing and deletion to Admin-role accounts.
  3f6. Run migration_admin_only_note_edits.sql after migration_officer_role.sql.
       It restricts note edits to Admins and Officers.
  3g. Run migration_quiz_ranking.sql after setup.sql to enable quiz rankings.
  4. For a standard Supabase Auth setup, run migration_optional_email.sql,
     then migration_supabase_auth_restore.sql. If migration_custom_auth.sql
     was already applied, run only migration_supabase_auth_restore.sql.
     The restore script reinstates signup/email triggers and creates profiles
     for Auth users that are missing them. It supports the existing
     portalis_auth_users table, but does not undo migration_custom_auth.sql
     or recover Auth users that were deleted.
     Signup uses the student's email as the Auth email and saves their student
     number in profile metadata. Student-number login requires the deployed
     username-login function.
  4a. Run migration_fix_profile_update.sql, then migration_profile_email_confirm.sql
     (safe to re-run). They let students save their profile, and make the profile
     email change only after the student confirms it from the email Supabase sends.
  4a1. Run migration_profile_birthday_edit.sql after
      migration_profile_email_confirm.sql so students can update their birthday.
  4b. Run migration_fix_auth_deletes.sql (safe to re-run). It puts the foreign
     keys back on auth.users so deleting a user in Supabase frees their
     student number for signup, and removes the unused custom-auth tables.
  4c. Run migration_import_bsit12_credentials.sql in the Supabase SQL Editor.
     It loads the BSIT 12 roster, permits signup only for those student numbers,
     creates or refreshes their Auth accounts (including missing Auth users),
     and keeps existing profile IDs so notes and other related records are not
     removed. Each imported account starts with password @Default; students should
     change it after signing in. It also creates the email-provider identity
     required by Supabase Auth. Re-run this migration to restore a missing Auth
     account or provider identity for an existing profile.
  4d. Run migration_admin_reset_password.sql to enable the admin page's password
      reset action for students and officers. It resets Supabase Auth directly to
      @Default and clears any legacy password hash.
  5. Set the Supabase Auth settings (Dashboard -> Authentication):
       - Sign In / Providers -> Email -> choose whether to require email confirmation.
         If enabled, new signups must confirm the email address before signing in.
       - Sign In / Providers -> Email -> turn OFF "Secure email change" if students
         need to update addresses on accounts that still use generated internal emails.
         With it ON, Supabase also asks the hidden login address to confirm an email
         change and fails with: Email address "...@login.portalis.invalid" is invalid.
         With it OFF, only the new address has to confirm.
       - URL Configuration -> set Site URL to the GitHub Pages address and add
         <site>/profile.html to Redirect URLs, or the confirmation link in the email
         sends students to the wrong page.
       - For confirmation emails to reach real students, enable custom SMTP
         (Authentication -> Emails -> SMTP Settings, e.g. Brevo or Resend). The
         built-in mailer only sends to your Supabase team members, about 2 per hour.
       - For older accounts with an unconfirmed generated login address, confirm them:
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
     Admins can assign the Officer role from the Users and roles section and reset
     student or officer passwords to @Default. Passwords cannot be viewed or recovered;
     after a reset, tell the account holder to change the default password after signing in.
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
  Signup uses the student's actual email address. A student may later change it
  from Profile; Supabase confirms the change at the new address. Student-number
  login continues to work through the username-login Edge Function.
  - "Email address ...@login.portalis.invalid is invalid"  -> turn OFF Secure email change.
  - "Email address not authorized"  -> the built-in mailer only sends to team members;
    set up custom SMTP.
  - No email arrives -> check spam, SMTP settings, and the 2/hour built-in limit.
  - Link opens the wrong page -> fix Site URL and Redirect URLs (setup step 5).
  - After confirming a real email, signing in by student number uses the username-login
    Edge Function, so it must be deployed (and config.js needs the sb_publishable_ key).

EXISTING USERS
  To assign a student number to an existing account, update its student_number
  in public.profiles using the Supabase SQL Editor, ensuring it is unique.
  Student-number
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
  Classmates can leave wishes on the birthday card, and the birthday song plays
  when its button is pressed.

FUND COLLECTIONS
  Run migration_confession_feelings_fund_admin.sql to create Class Fund at ₱10
  and backfill every weekly period from Week 1 (Aug 31–Sept 6, 2026) through the
  current week. Re-run it to add newly elapsed weeks; existing periods are
  preserved and kept at ₱10. Admins and officers can also add other funds and periods in
  Class funds. Only admins and officers can view or update student payment records.
  Admins and officers can edit each student's total amount received; the app allocates it
  to the oldest unpaid weeks first, tracks partial payments and advance credit,
  and marks fully covered weeks paid automatically. Adding or removing a period
  recalculates payments. Class Fund includes Week 1 through the current Manila
  week only; advance amounts are reported separately and do not create future dues.
  Students see only periods where they still
  owe money; paid periods remain visible to admins and officers. Export whole fund
  as an XLSX workbook matching the class roster's first three columns, followed by
  Week 1 through the current week and an Advance Payment column. Print fund report for
  a complete student-by-week report. Users can see only
  their own outstanding balance and advance credit. Admins and officers can see total funds
  collected across all users and manage individual payment records. Students
  with an unpaid Class Fund balance also see a pinned reminder at the top of
  the public Notes board.

ADMIN RULES
  - Only admins and officers can change note importance, approve/reject/delete notes,
    delete comments/confessions/suggestions/users, change roles, or manage funds.
    Deleting a user removes their Supabase Auth account and cascades to their
    Portalis data, freeing the student number for a new account.
  - Confessions show no author identity to other users.
  - Quiz answer keys remain server-side; grading is performed by Supabase.

REVIEWER TEXT FORMAT
  Enter reviewer content in Manage reviewers. The text is formatted on the
  topic's Reviewer tab:
  - # Heading, ## Section, and ### Subsection create progressively smaller
    headings with clear spacing.
  - - bullet or * bullet creates a bulleted list. Use 1. item or 2. item for
    a numbered list.
  - Consecutive Term - definition or Term: definition lines become responsive
    definition cards. These can also be used to generate quiz questions.
  - Example: explanation or Example 2: explanation creates a highlighted
    example callout with an EXAMPLE label. Example - explanation is also
    labeled and highlighted as an example card. A heading written as
    # Example or ## Examples also gets an example indicator.
  - Use **important text** for bold emphasis and ==highlighted text== for a
    colored highlight.
  - Start a line with > to make a callout.
  - Inline math uses $x^2$ or \(x^2\). Display math uses $$\frac{a}{b}$$ or
    \[ \frac{a}{b} \]. Math is rendered with KaTeX.

  Example:
    # Fractions
    A fraction represents **part of a whole**.

    ## Key terms
    Numerator - The top number in a fraction.
    Denominator - The bottom number in a fraction.

    Example: In \(\frac{3}{4}\), 3 is the numerator and 4 is the denominator.
    - Fractions can represent equal parts.
    - The denominator cannot be zero.

BULK QUESTION FORMAT (blank line between questions)
  Q: What is the capital of the Philippines?
  A) Cebu
  B) Manila
  C) Davao
  Answer: B

  Q: Keyword used to declare an integer in Java?
  Answer: int

ATTENDANCE, VIEW PROFILE, NICKNAMES AND ONLINE LIST
---------------------------------------------------
1. Run migration_attendance_presence.sql once in the Supabase SQL Editor (safe to re-run).
2. Then run migration_profile_nickname_online.sql (nickname, favorite things, hobbies,
   fun facts, and the online list, which now works without any Realtime settings).
3. Optional: run migration_seed_get_to_know.sql once to fill in the class
   'Get to know each other' answers (only empty fields are filled).
4. Run migration_memories_and_updates.sql (Memories tab, admin-only confession full names,
   nicknames in attendance). Run it after step 2.
5. Run migration_memories_multi_photos.sql (several photos per memory). Run it after step 4.
If the online button shows a red '!', step 2 has not been run yet.
