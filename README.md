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

## Technologies Used

- HTML5
- CSS3
- JavaScript
- Supabase — Backend and database services
- GitHub Pages — Website hosting and deployment

## Project Vision

Portalis aims to grow into a reliable and functional web platform through continuous development, thoughtful design, and practical implementation. Its foundation combines frontend technologies with cloud-based database services to support future enhancements and a better overall user experience.

## Supabase setup

Run `Portalis\setup.sql`, `Portalis\migration_features.sql`,
`Portalis\migration_student_number_birthdays.sql`,
`Portalis\migration_birthday_wishes.sql`,
`Portalis\migration_birthday_wishes_privacy.sql`,
`Portalis\migration_birthday_public_message.sql`,
`Portalis\migration_staff_author_titles.sql`,
`Portalis\migration_confession_feelings_fund_admin.sql`,
`Portalis\migration_fund_advance_payments.sql`,
`Portalis\migration_officer_role.sql`,
`Portalis\migration_fund_delete_guard.sql`,
`Portalis\migration_fund_periods_and_advances.sql`,
`Portalis\migration_fund_current_weeks.sql`,
`Portalis\migration_admin_confession_authors.sql`,
`Portalis\migration_admin_only_suggestions.sql`,
`Portalis\migration_optional_email.sql`, and
`Portalis\migration_supabase_auth_restore.sql` in the Supabase SQL Editor.
Run `Portalis\migration_attendance_presence.sql` to enable Attendance,
view-profile and the online list (it also sets the school-year roster order; edit
`SCHOOL`, `ACADEMIC_YEAR` and `CLASS_LABEL` at the top of the script in
`Portalis\attendance.html` for a new term).
Then run `Portalis\migration_profile_nickname_online.sql` (nicknames, Get to know me
notes, working online list). Then run `Portalis\migration_memories_and_updates.sql` (Memories tab, confession
full names for admins, nicknames in attendance). Then run `Portalis\migration_memories_multi_photos.sql` (several photos per memory).
Optionally run `Portalis\migration_seed_get_to_know.sql`
once to fill in the answers from the class "Get to know each other" document;
it only fills fields that are still empty.
After `Portalis\migration_profile_email_confirm.sql`, run
`Portalis\migration_profile_birthday_edit.sql` to let students edit their birthdays.
The restore script supports the `portalis_auth_users` table if the custom-auth
migration was applied; it does not undo that migration or recover deleted Auth
users.
Do not run `Portalis\migration_custom_auth.sql`. Deploy the
`username-login`, `auth-email-update`, and `admin-delete-user` Edge Functions
with `--no-verify-jwt`, then follow the existing-user instructions in
[`Portalis\README.txt`](Portalis/README.txt).
