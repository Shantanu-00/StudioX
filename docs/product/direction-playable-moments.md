# Direction: playable moments

> **Historical design note.** Written during the build (20–22 Oct 2026) and kept for the record.
> Statements such as "proposal", "nothing is deployed" or "not built yet" describe the state at the
> time. The current product and the deployed system are described in the [README](../../README.md),
> [ARCHITECTURE.md](../ARCHITECTURE.md) and [aws-builder.md](../aws-builder.md).

For the StudioX owner. 22 Oct 2026. This explains the proposed new direction in plain terms and
answers your four questions:

1. What exactly are the new things, in depth?
2. Is this podcast-only, scope creep, or general?
3. If we go broader, how do we keep a clean problem statement? (Your idea: the app visibly rejects
   videos it cannot make interactive.)
4. How is the new thing different from the old one?

Status words used below:

- **built** = exists today.
- **proposed** = decided on paper, not built yet.

Nothing in the "Play" layer is built yet.

---

## 1. The short answer

- **New thing:** "playable moments". When you pause, the AI turns what was just said into a small
  interactive tool you use with the remote. It reacts to your input and gives you a result. (proposed)
- **Not podcast-only:** the pipeline reads a timed speech transcript. It works on any spoken-word
  video. Our own crime clip is narration, not a podcast.
- **Not scope creep, if we name the category:** "spoken-word video". That is a clean problem
  statement. Podcasts stay the lead example.
- **Your rejection idea is right, and we make it real:** an eligibility gate at the start of the
  pipeline. A silent or music video takes a visible "Not a fit" branch. Inside a good video, the AI
  also says "no" to most moments and reports the count.
- **Different from the old layer:** the old layer shows information (like Amazon X-Ray). The new
  layer lets you do something and get your own result. The change is small: +1 agent, +1 check
  step, +2 TV components, +1 schema.

---

## 2. What is new, in depth

### 2.1 The two layers

| Layer | Name | What the viewer does | Example |
| --- | --- | --- | --- |
| Old (built, in progress) | **Know** | Reads cards beside the video | A fact-check stamp, a people list, a protocol |
| New (proposed) | **Play** | Operates a small tool with the remote | Move a bedtime and see your wake time; pick the evidence that breaks an alibi |

"Know" stays. "Play" is added on top. You can see both at once: the rail keeps showing cards, and a
pause on a playable moment opens a tool.

### 2.2 The idea behind it

Interactive TV is old: DVD extras, *Bandersnatch*, interactive specials. It stayed rare for one
reason. A person had to design and build every interaction, for every show, by hand.

StudioX's agents have already "watched" the whole video. They have the transcript, the entities and
the sources. So they can author the interaction automatically, at the moment you pause. One-line
pitch: **turn what you are watching into something you can explore.**

An interaction has five parts. The AI writes all five:

| Part | Meaning |
| --- | --- |
| Question | What the viewer is asked or can change |
| Controls | Which remote buttons do what |
| Rules | How input becomes a result |
| Feedback | What the screen says after each input |
| Success condition | What counts as "done" or "right" |

### 2.3 Engine 1: Planner ("Plan your night") — science clip

Source line (0:05–0:11): Dr. Julian says "Five ninety-minute cycles. Harvard clinical data shows
midday sleep cuts cardiovascular strain by 37 percent."

| Step | What the viewer sees | What the viewer presses | What they get |
| --- | --- | --- | --- |
| 1 | Pauses just after that line. A "Plan your night" panel opens beside the frozen video. | PAUSE | Panel title and one line: "Based on Dr. Julian's five 90-minute cycles" |
| 2 | A bedtime (for example 11:00 PM) and 5 cycles drawn as 90-minute waves | — | A starting plan |
| 3 | Bedtime moves in 15-minute steps. The waves redraw. | LEFT / RIGHT | A new bedtime |
| 4 | Cycle count changes between 4 and 6. More or fewer waves draw in. | UP / DOWN | A new cycle count |
| 5 | The wake-up time snaps to a cycle boundary (bedtime + cycles x 90 min) | — | Your wake time |
| 6 | The guest's 37% claim sits beside the plan, with its NUANCED stamp (from the fact check) | — | Context, not a promise |
| 7 | "Send to phone" button | SELECT | A calendar reminder on the phone, built from your plan |

Footer line on the panel: "Applies the guest's rule. Not medical advice."

The point: the viewer does not read about cycles. They get *their* wake time.

### 2.4 Engine 2: Deduction ("Break the alibi") — crime clip

Source lines: 0:00–0:08 (the alibi), 0:08–0:20 (the ping), pause at 0:20 (the cameras).

