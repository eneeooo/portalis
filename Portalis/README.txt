PORTALIS - Sticky notes + reviewers + quizzes (Supabase + GitHub Pages)

FILES
  index.html      Login
  signup.html     Sign up
  dashboard.html  Notes: public board + My notes (title, bullets/numbered, subnotes, importance colors, comments)
  admin.html      Admin: review queue (approve/reject), all notes, user roles
  reviewer.html   Subjects and topics (everyone)
  topic.html      Reviewer text + quiz with saved drafts, retry, and tries count (everyone)
  manage.html     Admin only: open topics, type/bulk/auto-generate questions, see student results
  common.js       Shared code (menu bar, note cards, bulk parser, question generator)
  config.js       Supabase URL + anon key
  style.css       Theme
  setup.sql       Database setup. Safe for NEW or EXISTING projects, safe to re-run.

SETUP
  1. Supabase -> SQL Editor -> paste all of setup.sql -> Run.
  2. Make yourself admin (change the email):
       update public.profiles set role = 'admin' where email = 'your@email.com';
  3. Upload all files to your GitHub repo and wait 1-2 minutes.

RULES
  - Only admins can delete (notes, comments, topics, questions).
  - New notes from users stay private until an admin approves them.
  - Admin notes are posted right away.
  - Anyone logged in can comment on approved notes.
  - Only admins can create topics and questions. Everyone can read reviewers and take quizzes.
  - Quiz answer keys are stored where students cannot read them. Grading happens on the server.

IMPORTANCE COLORS
  Green = Low, Yellow = Medium, Orange = High, Red = Urgent

BULK QUESTION FORMAT (blank line between questions)
  Q: What is the capital of the Philippines?
  A) Cebu
  B) Manila
  C) Davao
  Answer: B

  Q: Keyword used to declare an integer in Java?
  Answer: int

AUTO-GENERATE
  Write reviewer lines like "Algorithm - a step-by-step procedure" or "Loop: repeats code".
  Manage reviewers -> Auto-generate builds questions from them (rule-based, not AI).

NEVER put the service_role / secret key in config.js.
