# Chapters

Chapters are **seconds** on the record (`chapters: [{"start_s": 61.25, "title":
"The budget problem"}]`); CapForge formats `MM:SS` and `H:MM:SS` for the package
and the Publish workspace, and snaps each one back to the start of the word it
falls in. Times come from the transcript and are never invented.

## The five hard rules

YouTube ignores a chapter list that breaks any of these, so CapForge refuses the
write and `validate_video` names the rule:

1. the first chapter starts at `0`;
2. at least three chapters;
3. ascending;
4. at least 10 seconds apart;
5. all inside the video's duration.

## Candidates, in order of preference

1. **Speaker changes** — `find_video_moments(video_id, kind="speaker_change")`.
2. **Long pauses** — `kind="pause"`: a silence of at least a second, reported with
   the word that follows it and `gap`, how long the silence was. Longer gaps first.
3. **A topic shift you can name** from reading the transcript — time it with
   `query="<the first words of the new topic>"`.
4. **A number or a demo the speaker announces** — `kind="numbers"`.

Snap each chapter to the start of the segment where the topic begins, not to the
pause itself. Six good chapters beat twelve thin ones; do not pad to reach a count.

## Titles

At most 6 words, plain text, the topic named as the speaker would: "The budget
problem", not "Diving into budgets". The first chapter is usually "Intro" unless the
talk opens on its subject.

## The dry run

`check_chapters(video_id, chapters)` runs the five rules over a list **without
writing it**. Use it before every `set_video_meta` that carries chapters, and again
after the user edits one by hand. A clean dry run is the only time to write.

## Short videos

Under 30 seconds there is no room for three chapters 10 seconds apart: write no
chapters at all and say why. Under 60 seconds the video *is* a Short (see
`shorts`): one description paragraph, no chapter block.

## In the app

The Publish workspace lists the same chapters as clickable timestamps with a
"Suggest" that uses the same pauses and speaker changes, and "Insert at playhead".
Chapters the user placed by hand show `edited` next to the field; ask before
replacing them.