| Step | What the viewer sees | What the viewer presses | What they get |
| --- | --- | --- | --- |
| 1 | Pauses at 0:20. A "Break the alibi" panel opens. | PAUSE | Question: "Which one breaks his alibi?" |
| 2 | Three evidence cards, each from the episode: (A) sworn diner alibi 9:30–11:00 PM, (B) phone ping at Tower 4, Pier 9 at 10:14 PM, (C) harbor cameras severed | LEFT / RIGHT to move focus | Focus moves between cards |
| 3 | The viewer picks one | SELECT | An answer is checked |
| 4a | Right answer (B): the 10:14 ping animates into the 9:30–11:00 window. It lands inside it. | — | "Verdict: he was at the pier while he swore he was at the diner." |
| 4b | Wrong answer (A or C): the card shakes and a one-line reason shows | — | For example: "The cameras were cut after 10:20. That does not place him at the pier by itself." |

The point: the viewer reasons like a detective instead of reading a timeline.

Careful with the facts here: every card and every verdict comes from what the narrator said. The AI
adds no outside claim.

### 2.5 Honest scope of the demo

| Item | Truth |
| --- | --- |
| Engines | Two (Planner, Deduction) |
| Clips | Two (one per engine) |
| Claim we make | "Designed to generalise" |
| Claim we do not make | "Works on any video" |

---

## 3. Old vs new

| Aspect | Old layer: Know (cards) | New layer: Play (playable moment) |
| --- | --- | --- |
| Viewer's role | Reads | Acts: decides, adjusts |
| Content | Static text | State that responds to input |
| AI's job | Annotates what was said | Authors an interaction (question, controls, rules, feedback, success condition) |
| Verification | Text is grounded in sources | The rule or logic itself is proved in code |
| UI | A card | An instrument. The D-pad is a control, not only navigation. |
| Outcome | Information | A personal result (your wake time) or your verdict |
| Phone | Receives a card | Receives your result (a reminder built from your plan) |
| Competitive frame | X-Ray-like. This exists. | AI-authored interactivity for any video. We have not seen this in streaming apps today (our observation, not a proven fact). |
| Architecture delta | — | +1 agent, +1 Step Functions step, +2 catalog components, +1 schema |

### The same moment, both ways

Take the science clip at "five ninety-minute cycles".

| | Know | Play |
| --- | --- | --- |
| Screen | A card: "R90 = five 90-minute sleep cycles. Claim: 37% less strain. Stamp: NUANCED." | A planner: your bedtime, your cycles, your wake time, with the same stamp beside it |
| After 10 seconds the viewer has | Read a definition | Chosen a bedtime and sent a reminder to the phone |

Know answers "what did he say?" Play answers "what does that mean for me?" (science) or "does that
story hold up?" (crime).

### Why the owner's critique lands

You said the current design is X-Ray / NBA-style stat overlays applied to podcasts: information
beside video. That is accurate for Know. Better agents underneath do not make that visibly new. Play
changes what the viewer *does*, so it is visible in a 20-second demo.

---

## 4. What changes in the architecture (and what does not)

All of this is **proposed**.

| Part | Change? | Detail |
| --- | --- | --- |
| Upload, Transcribe, Segment, Map, Verify, Publish | No change | Same pipeline as in `docs/ARCHITECTURE.md` |
| Rail, pause behaviour, phone app, pairing, API | No change | Same |
| Existing lenses and cards | No change | Know stays |
| **Experience Author** | **New agent** | Per moment, decides: playable or not? If yes, picks the engine and fills it from the transcript, with timestamps as evidence. |
| **Verification step** | **New Step Functions state** | Runs the Experience Author's output through AgentCore Code Interpreter before it ships |
| **Planner** component | **New TV component** | Native Vega, drawn from data. Animated on the UI thread with Reanimated. |
| **Deduction** component | **New TV component** | Same approach |
| **"experience" schema** | **New data shape** | Engine, parameters with evidence, controls, question, outcomes, feedback |

### "The model proposes, code proves"

The AI can be wrong about arithmetic and logic. So code checks it before the viewer sees it:

| Engine | What the code checks |
| --- | --- |
| Planner | Cycle sums and wake times (for example 11:00 PM + 5 x 90 min = 6:30 AM) |
| Deduction | 10:14 PM is inside 9:30–11:00 PM. The other two choices do not contradict the alibi. |

If the check fails, the experience is dropped. The moment falls back to a normal Know card.

### The TV still renders data, never code

This rule from `docs/ARCHITECTURE.md` does not change. The agents send data (an "experience"
description). The TV has a fixed catalog of native components. Planner and Deduction are two new
entries in that catalog. No AI-written code ever runs on the TV.

---

## 5. Is it podcast-only?

### 5.1 What the pipeline actually needs

One input: a **timestamped speech transcript**. That is all the agents read. It does not matter
whether the video is a podcast.

Proof from our own demo:

| Clip | Format | Podcast? |
| --- | --- | --- |
| The Human Blueprint, Ep. 42 | Two-person interview | Yes (video podcast style) |
| Shadow Files, Case 104 | Narrator plus B-roll | No. It is narration. |

Both run through the same pipeline.

### 5.2 The honest category: spoken-word video

