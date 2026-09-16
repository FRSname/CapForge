---
name: capforge-cleanup
description: "Clean up the transcript of the video open in CapForge without moving a single caption: remove filler words, fix the names, products and jargon WhisperX misheard, mend split or merged tokens and wrong homophones, and leave every word's timing where the audio put it. Use when the user asks to clean, polish, proofread or fix the transcript or captions, to remove ums and uhs, or to correct how a name or product is spelled."
---

# CapForge transcript cleanup

CapForge is a finishing tool: the video was cut elsewhere, and the captions stay
locked to its audio. This skill fixes what the transcription got **wrong** and
nothing else. The words on screen become correct; where they appear in time does not
change. A cleanup that reads like an edit of what the speaker said has gone too far.

Three kinds of fix, and only these:

- **Fillers** — um, uh, er and their spellings. Removed, their time absorbed by the
  neighbouring word, so no gap opens in the captions.
- **Misheard words** — a name, a product, a technical term, a homophone
  (their/there), a number written out wrong, a token split in two ("chat GPT") or two
  run together.
- **Casing and spelling** of the words that are there.

Not a fix: rewording, tightening, grammar that is how the person talks, dropping a
repeated word the speaker actually said twice for effect. Captions are verbatim.

## Requirements

CapForge must be running **with its window open and the video on the results
screen**, because the transcript is edited in the live session. Tools, all from the
`capforge` MCP server:

- `get_ui_state()` to see what is open, `open_video(video_id)` to open a library video.
- `get_transcript(segments_only=True)` to read, `get_transcript()` for word indices.
- `remove_filler_words(extra_fillers=…)` and `update_words(edits)` to write.
- `find_moments(query)` to find every place a word is said.
- `get_video`, `get_channel`, `get_collection` for the names the video is about.

If the window is closed or nothing is transcribed, say so and stop: a library record's
transcript is read-only, and this skill has no other way to write.

## 1. Make the video the open session

`get_ui_state()`. Its `screen` must be `results`.

- Already showing the right video: carry on.
- The user named a video that is in the library: `open_video(video_id)` (find the id
  with `list_videos()` or `search_library(q)`). It restores that video's saved session
  and returns once it is the active one. Refused when the record has never been saved
  from the app; then the user has to open it by hand.
- `progress` means it is still transcribing: poll `get_status()` and wait.

Cleanup edits the **source** track, whatever tab the user has in front. A translated
track is not touched, but every translated caption whose source words you change is
marked "source changed" on its tab, so tell the user when the video has other
language tracks (`get_ui_state().tracks`) and suggest the capforge-translate skill for
the repair afterwards.

## 2. Build the glossary before reading

Names are what WhisperX gets wrong most, and a wrong name is the one error every
viewer notices. Before you read the transcript, collect the spellings that are known:

- `get_video(...)`: the `title`, `speakers` (names by diarized id), tools_mentioned,
  `keywords`, `links`. If it has a collection_id, `get_collection(collection_id)`
  adds the event's slots (its name, the sponsor).
- `list_channels()` then `get_channel(channel_id)` for the primary channel: its
  `context.keywords`, and `context.notes`, which often lists product names and
  how the channel spells them.
- Anything the user pastes: a speaker list, a slide title, a repo name.

Everything else you correct a name *to* must come from the user. **Never invent a
spelling.** A proper noun you cannot resolve goes on the questions list at the end,
with its timestamp, not into the transcript as your best guess.

## 3. Fillers first

`remove_filler_words()` removes the unambiguous disfluencies (um, uh, er, ah, hmm and
their spellings) with their time absorbed by a neighbour. Run it before anything else,
because it changes word indices and you want to read once afterwards.

Words that can carry meaning — "like", "you know", "so", "right", "okay" — are not
removed by default. Pass them as `extra_fillers=["like", "you know"]` **only when the
user asks for that**, and say that it drops every instance, including the ones that
were words ("I like this").

## 4. Read, then propose

`get_transcript(segments_only=True)`: one line per sentence, cheap on a long video.
Read it against the glossary and list the fixes you would make, grouped:

- names and products (the glossary spelling, or a question);
- split or merged tokens;
- homophones and misheard words the sentence makes obvious;
- numbers and units written strangely ("twenty twenty six" is fine; "2 026" is not);
- casing (a brand's casing, a sentence-initial word after a filler was removed).

Show the list to the user with the segment index and the timestamp of each, and get a
yes before writing. For a long list, a "fix all of these" on the obvious ones plus the
questions on the rest is a fine answer. On a short transcript you may write the
obvious fixes and report them, if the user asked you to just clean it up.

`find_moments(query="kubernetes")` finds every time a word is said, which is how a
misspelling that recurs gets fixed everywhere rather than where you happened to read
it. word_id there is a locator; the write still needs segment and word indices from
`get_transcript()`. A word's `score` (WhisperX's confidence, when present) is a hint
about where to look, not a reason to change a word that reads right.

## 5. Write with indices, one read per call

`get_transcript()` (the full form) for the word indices, then `update_words(edits)`:

- replace: `{"segment": 12, "word": 3, "new": "Kubernetes"}`;
- delete: `{"segment": 12, "word": 4, "op": "delete"}` — the time is absorbed by the
  previous surviving word (or the next one when it was first);
- merge "chat GPT" into one token: replace the first with `"ChatGPT"` and delete the
  second, **in the same call**, so the merged word spans both;
- splitting one token into two is not an op here. The app's Text view does it
  properly (a word inserted there is timed inside the old word's span), so ask the
  user to make that one edit in the app; if they would rather you did it, replace the
  token with the two words joined by a space and say the pair shares one timing.

Every index in one call refers to the word list **as you read it** — a delete in the
same call never shifts the index of a later edit. After a call that deleted anything,
read again before the next call; an index from the old read is wrong by then. A single
out-of-range index fails the whole call and writes nothing.

Batch by segment, as many edits per call as you like. Punctuation lives inside the
token ("Kubernetes," is one word), so keep the punctuation the old token carried.

## 6. What must not happen

- **No timing moves.** Nothing here re-times a word, and no tool of this skill may be
  used to shift a caption. Realignment is a manual button in the app and is never
  triggered from a cleanup.
- **No rewriting.** A sentence that is ungrammatical because that is how it was said
  stays that way. Do not remove repeated words, false starts or "so" at the start of a
  sentence unless the user asked for that pass explicitly.
- **No translated-track writes.** `set_track_text` is not a cleanup tool.
- **No guesses at names.** Ask.

## 7. Report and hand back

Say what changed in one short table: fillers removed (the count), names fixed (old →
new, how many places), other fixes; then the questions you could not settle, each
with a timestamp so the user can listen. Nothing else needs saving: the app autosaves
the session into the video's library record.

If the user confirmed spellings that were not in the channel's context, offer to add
them to `context.keywords` with `set_channel(channel_id, context={"keywords": […]})`
so the next cleanup knows them. That list is replaced whole, so read the channel first
and send the old keywords with the new ones. Write it only when the user says yes.
