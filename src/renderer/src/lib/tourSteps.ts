/**
 * The two interactive tours: what each step says, what it points at, and what
 * the app has to do before the step can be measured.
 *
 * Two of them, because a fresh install has no video. `getting-around` walks
 * the library and opens the three Settings panes a new user needs;
 * `first-video` walks the editor, the player, the style sidebar, export and
 * the Publish workspace, and can only run once something is transcribed.
 *
 * A step points at a live element by its `data-tour` attribute.
 * `tourSteps.test.ts` reads the component tree from disk and fails if an id
 * here has no attribute there, which is the only thing keeping those
 * attributes from being refactored away.
 */

import type { Workspace } from '../types/app'
import type { AppSettingsCategoryId } from './appSettingsIndex'

export type TourId = 'getting-around' | 'first-video'

/** Run before a step is measured, so the element it points at exists. */
export type TourAction =
  | { kind: 'open-settings'; category: AppSettingsCategoryId }
  | { kind: 'close-settings' }
  | { kind: 'set-workspace'; workspace: Workspace }

/** Which side of the target the popover prefers. */
export type Placement = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  id: string
  title: string
  paragraphs: string[]
  /** The `data-tour` id to spotlight; none means a centred card. */
  target?: string
  /** Where the popover prefers to sit; the placer flips it when there is no room. */
  placement?: Placement
  /** Run before the step is measured (open Settings on a pane, switch workspace). */
  before?: TourAction[]
  /** Skipped, not centred, when the target is absent. */
  optional?: boolean
  /** The welcome step carries the tutorial player. */
  tutorial?: boolean
}

export interface Tour {
  id: TourId
  title: string
  /** The tour ends quietly as soon as the user leaves this screen. */
  screen: 'library' | 'results'
  steps: readonly TourStep[]
}

/** `app-state`: the `TourId`s the user has already been walked through. */
export const TOUR_SEEN_KEY = 'toursSeen'

const GETTING_AROUND: Tour = {
  id: 'getting-around',
  title: 'Getting around',
  screen: 'library',
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to CapForge',
      tutorial: true,
      paragraphs: [
        'CapForge turns a finished video into captions you can style. Drop a file in, get a word-level transcript, design the captions in a preview that matches the render, then export the video or the subtitle files.',
        'Everything runs on this machine. Your video, its transcript and your notes stay in a folder on your disk, and nothing is uploaded anywhere.',
      ],
    },
    {
      id: 'add-video',
      title: 'Add a video',
      target: 'library-add-video',
      placement: 'bottom',
      paragraphs: [
        'Transcribe… takes a single file. Add to library… takes files, whole folders or a saved project, and you can drop any of them straight onto the window.',
        'Each one becomes a record in the library, with its transcript, its captions and its publish text kept beside it.',
      ],
    },
    {
      id: 'sidebar',
      title: 'Where your videos live',
      target: 'library-sidebar',
      placement: 'right',
      paragraphs: [
        'All videos is the flat list. Unfiled is everything not in a folder, and the folders themselves sit under it.',
        'A folder groups the videos of an event or a series, and can carry the notes and links they all share. New folder, at the foot, creates one where you are looking.',
      ],
    },
    {
      id: 'view',
      title: 'Find and arrange',
      target: 'library-view-controls',
      placement: 'bottom',
      optional: true,
      paragraphs: [
        'Search matches a video by its title or by the name of the file it came from, and inside a folder it can be narrowed to that folder.',
        'Sort by date, name, duration or status, and switch between the grid and the list. The slider sizes the grid tiles.',
      ],
    },
    {
      id: 'transcription',
      title: 'Pick a transcription model',
      target: 'settings-transcription-model',
      placement: 'bottom',
      before: [{ kind: 'open-settings', category: 'transcription' }],
      paragraphs: [
        'Transcription runs on this machine. The model is yours to pick, from Tiny at 75 MB to Large Turbo at about 1.6 GB: bigger is more accurate and slower, and one you have not used yet is fetched the first time you need it.',
        'Speakers can be detected and labelled, and another language can be added later as a second caption track sharing the same timing and style.',
      ],
    },
    {
      id: 'channels',
      title: 'Channels',
      target: 'settings-channels',
      placement: 'left',
      before: [{ kind: 'open-settings', category: 'channels' }],
      paragraphs: [
        'A channel is somewhere your videos get published. Describe how each one looks and sounds, and Claude reads that before it writes a post for it.',
        'The primary channel is a YouTube one, and its details fill the upload package. The bundled capforge-init skill can set all of this up by interview.',
      ],
    },
    {
      id: 'claude',
      title: 'Work with Claude',
      target: 'settings-claude-connect',
      placement: 'bottom',
      before: [{ kind: 'open-settings', category: 'claude' }],
      paragraphs: [
        'Connect Claude Desktop or Claude Code once, restart it, and the agent can clean up a transcript, restyle captions, translate a track and write the upload package while you watch it happen here.',
        'Seven skills come bundled: capforge-init sets up your channels, capforge-publish writes the upload package, and cleanup, translate, style, clips and preflight cover the rest of the pipeline. Your copy of a skill is yours to edit and is never overwritten by an update.',
      ],
    },
    {
      id: 'finish',
      title: 'That is the tour',
      before: [{ kind: 'close-settings' }],
      paragraphs: [
        'Add your first video and press Start. Once it is transcribed the guide picks up again in the editor, where the captions get styled and the upload package gets written.',
        'You can reopen this tour any time from Settings, under General, About.',
      ],
    },
  ],
}

