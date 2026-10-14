# Backlog: notes from the gym, not yet done

Things the owner has asked for or noticed that nobody has fixed yet. When one
is done, it leaves this file and its rule goes into `CLAUDE.md`, as the earlier
gym notes did. The three gaps found while planning the iPhone app are listed
in `docs/native-roadmap.md` under "Found while reading".

## 10 October 2026

### 1. The previous-performance line does not recognise a lift already logged

**Seen:** the text under an exercise during a workout does not say what was
done last time, for exercises that have been logged before.

**Found on 10 October:** the suggestion engine only ever falls back to an
estimate when the exercise has no finished history under its exact ID, so a
lift that "should" be recognised is a different exercise in the library: a
variant, or one a swap or a block rotation put in its place. The side-lateral
note (fixed the same day) made that look much worse, by naming an unrelated
lift. The estimate now says "First time on <exercise>", so the next time it
happens the exercise is named. Still to do: confirm with the owner which
lifts, and decide whether history should carry across a lift family (a
Dumbbell Side Lateral Raise counting a Side Lateral Raise's history), which
is a change to the counting rules and needs the owner's say.

**Where to look:** `src/domain/previousPerformance.ts` (the best working set
from the last time the exercise was performed) and whatever the set in hand
renders under the name. Check how the history is looked up: by exercise id
only? A swap or a block rotation repoints a routine row at a different
exercise id, so history under the old id would not be found. Check also that
it reads finished workouts only and whether the current session is excluded
on purpose, and whether the home-screen app's data differs from the browser
suites' (the suites may only ever see a first session).

**Done when:** a lift logged in a finished session shows its last best working
set under its name the next time it comes up, and a browser suite proves it
across two sessions.

### 3. Is progressive overload actually suggested, and intelligently?

**Asked:** when a lift has been logged before, suggest the next weight from
progressive overload. Within a session, if the reps drop at a weight, suggest
a lower weight for the next set.

**What exists:** `src/domain/progression.ts` reasons across sessions: it moves
the top set against the rep range, withholds a jump or deloads after two
failed sessions, and never adds load on effort alone. Within a session the
placeholder is the set just done (carry-forward), which does not react to a
drop in reps. Whether the across-session part is reaching the screen is what
notes 1 and 2 will show.

**To design:** an in-session rule: when the reps on a set fall below the
range at the carried weight, the next set's placeholder steps down through
the gym's plates (`nextLoadableBelow`), with the reason saying so. Lowering is
the safe direction, so it fits the rule that effort may withhold or lower but
never add load. It belongs in `src/domain/` next to `latestWorkingSet`, with
tests, and the set in hand's plan line should name it.

### 4. How much do the exercises change, block to block?

**Asked:** do exercises shuffle by block or by plan? The owner wants variety
so it stays fun; some lifts can carry over.

**What exists:** within a block the same exercises run every week on purpose,
so the progression engine has something to compare. At the end of a block
`rotateAccessories` (`src/domain/programmes/rotation.ts`) keeps the main
lifts and rotates each accessory to another version of the same lift, keeping
last block's accessories out where the gym allows. Choosing a different split
is "Build a new plan". So the answer today: main lifts stay for good,
accessories change each block, and nothing changes within a block.

**To decide with the owner:** whether that is enough variety. Options, in
order of size: rotate more of the accessories, or a wider family, each block;
let a main lift's variant rotate too (incline for flat bench) while the
movement stays; or a per-week rotation for accessories only, which would need
the progression engine to compare across the variant family rather than the
exercise id.

## 14 October 2026: smart coaching, saved for later

Liam liked these from the build 6 brainstorm but does not want them yet. Each
is written up, with how it would be built, under "Coach brain" in
`docs/feature-ideas.md`. The step-down when reps fall short (note 3 above) is
**not** here: it goes into build 7.

- Readiness (Rough / OK / Good) on the watch before Start, with last night's
  sleep, HRV and resting heart rate shown as evidence, never chosen for him.
- Carry history across close variants of a lift, for suggestions only
  (note 1 above; Liam decides).
- Effort on the wrist (Easy / Solid / Max) feeding `sets.rir`.
- Spot a lift stalled for three sessions and name a way out.
- This week's sets per muscle against the goal's target.
- Bring the deload forward when the block is wearing him down.
- An honest "about N min", from the rests actually taken.
- Short on time: trim today's session to 30, 45 or 60 minutes before Start.

## 14 October 2026: left over from the build 7 review

Confirmed by the review, and deliberately left for later because each needs a
bigger change than its effect is worth now:

- **The same lift twice in one session shares one rep range.** The workout
  view takes a lift's range from its first routine row, so an exercise added
  twice by hand (a generated plan never repeats one) is judged by the same
  range in both places, on the phone and the watch alike. The fix pairs the
  k-th workout entry with the k-th routine row in `composeWorkoutRows`
  (`src/db/queries.ts`), with no migration.
- **For 5 seconds after a set on the wrist, the companion is one set behind.**
  The watch holds each set's event for its Undo window but reports the next
  set at once, so the companion works that set's numbers out without the set
  just done. It catches up when the event lands. The fix adds the held set to
  the state report (`held: { setId, weight, reps, at } | null`) and lays it
  over the companion's view.
