# Portalis

**Portalis** is a modern web project built with a focus on simplicity, accessibility, and functionality. Designed to provide a clean and responsive user experience, it combines an intuitive interface with database-powered capabilities to support dynamic features and future expansion.

Built using HTML, CSS, and JavaScript, Portalis uses **Supabase** as its backend infrastructure for database management and data storage. This integration provides a foundation for handling application data while keeping the project flexible, maintainable, and ready for further development.

## Features

- Student-number-only login (format `00-00-000`); signup collects full name
  and birthdate.
- Student, Officer, and Admin roles; Officers have the same access as Admins.
- Editable profiles, class notes, anonymous confessions, and admin/officer suggestions.
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
`Portalis\migration_confession_feelings_fund_admin.sql`,
`Portalis\migration_fund_advance_payments.sql`,
`Portalis\migration_officer_role.sql`,
`Portalis\migration_optional_email.sql`, and
`Portalis\migration_supabase_auth_restore.sql` in the Supabase SQL Editor.
The restore script supports the `portalis_auth_users` table if the custom-auth
migration was applied; it does not undo that migration or recover deleted Auth
users.
Do not run `Portalis\migration_custom_auth.sql`. Deploy the
`username-login`, `auth-email-update`, and `admin-delete-user` Edge Functions
with `--no-verify-jwt`, then follow the existing-user instructions in
[`Portalis\README.txt`](Portalis/README.txt).
