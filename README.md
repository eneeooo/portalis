# Portalis

**Portalis** is a modern web project built with a focus on simplicity, accessibility, and functionality. Designed to provide a clean and responsive user experience, it combines an intuitive interface with database-powered capabilities to support dynamic features and future expansion.

Built using HTML, CSS, and JavaScript, Portalis uses **Supabase** as its backend infrastructure for database management and data storage. This integration provides a foundation for handling application data while keeping the project flexible, maintainable, and ready for further development.

## Features

- Student-number-only login (format `00-00-000`) for pre-created class roster
  accounts; initial password is `@Default`.
- Student, Officer, and Admin roles; Officers can moderate notes and suggestions
  and manage reviewers, but cannot access the Admin page.
- Admins can reset a student's password to `@Default`; existing passwords cannot
  be viewed or recovered.
- Admins and Officers can manage funds and delete mistaken custom funds; the
  standard Class Fund is protected from deletion.
- Fund exports are XLSX workbooks following the class roster columns, with
  Week 1 through the current week and advance payment shown separately.
- Confessions stay anonymous to students and Officers; only Admin-role accounts
  can view the author's name.
- Only Admin-role accounts can view or delete suggestions; Officers cannot access
  them.
- Class representatives see their assigned position as their profile title; access
  permissions continue to use their underlying account role.
- Admin and Officer names receive title cards on notes, comments, birthday wishes,
  and suggestions.
- Editable profiles, including birthdays, class notes, anonymous confessions,
  and admin/officer suggestions.
- KaTeX-rendered math in reviewer content and saved quiz attempts.
- Admin/officer-managed ₱10 weekly class fund, additional collections, and cumulative
  unpaid balances by student.
- Attendance tab following the BSIT-12 class attendance sheet (STUDENT NAME plus date
  columns). Admins and Officers add class dates and mark each student (✓ present,
  X absent, L late, E excused); everyone else can only view. The sheet can be
  printed or saved as PDF (8.5 x 13 in long bond) or XLSX, with the school logos
  optional (logo files are in `Portalis/logos/`; replace the PNGs to change them).
- Memories tab (several photos per memory, swipe or use arrows): anyone can post a photo with a title and comment on photos; every
  photo and comment waits for an Admin or Officer to approve it. Photos live in a
  private storage bucket and are visible to the class only after approval.
- View-profile cards (hover a name in notes/comments, or click it in Attendance or the online list): click any name in Attendance or the online list to see a
  classmate's picture, About me, title and birthday (month and day). Email and
  other contacts stay private.
- Fund balance button: a floating button appears bottom-right only while you still owe
  money; it disappears when you are paid up or paid in advance.
- Who's online: a floating button above the suggestion button shows a live list
  of classmates currently in Portalis, with optional join notifications.
- Responsive static frontend backed by Supabase Auth, Postgres, and Storage.
- School calendar: a live date and time widget in the top bar opens a month calendar. Admins and
  officers add events by pasting a simple format (Event / Date / Time / Place / Details), check it,
  attach an optional notice photo, and save. Upcoming events appear as cards on Notes. Files:
  `calendar.js`, `events.html`, `migration_school_events.sql`.
- Java compiler workspace: VS Code-style syntax colors, line numbers, red error
  lines with plain-English explanations and one-click quick fixes, an
  interactive terminal (type answers right in the output; each answer is color
  coded and linked to the code line that read it), any class name works without
  editing, snippets/autocomplete, .java export, and per-account cloud-saved
  projects. Runs on Judge0 Community Edition (Java 17). Judge0 cannot pause a
  program, so each typed answer re-runs the program with all answers so far
  (see `Portalis/java-tools.js`).

## Technologies Used

- HTML5
- CSS3
- JavaScript
- Supabase — Backend and database services
- GitHub Pages — Website hosting and deployment

## Project Vision

Portalis aims to grow into a reliable and functional web platform through continuous development, thoughtful design, and practical implementation. Its foundation combines frontend technologies with cloud-based database services to support future enhancements and a better overall user experience.

## Supabase setup

Run `sql/setup.sql`, `sql/migration_features.sql`,
`sql/migration_student_number_birthdays.sql`,
`sql/migration_birthday_wishes.sql`,
`sql/migration_birthday_wishes_privacy.sql`,
`sql/migration_birthday_public_message.sql`,
`sql/migration_staff_author_titles.sql`,
`sql/migration_confession_feelings_fund_admin.sql`,
`sql/migration_fund_advance_payments.sql`,
`sql/migration_officer_role.sql`,
`sql/migration_fund_delete_guard.sql`,
`sql/migration_fund_periods_and_advances.sql`,
`sql/migration_fund_current_weeks.sql`,
`sql/migration_admin_confession_authors.sql`,
`sql/migration_admin_only_suggestions.sql`,
`sql/migration_optional_email.sql`, and
`sql/migration_supabase_auth_restore.sql` in the Supabase SQL Editor.
Then run `sql/migration_fix_profile_update.sql`, `sql/migration_profile_email_confirm.sql`,
`sql/migration_fix_auth_deletes.sql`, `sql/migration_import_bsit12_credentials.sql`,
`sql/migration_admin_reset_password.sql`, and `sql/migration_force_password_change.sql` (students still on
`@Default` must choose a new password before using the site). Also set the minimum password length to 8 in
the Supabase Auth settings. The step-by-step order is explained in [`Portalis/README.txt`](Portalis/README.txt).
Run `sql/migration_attendance_presence.sql` to enable Attendance,
view-profile and the online list (it also sets the school-year roster order; edit
`SCHOOL`, `ACADEMIC_YEAR` and `CLASS_LABEL` at the top of the script in
`Portalis/attendance.html` for a new term).
Then run `sql/migration_profile_nickname_online.sql` (nicknames, Get to know me
notes, working online list). Then run `sql/migration_memories_and_updates.sql` (Memories tab, confession
full names for admins, nicknames in attendance). Then run `sql/migration_memories_multi_photos.sql` (several photos per memory).
Then run `sql/migration_school_events.sql` (school calendar: the date and time widget in the top bar, the Calendar page, event cards on Notes, and event notice pictures).
Then run `sql/migration_calendar_birthdays.sql` (shows classmates' birthdays on the calendar; month and day only).
Run `sql/migration_subject_groups.sql` to let admins and officers group reviewer subjects by year and
semester, reorder them, and choose which subjects students see (Admin -> Subjects, or Officer -> Reviewer subjects).
Run `sql/migration_java_projects.sql` to enable private, per-account
Java projects in the Java compiler tab.
Optionally run `sql/migration_seed_get_to_know.sql`
once to fill in the answers from the class "Get to know each other" document;
it only fills fields that are still empty.
After `sql/migration_profile_email_confirm.sql`, run
`sql/migration_profile_birthday_edit.sql` to let students edit their birthdays.
The restore script supports the `portalis_auth_users` table if the custom-auth
migration was applied; it does not undo that migration or recover deleted Auth
users.
Do not run `sql/migration_custom_auth.sql`. Deploy the
`username-login`, `auth-email-update`, and `admin-delete-user` Edge Functions
with `--no-verify-jwt`, then follow the existing-user instructions in
[`Portalis/README.txt`](Portalis/README.txt).