| In scope (speech carries the content) | Out of scope (deliberately) |
| --- | --- |
| Podcasts and video podcasts | Film, where the story is told visually |
| Interviews | Sports action without commentary |
| Explainers and lectures | Music videos |
| True crime | Silent footage and B-roll only |
| Documentaries with narration | |

Reason for the right-hand column: the system has no vision pipeline. It does not look at frames. It
listens. We say so on purpose.

### 5.3 So is this scope creep?

No, if we name the category honestly. "Spoken-word video" is not broader than what we built. It is
what we built, described correctly. Calling it "podcasts only" would actually under-describe the
crime clip.

### 5.4 Proposed problem statement

> Spoken-word video on TV — podcasts, interviews, explainers, true crime — is dense with claims,
> names and advice. The TV gives you no way to question it or use it without pausing and reaching
> for your phone.

- Podcasts stay the lead example.
- Any statistic about video podcasts on TVs must be **found and cited by the team before use**. We
  will not invent numbers.

### 5.5 Are the engines generic?

They are generic *patterns*. We claim only what we demo.

| Engine | Pattern | Possible other uses (not demoed, not promised) |
| --- | --- | --- |
| Planner | A rule with parameters leads to a computed consequence | Compounding in a finance talk; sets and reps in a fitness video; scaling a recipe |
| Deduction | Claims vs evidence: which one contradicts? | Debates; interviews; news segments |

Wording to use: "designed to generalise". Wording to avoid: "works for all videos".

---

## 6. The rejection gate

You said the app should visibly reject videos it cannot make interactive. We agree. It also fixes
the problem-statement worry in section 5: the product says out loud what it is for.

There are two levels. (proposed)

### 6.1 Level 1: the video-level gate

A Step Functions **Choice state** right after Transcribe. It measures:

| Measure | Meaning |
| --- | --- |
| Words per minute | How much is being said |
| Speech share | What percent of the video has speech |
| Checkable/playable moments found | How many claims or interactive candidates the agents find |

If the numbers are below a threshold, the run takes a separate **"Not a fit"** branch. It does not
run the expensive agents. It stops, and the phone thread shows a message like:

> Not a fit: 6% of this video is speech. StudioX works on spoken videos.

(The 6% is an illustration, not a measured value. Thresholds are to be tuned on real clips.)

### 6.2 Level 2: the moment-level "no"

Inside an accepted video, most moments are **not** playable. "He said hello" is not a planner. The
Experience Author says no most of the time. We report the funnel:

| Stage | Example reading (illustrative) |
| --- | --- |
| Moments found | M |
| Became cards (Know) | some |
| Became playable (Play) | N of M |

Show it as a plain line: "N of M moments became playable."

"Silence is a feature": winning agent entries in an AWS Strands hackathon stood out for showing what
they declined and why. Declining is evidence the AI is judging, not just generating.

### 6.3 How it looks in the demo

| Shot | What the camera sees |
| --- | --- |
| 1 | Upload a silent stock clip (for example from Pexels) from the phone |
| 2 | Step Functions graph: Transcribe lights up, the Choice state fires, the **Not a fit** branch lights |
| 3 | Phone thread: the "Not a fit" message with the reason and numbers |
| 4 | Upload the interview. Same graph, now the main branch lights all the way through. |
| 5 | On the TV: pause shows the Planner. A line reads "N of M moments playable". |

Rejection and acceptance side by side prove the product has a boundary.

---

## 7. What we cut, and why

To make room for Play in the time left, these are dropped from the plan:

| Cut | Why |
| --- | --- |
| Breathing figure | Neither demo clip mentions breathing. It would be a feature with no scene to show it. |
| Day clock | Planner replaces its job in the science clip |
| Generic charts | Not tied to either clip; Planner and Deduction are |
| Relation graph | Deduction covers the "how things connect" story in the clip |
| Timeline view | The Deduction evidence cards carry the 9:30 / 10:14 / 10:20 story |
| Lens Lab | Already optional in `docs/ARCHITECTURE.md`; stays last |

What stays: the pipeline, the rail, the phone link, the fact check, people, "what did he just say",
protocol and timeline cards (as Know). The cut list is only about new work and unshown extras.

---

## 8. Risks and honesty

| Risk | How we handle it |
| --- | --- |
| Two engines, two clips | We say exactly that. No claim of "any video" |
| Health content (planner) | Panel shows "applies the guest's rule; not medical advice" |
| Crime content (deduction) | Verdicts come only from the episode's own statements |
| AI maths or logic errors | Code Interpreter checks before shipping; failure falls back to a card |
| Everything above | **Proposed.** Nothing in Play is built yet. |

---

## 9. Open questions for the owner

1. **Category name.** Do you accept "spoken-word video" as the product's honest scope, with
   podcasts as the lead example?
2. **Gate wording.** Should the "Not a fit" message appear on the phone only, or also on the TV?
3. **Demo order.** Lead with the rejection (silent clip fails) or finish on it? We suggest lead with
   the Planner, then show the rejection as proof of judgement.
4. **Cut list.** Are you fine dropping the breathing figure and the generic charts, given neither
   clip uses them?
