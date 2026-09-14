# The breakdown

The breakdown is the first pass over a transcript and the one the other topics draw
on: the summary, the timed highlights and quotes, the tools the speaker named, and
who was speaking. It is written from `get_video_transcript(video_id)` (or
`get_transcript(segments_only=True)` for the open video) and timed with
`find_video_moments`.

## `summary_md`

Markdown, for reuse outside YouTube (a conference site, notes, a newsletter). The
shape that has worked:

1. **Thesis** — one paragraph: what the talk claims, in the speaker's terms.
2. **Topics in order** — a short list of what is covered, in the order it is said,
   each with a rough time; not every segment, only the turns.
3. **Key quotes** — 3–5 verbatim lines, each with its time (the same lines go into
   `quotes`).
4. **Tools and links mentioned** — only what the speaker named.
5. **Opening hook** and **closing message** — one line each, quoted or closely
   paraphrased.

Nothing in it comes from outside the transcript. If the speaker did not say it, the
summary does not say it.

## `highlights` — 4 to 6 timed lines

The "what you'll learn" lines of the description. Each stands on its own, states a
concrete takeaway (a number, a decision, a technique), and carries `start_s` and
`end_s` of the passage it comes from. Time them with
`find_video_moments(video_id, query="<a phrase from the line>")`; never estimate.
Order them as the talk does.

## `quotes` — verbatim, timed

The exact words, punctuation tidied, nothing added. Ask for word-level timing
(`get_video_transcript(video_id, segments_only=False)`) only when a quote's span
must be exact; a segment's `start`/`end` is usually enough.

## `tools_mentioned`

Names only, spelled as the speaker said them, deduplicated. Not the category
("a load balancer"), the product ("HAProxy") — and only when it is actually named.

## `speakers`

Diarization yields `SPEAKER_00`, `SPEAKER_01`; the record's `speakers` map is keyed
by those ids. Fill `name`, `handle`, `url` when the transcript or the brief gives
them. When nobody is named, do not stop to ask: leave the entry out, say it is open,
and move on — CapForge prints `[SPEAKER NAME]` in the package and lists it under the
open placeholders. When the user supplies the name later, write it and re-read the
package.

## Write it

One `set_video_meta` call with `summary_md`, `highlights`, `quotes`,
`tools_mentioned` and `speakers`, against the `rev` you read. Then
`validate_video`. The breakdown has no hard rules of its own; it is checked for
the brief's house rules (an em dash, for instance, if the brief forbids them).
