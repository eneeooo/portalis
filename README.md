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
After `Portalis\migration_profile_email_confirm.sql`, run
`Portalis\migration_profile_birthday_edit.sql` to let students edit their birthdays.
The restore script supports the `portalis_auth_users` table if the custom-auth
migration was applied; it does not undo that migration or recover deleted Auth
users.
Do not run `Portalis\migration_custom_auth.sql`. Deploy the
`username-login`, `auth-email-update`, and `admin-delete-user` Edge Functions
with `--no-verify-jwt`, then follow the existing-user instructions in
[`Portalis\README.txt`](Portalis/README.txt).
