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
