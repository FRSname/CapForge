# Collections — an event's shared boilerplate

A conference is forty videos that share most of their description: the recorded-at
line, the sponsor footer, the feedback link, the hashtags. A **collection** states
that once. A video joins by its record's `collection_id`. The collection holds
**slots** (named values such as the event name or the sponsor) and **overrides**
(channel brief fields restated for this event). Nothing is copied onto the videos:
each member's package is rendered at read time from its own record plus the
collection, so a changed sponsor line reaches all forty on the next read.

## The effective brief

`get_collection(collection_id)` answers with the collection, its member count and
its `effective_brief`: the channel brief with the collection applied. For a member
video that *is* the brief. Read it once per collection instead of `get_brief`, and
follow it the same way.

- **Overrides replace.** An override is the new value of that brief field, whole.
  Lists and blocks replace too: `default_hashtags`, `link_rows` and `house_rules`
  set on a collection are the event's own, not additions to the channel's.
- **`null` inherits.** An override set to `null` hands that field back to the
  channel. Fields you leave out of a write keep what the collection had.
- **Slots merge key-wise.** The collection's slots are laid over the channel's slots
  name by name: an event adds variables, it does not restate the channel's.
- **The slots you send are the collection's whole slot set.** Read
  `get_collection` first and send back every slot you want to keep.

## Set up an event

Ask the user for the facts. Do not invent a sponsor, a city or a URL.

1. `list_collections`: check the event does not exist yet, and whether videos
   already carry its id as an orphan (below).
2. Create it with its slots:
   `set_collection("uck26", name="UCK 2026", slots={"event": "UCK 2026", "city": "Brno", "sponsor": "Acme", "feedback_url": "https://uck.example/feedback"})`.
   An id is lowercase letters, digits and hyphens. A slot name is lowercase
   letters, digits and underscores, starts with a letter, and may not reuse a
   built-in slot's name.
3. Write the boilerplate once, as overrides:
   `set_collection("uck26", overrides={"footer": "Thanks to {{sponsor}}. Tell us what you thought: {{feedback_url}}", "recorded_at_line": "Recorded at {{event}}, {{city}}", "default_hashtags": ["#UCK2026", "#Kubernetes"]})`.
   Override `description_template` only when the event needs a different layout
   (below).
4. Assign the videos, **one per call**: `get_video(video_id)` for the rev, then
   `set_video_meta(video_id, {"collection_id": "uck26"}, rev)`. An id that names no
   collection is refused with an `unknown_collection` violation, so create the
   collection first.
5. Read one member's `get_upload_package` and show the user its DESCRIPTION before
   assigning the rest.

## Folders inside folders

Collections nest like folders: an event can hold a folder per day, a series a
folder per season. `list_collections` stays a flat list; each row's `parent_id`
names the folder it sits in (`null` is the top level), `path` spells out where it
is (`["Events", "UCK 2026", "Day 1"]`, the words to use with the user), and
`total_members` counts its videos plus every subfolder's.

A video still belongs to exactly one collection, and **inherits from every folder
above it**, top level first:

- **Slots merge down the chain.** A day's `{{day}}` is added to the event's
  `{{event}}` and `{{sponsor}}`; a slot set lower down beats the same name higher up.
- **Each override is the deepest one set.** A day that overrides `footer` uses its
  own; a day that leaves `footer` `null` uses the event's, and an event that leaves
  it `null` too uses the channel's. Lists and blocks still replace whole.
- `get_collection` on the inner folder answers the `effective_brief` of the whole
  chain, so read that one for its members.

Create a folder inside another with
`set_collection("uck26-day-1", name="Day 1", parent_id="uck26")`. Move one (with
all its subfolders) by passing a different `parent_id`; `parent_id=""` moves it to
the top level, and leaving `parent_id` out keeps it where it is. Moving a folder
changes its members' packages the same way editing it does, with no video write,
so say so before you move one. A folder cannot go inside itself or one of its own
subfolders, and folders nest at most 8 levels deep. `delete_collection` is refused
while a folder holds videos, and then while it holds subfolders.

## Template slots

`description_template` lays out the DESCRIPTION block with `{{slot}}` placeholders.
It lives on the channel brief and a collection can override it. Empty means
CapForge's default layout. The built-in slots:

| slot | renders |
|---|---|
| `{{description}}` | the record's own description |
| `{{title}}` | the record's title |
| `{{short_description}}` | the record's short description |
| `{{recorded_at}}` | the recorded-at line, its slots expanded |
| `{{highlights}}` | the WHAT YOU'LL LEARN block, from the record's highlights |
| `{{chapters}}` | the CHAPTERS block |
| `{{links}}` | the LINKS block |
| `{{speakers}}` | the speaker blocks |
| `{{footer}}` | the footer, its slots expanded |
| `{{hashtags}}` | the hashtag line |
| `{{channel}}` | the channel's name |
| `{{collection}}` | the collection's name, empty for a video in none |

Every other `{{name}}` is a custom slot from the channel's slots merged with the
collection's. An example layout for an event:

```
{{description}}

{{recorded_at}}

{{highlights}}

{{chapters}}

{{speakers}}

Feedback: {{feedback_url}}

{{footer}}

{{hashtags}}
```

- Slots also expand inside the footer and `recorded_at_line`. Expansion is one pass:
  a slot's value is never expanded again.
- A slot that renders empty takes its line with it: blank lines collapse to one.
- **An unknown slot is never shipped silently.** It stays in the text verbatim, is
  listed under NOTES, and `get_upload_package` reports a hard `unknown_slot`
  violation on `package.description`. It is a brief or collection problem, not a
  record problem: fix the typo or add the slot with `set_collection`, and never
  edit the video to hide it. It does not block `set_video_meta`.
- **The 5000-byte limit is on the assembled description.** The package checks the
  whole DESCRIPTION block, footer included, so a long event footer can push one
  video over even when its own description is short. Shorten the footer for
  everyone, or that one video's paragraph.

## Write only this video's paragraph

A member's `description` holds what is specific to that video: the claim, what is
shown. **Never paste boilerplate the template renders** into it: the recorded-at
line, the sponsor footer, the feedback link, the hashtags, the links, the speaker
block. Pasted copies print twice and cannot follow the collection when it changes.

## When the event changes

A sponsor swap or a new feedback URL is one `set_collection` write. Then re-read
`get_upload_package` for each member you want to show the user. That re-read is
the whole regeneration: no video is written, and no tool writes more than one
video.

## Adopt an orphan id

`list_collections` lists `orphans`: ids videos already carry (from an older import
or a typo) that no collection defines. Their packages render with the channel brief
alone. To adopt one, create a collection with **that exact id**:
`set_collection("<orphan id>", name="…")`. The videos become members with no
per-video write. If the id is a typo, ask the user, then move each video to the
right collection with `set_video_meta`, one per call.

## Take a video out, delete a collection

`set_video_meta(video_id, {"collection_id": null}, rev)` takes one video out.
`delete_collection(collection_id)` is refused while the collection has members, and
the refusal says how many. Emptying an event is the user's decision and one visible
write per video, never a side effect.

## In the app

The app calls collections **folders**. The user edits them under Settings →
Folders (the tree, each folder's Location, its slots and overrides), and picks a
video's collection on the Publish workspace's Collection card. Tell them that is
where the template preview lives.