const FIRST_VIDEO: Tour = {
  id: 'first-video',
  title: 'Your first video',
  screen: 'results',
  steps: [
    {
      id: 'views',
      title: 'Three views of the transcript',
      target: 'editor-view-tabs',
      placement: 'bottom',
      before: [{ kind: 'set-workspace', workspace: 'captions' }],
      paragraphs: [
        'Text reads the transcript sentence by sentence and is where you correct it. Groups shows how the words are cut into captions. Transcript lists the segments with their speakers.',
        'The counter on the right of the strip says how many captions or segments you have.',
      ],
    },
    {
      id: 'words',
      title: 'Correct a word, style a word',
      target: 'editor-body',
      placement: 'right',
      paragraphs: [
        'Right-click a word to fix its text, or to give it a colour, a size or a font of its own. Correcting a word never moves the words around it, so the captions stay locked to the audio you cut elsewhere.',
        'In the Groups view, right-click a caption to place it somewhere else on the frame.',
      ],
    },
    {
      id: 'player',
      title: 'The preview is the render',
      target: 'player',
      placement: 'left',
      paragraphs: [
        'The captions drawn over the player are the ones the export draws, down to the pixel. What you see here is what comes out.',
        'The timeline underneath zooms and scrolls, and a caption can be dragged by its edges to change when it starts and ends.',
      ],
    },
    {
      id: 'tracks',
      title: 'Another language',
      target: 'track-tabs',
      placement: 'bottom',
      optional: true,
      paragraphs: [
        'The + on the tab strip adds a caption track in another language, with the same timing and the same style, waiting for text.',
        'Everything downstream is per tab: the preview, the timeline, the style sidebar, and the render and export buttons, which name their files after the language.',
      ],
    },
    {
      id: 'style',
      title: 'Style the captions',
      target: 'studio-panel',
      placement: 'left',
      paragraphs: [
        'Every caption setting lives in these cards: layout, typography, colours, background, animation and reading mode.',
        'A preset saves a look you want to reuse, and can be shared as a file. Undo works on settings too, so trying something out costs nothing.',
      ],
    },
    {
      id: 'export',
      title: 'Export',
      target: 'export-footer',
      placement: 'left',
      // Also on the way *back* from the Publish step, which left the workspace
      // on the other aside and would hide this one.
      before: [{ kind: 'set-workspace', workspace: 'captions' }],
      paragraphs: [
        'Render an MP4 with the captions baked in, or a transparent overlay as MOV or WebM to drop over your cut in an editor.',
        'Subtitle files come out as .srt, .vtt or .ass, split into readable cues. HyperFrames renders the animated caption styles through its own engine.',
      ],
    },
    {
      id: 'publish',
      title: 'The upload package',
      target: 'publish-panel',
      placement: 'left',
      before: [{ kind: 'set-workspace', workspace: 'publish' }],
      paragraphs: [
        'Title, description, chapters, tags, thumbnail and speakers, with a tab for each channel you publish to. A folder can carry the footer and the links every video in it shares.',
        'CapForge never uploads. It writes the package, and you copy it into YouTube or wherever you post.',
      ],
    },
    {
      id: 'finish',
      title: 'That is the loop',
      before: [{ kind: 'set-workspace', workspace: 'captions' }],
      paragraphs: [
        'Drop a video in, correct what needs correcting, style the captions, export, and write the post. Everything you do is saved into the record for that video as you go.',
        'Settings, under General, About, reopens this tour and the one that walks the library.',
      ],
    },
  ],
}

export const TOURS: Record<TourId, Tour> = {
  'getting-around': GETTING_AROUND,
  'first-video': FIRST_VIDEO,
}
