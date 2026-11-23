/* Portalis personality (MBTI): types, quiz questions, scoring, avatars, result card.
   Load after common.js (it uses el()) and put mbti.css next to it. */
(function () {
  const GROUPS = {
    analyst:  { label: "Analyst",  body: "#c9b6f2", bg: "#efe8ff" },
    diplomat: { label: "Diplomat", body: "#b9f0b0", bg: "#e6fae1" },
    sentinel: { label: "Sentinel", body: "#9fd8f5", bg: "#e0f3fd" },
    explorer: { label: "Explorer", body: "#ffe36e", bg: "#fff7c9" }
  };

  /* Each axis score is the percent toward the FIRST letter. Above 50 gives the first letter,
     50 or below gives the second. migration_personality.sql checks the same rule. */
  const AXES = [
    { key: "EI", first: "Extraverted", second: "Introverted" },
    { key: "SN", first: "Observant",   second: "Intuitive" },
    { key: "TF", first: "Thinking",    second: "Feeling" },
    { key: "JP", first: "Judging",     second: "Prospecting" }
  ];

  const TYPES = {
    INTJ: { name: "Architect",    group: "analyst",  tagline: "Strategic thinkers with a plan for everything.",
            about: "You see the big picture and work backward to make it real. You like clear goals, high standards, and doing things properly, even when it means working alone.",
            traits: ["Strategic", "Independent", "Determined"] },
    INTP: { name: "Logician",     group: "analyst",  tagline: "Curious inventors with a thirst for understanding.",
            about: "You love taking ideas apart to see how they work. You would rather find the elegant answer than the quick one.",
            traits: ["Analytical", "Original", "Curious"] },
    ENTJ: { name: "Commander",    group: "analyst",  tagline: "Bold leaders who find a way or make one.",
            about: "You take charge naturally and turn goals into plans people can follow. You push yourself and your team to aim higher.",
            traits: ["Decisive", "Driven", "Confident"] },
    ENTP: { name: "Debater",      group: "analyst",  tagline: "Quick-witted thinkers who love a good argument.",
            about: "You enjoy testing ideas from every angle, often just to see where they lead. New problems energize you, routines do not.",
            traits: ["Inventive", "Witty", "Adaptable"] },
    INFJ: { name: "Advocate",     group: "diplomat", tagline: "Quiet idealists with a deep sense of purpose.",
            about: "You notice what people feel and care about making things better for them. You think deeply and act on what you believe in.",
            traits: ["Insightful", "Principled", "Caring"] },
    INFP: { name: "Mediator",     group: "diplomat", tagline: "Gentle dreamers guided by their values.",
            about: "You live by a strong inner sense of what matters and look for the good in people. You are creative, thoughtful, and happiest when you can be yourself.",
            traits: ["Empathetic", "Creative", "Idealistic"] },
    ENFJ: { name: "Protagonist",  group: "diplomat", tagline: "Warm leaders who bring out the best in others.",
            about: "You read a room easily and love helping people grow. You rally others around a shared goal and make everyone feel included.",
            traits: ["Charismatic", "Supportive", "Organized"] },
    ENFP: { name: "Campaigner",   group: "diplomat", tagline: "Enthusiastic free spirits who see possibilities everywhere.",
            about: "You bring energy, ideas, and warmth to everything. You connect with people easily and hate feeling boxed in.",
            traits: ["Spontaneous", "Friendly", "Imaginative"] },
    ISTJ: { name: "Logistician",  group: "sentinel", tagline: "Dependable planners who get things done right.",
            about: "You value facts, order, and keeping your word. People count on you because you follow through.",
            traits: ["Reliable", "Thorough", "Practical"] },
    ISFJ: { name: "Defender",     group: "sentinel", tagline: "Caring protectors who quietly look after everyone.",
            about: "You remember the little things that matter to people and work hard to keep them safe and comfortable. You are loyal, patient, and steady.",
            traits: ["Loyal", "Considerate", "Patient"] },
    ESTJ: { name: "Executive",    group: "sentinel", tagline: "Organized doers who keep everything on track.",
            about: "You like clear rules, honest effort, and results you can measure. You step up to manage people and make things run smoothly.",
            traits: ["Organized", "Direct", "Responsible"] },
    ESFJ: { name: "Consul",       group: "sentinel", tagline: "Friendly hosts who make everyone feel welcome.",
            about: "You enjoy looking after people and keeping the group close. You notice who needs help and you show up.",
            traits: ["Sociable", "Caring", "Dependable"] },
    ISTP: { name: "Virtuoso",     group: "explorer", tagline: "Cool-headed tinkerers who learn by doing.",
            about: "You stay calm under pressure and love figuring out how things work with your own hands. You prefer action over long discussions.",
            traits: ["Hands-on", "Calm", "Resourceful"] },
    ISFP: { name: "Adventurer",   group: "explorer", tagline: "Gentle artists who live in the moment.",
            about: "You express yourself through what you make and how you live. You like freedom, beauty, and trying new things at your own pace.",
            traits: ["Artistic", "Easygoing", "Curious"] },
    ESTP: { name: "Entrepreneur", group: "explorer", tagline: "Bold risk-takers who thrive on action.",
            about: "You think fast, read people well, and dive right in. You would rather try it than talk about it.",
            traits: ["Energetic", "Perceptive", "Bold"] },
    ESFP: { name: "Entertainer",  group: "explorer", tagline: "Spontaneous performers who make life a party.",
            about: "You love being around people and turning ordinary moments into fun. You live in the now and bring others along.",
            traits: ["Fun-loving", "Generous", "Spontaneous"] }
  };

  /* ---------- quiz questions ----------
     k = +1: agreeing points to the first letter of the axis (E, S, T, J).
     k = -1: agreeing points to the second letter (I, N, F, P).
     10 per axis, half pointing each way, interleaved so the axes alternate. */
  const BY_AXIS = {
    EI: [
      [ 1, "You enjoy starting conversations with people you have just met."],
      [-1, "You feel drained after spending a whole day with a big group."],
      [ 1, "You usually speak up first in group discussions."],
      [-1, "You need quiet time alone to recharge."],
      [ 1, "Being the center of attention feels natural to you."],
      [-1, "You prefer a few close friends over a wide circle."],
      [ 1, "You tend to think out loud instead of working things out in your head first."],
      [-1, "You often get lost in your own thoughts when you are around other people."],
      [ 1, "A free weekend with no plans sounds boring more than relaxing."],
      [-1, "You think carefully before you say something, even in casual chats."]
    ],
    SN: [
      [ 1, "You trust facts and proven methods more than hunches."],
      [-1, "You often get lost thinking about \"what if\" possibilities."],
      [ 1, "You prefer step-by-step instructions to figuring things out your own way."],
      [-1, "You enjoy abstract ideas and theories for their own sake."],
      [ 1, "You notice small details other people miss, like a new haircut or a wrong font."],
      [-1, "You get bored when a conversation stays on practical, everyday things."],
      [ 1, "You prefer doing things the way they have always worked."],
      [-1, "You often see patterns and connections between unrelated things."],
      [ 1, "You describe things literally and precisely instead of through metaphors."],
      [-1, "You would rather imagine where something could go than focus on how it is now."]
    ],
    TF: [
      [ 1, "In an argument, being right matters more to you than keeping the peace."],
      [-1, "You are easily affected by other people's moods."],
      [ 1, "You make decisions with logic first and feelings second."],
      [-1, "You would feel guilty giving honest feedback that might hurt someone."],
      [ 1, "You think fairness means treating everyone by the same rules."],
      [-1, "You would bend the rules for someone who truly needs help."],
      [ 1, "You can stay calm and analytical when others are emotional."],
      [-1, "Harmony in the group matters more to you than the most efficient result."],
      [ 1, "You find it easy to criticize an idea without taking it personally."],
      [-1, "You often decide based on how it will make people feel."]
    ],
    JP: [
      [ 1, "You like having a plan and sticking to it."],
      [-1, "You keep your options open as long as possible."],
      [ 1, "A cluttered desk or messy room bothers you."],
      [-1, "You do your best work right before a deadline."],
      [ 1, "You finish tasks well ahead of the due date."],
      [-1, "You prefer to decide as you go instead of scheduling things."],
      [ 1, "A to-do list or calendar makes you feel in control."],
      [-1, "Sudden changes of plan feel exciting rather than annoying."],
      [ 1, "You feel uneasy when a decision is left undecided."],
      [-1, "You start many things and do not always finish them."]
    ]
  };
  const QUESTIONS = [];
  for (let i = 0; i < 10; i++) {
    AXES.forEach(axis => {
      const [k, text] = BY_AXIS[axis.key][i];
      QUESTIONS.push({ axis: axis.key, k, text });
    });
  }

  /* answers: one number 1..7 per question (1 = strongly disagree, 7 = strongly agree).
     Returns { type: "INFP", scores: { EI, SN, TF, JP } } with percents toward E, S, T, J. */
  function scoreAnswers(answers) {
    if (!Array.isArray(answers) || answers.length !== QUESTIONS.length) {
      throw new Error("Answer all " + QUESTIONS.length + " questions.");
    }
    const sums = { EI: 0, SN: 0, TF: 0, JP: 0 };
    const counts = { EI: 0, SN: 0, TF: 0, JP: 0 };
    QUESTIONS.forEach((q, i) => {
      const v = answers[i];
      if (!Number.isInteger(v) || v < 1 || v > 7) throw new Error("Question " + (i + 1) + " is not answered.");
      sums[q.axis] += (v - 4) * q.k;
      counts[q.axis] += 1;
    });
    const scores = {};
    let type = "";
    AXES.forEach(axis => {
      const max = 3 * counts[axis.key];
      const pct = Math.round((sums[axis.key] + max) / (2 * max) * 100);
      scores[axis.key] = pct;
      type += pct > 50 ? axis.key[0] : axis.key[1];
    });
    return { type, scores };
  }

  /* ---------- DOM helpers ---------- */
  /* Avatars: avatars/<TYPE>.svg (one per type, e.g. avatars/INTJ.svg).
     size: "sm" | "md" | "lg" | "xl" (see mbti.css) */
  function avatarNode(type, size) {
    const info = TYPES[type];
    if (!info) throw new Error("Unknown personality type: " + type);
    const box = el("span", "mbti-avatar " + (size || "md"));
    const img = el("img");
    img.src = "avatars/" + type + ".svg";
    img.alt = type + " " + info.name;
    img.loading = "lazy";
    box.appendChild(img);
    return box;
  }

  function chipNode(type) {
    const info = TYPES[type];
    if (!info) throw new Error("Unknown personality type: " + type);
    const chip = el("span", "mbti-chip", type + " \u00b7 " + info.name);
    chip.style.background = GROUPS[info.group].body;
    return chip;
  }

  /* row = { mbti, scores }. opts.compact = smaller header, no long description.
     opts.noAvatar = leave the avatar out (the caller already shows it). */
  function personalityNode(row, opts) {
    opts = opts || {};
    const info = TYPES[row.mbti];
    if (!info) throw new Error("Unknown personality type: " + row.mbti);
    const group = GROUPS[info.group];
    const block = el("div", "mbti-block" + (opts.compact ? " compact" : ""));

    const head = el("div", "mbti-head");
    if (!opts.noAvatar) head.appendChild(avatarNode(row.mbti, opts.compact ? "md" : "lg"));
    const who = el("div", "mbti-who");
    who.appendChild(el("div", "mbti-code", row.mbti));
    const role = el("div", "mbti-role", info.name + " \u00b7 " + group.label);
    role.style.background = group.body;
    who.appendChild(role);
    who.appendChild(el("p", "mbti-tagline", info.tagline));
    head.appendChild(who);
    block.appendChild(head);

    if (!opts.compact) {
      block.appendChild(el("p", "mbti-about", info.about));
      const traits = el("div", "mbti-traits");
      info.traits.forEach(trait => traits.appendChild(el("span", "mbti-trait", trait)));
      block.appendChild(traits);
    }

    const bars = el("div", "mbti-bars");
    AXES.forEach(axis => {
      const pct = row.scores[axis.key];
      const isFirst = pct > 50;
      const dominant = isFirst ? pct : 100 - pct;
      const line = el("div", "mbti-bar");
      line.appendChild(el("span", "mbti-bar-label", (isFirst ? axis.first : axis.second) + " " + dominant + "%"));
      const track = el("span", "mbti-track");
      const fillBar = el("span", "mbti-fill");
      fillBar.style.width = dominant + "%";
      fillBar.style.backgroundColor = group.body;
      track.appendChild(fillBar);
      line.appendChild(track);
      bars.appendChild(line);
    });
    block.appendChild(bars);
    return block;
  }

  window.Mbti = { TYPES, GROUPS, AXES, QUESTIONS, scoreAnswers, avatarNode, chipNode, personalityNode };
})();