# Publishing a set of videos

A batch is you looping over records, one video per tool call, each step visible in
the app. No tool touches more than one record; that is what keeps a thirty-video
run recoverable.

## Find them

`list_videos(status="transcribed")` — status is derived at read time and climbs
`imported → transcribed → captioned → drafted → published`, so `transcribed` and
`captioned` are the ones without a description, `drafted` the ones waiting for an
upload URL. `list_videos(q=…)` and `search_library(q)` narrow by text;
`collection` by collection.

## The loop

For each video, in order:

1. `get_video(video_id)` — the record and its `rev`. If it already has a
   description or chapters the user did not ask you to replace, skip it and say so;
   a batch never overwrites authored work silently.
2. `get_brief` once; it does not change per video.
3. The workflow (`publish_guide("workflow")`): transcript, moments, breakdown,
   description, chapters, shorts, thumbnails — each written with `set_video_meta`
   against the rev you last read. A stale rev means someone edited the record
   between your read and your write: re-read, re-apply, write again, once.
4. `validate_video`. Fix hard findings before moving on; note style findings.
5. Read `get_upload_package` only if the user wants the text now; the package is
   rendered on demand and the record is what persists.

Do not call `mark_published` in a batch — the URL exists only after the user
uploads.

## Report

Finish with one table: video, chosen title, status after the run, findings still
open (or "clean"). Then the one thing the user has to do next for each: upload,
name a speaker, choose a title.

## Scratch runs

A record created with `scratch=true` (by `load_video` or `transcribe`) hides under
`.scratch/`, is read-only until promoted, and is pruned after a few days. Use it when
you are trying a workflow out and do not want the library polluted; never batch over
scratch records unless the user asked for them.

## Stopping

Stop on the first error you cannot recover from (a missing transcript, a record
that 404s) and report what was done and what was not. A partial batch with an
honest table beats a complete one with a guess in it.
