# Localized

The root fields of a record are the video's **source language** (the record's
`language`). `localized` holds the same viewer-facing text in other languages, one
object per language code, so the user can paste a Polish or German upload package
into YouTube Studio's translations.

The root `localized` is the **primary channel's** post. Another YouTube channel's post
keeps its own under `posts.<channel id>.localized`, with the same shape and the same
per-language merge. Only YouTube posts have `localized`; on a TikTok, Instagram,
LinkedIn or X post it is refused with `field_not_on_platform`.

## The shape

```
localized: {
  "pl": {
    "title": "…",
    "description": "…",
    "short_description": "…",
    "tags": ["…"],
    "hashtags": ["…"],
    "chapter_titles": ["Wstęp", "Potok", "Koniec"],
    "shorts_caption": "…"
  },
  "de": { … }
}
```

Every field is optional. A field left empty falls back to the source text in the
package, and the package's NOTES say which ones did.

## Which languages

- `get_video` returns `languages`: the source language first, then the language of
  every caption track saved with the video, then every language that already has
  localized fields. A track language with no fields yet is one the user has started
  translating captions for.
- When the video is open in the app, `get_ui_state` lists its tracks with their
  `lang`, and `get_track` reads a translated track's captions — useful wording to
  stay consistent with, never a replacement for translating the fields.
- Translate the languages the user asks for. Do not invent languages nobody asked
  for, and never write the source language under `localized` — the write is refused
  with `localized_is_source`. A key must be a code like `pl`, `de` or `pt-BR`, or it
  is refused with `localized_lang_code`.

## Translating

- Translate **from the record's source fields** (`get_video`), never from the upload
  package text: the package is a rendering with the brief's boilerplate in it.
- Keep the meaning, the numbers, the names and the claims. The brief's voice and
  house rules apply to a localized title and description too.
- YouTube's limits hold per language: title at most 100 characters, description at
  most 5000 **bytes** (accented letters take two), tags line at most 500 characters,
  no angle brackets. A translation is usually longer than its source.
- `chapter_titles` is aligned **by index** with the root `chapters`: one title per
  chapter, in the same order. An empty string keeps that chapter's source title.
  Chapter times are never translated; they stay on the root chapters in seconds.
  More titles than chapters is a style finding (`localized_chapter_count`) and the
  extras are ignored.

## Writing — one language per call

`set_video_meta(video_id, {"localized": {"pl": {…}}}, rev)` — one language per call,
with the `rev` you last read. `localized` merges per language:

- a language you **omit** is kept exactly as stored, so writing `pl` never erases
  `de`, and the user may be editing another language at the same time;
- a language sent as an **object replaces** that language's fields wholesale — send
  every field of that language you want kept, not just the one you changed;
- a language sent as **null** is removed: `{"localized": {"pl": null}}`.

A refused write names the field as `localized.pl.title`, `localized.pl.description`
and so on, with the same rule names the root fields use. Fix it and write again.

For another YouTube channel's post, nest the same object in that post:
`set_video_meta(video_id, {"posts": {"second-yt": {"localized": {"pl": {…}}}}}, rev)`.
The merge is the same, and a refused write names `posts.second-yt.localized.pl.<field>`.

## Validating and packaging

1. `validate_video(video_id, lang="pl")` checks the Polish package view. Findings on
   translated text name `localized.pl.<field>`; a finding on a field still in the
   source language keeps its root name, because the fix belongs there.
2. `get_upload_package(video_id, lang="pl")` renders the package in that language:
   the translated fields replace the source ones, title options and the highlights
   block are left out (they have no translation), and NOTES lists
   `Not translated (source text used): …` — including the brief's footer, which has
   no per-language version — and `Omitted (source language only): …`. Show the text
   as it is, and tell the user what is still in the source language.

Without `lang` both tools work on the source language exactly as before. Add
`channel="second-yt"` to either one for that channel's post instead of the primary's.
