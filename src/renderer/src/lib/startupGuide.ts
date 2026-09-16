/**
 * The "Welcome to CapForge" walkthrough: cards, not coach marks.
 *
 * Steps are plain copy with at most one action, either "open this Settings
 * category" or "open this link", so the dialog stays a dialog and nothing has
 * to highlight live UI across four screens. `startupGuide.test.ts` pins the
 * shape and checks every settings action against the real Settings rail.
 */

import type { AppSettingsCategoryId } from './appSettingsIndex'

export type GuideAction =
  | { kind: 'settings'; label: string; category: AppSettingsCategoryId }
  | { kind: 'link'; label: string; url: string }

export interface GuideStep {
  id: string
  title: string
  paragraphs: string[]
  action?: GuideAction
}

/** The walkthrough video linked from the CHANGELOG and from the guide's footer. */
export const TUTORIAL_URL = 'https://www.youtube.com/watch?v=7xxLt5FEq1E'

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: 'welcome',
    title: 'What CapForge does',
    paragraphs: [
      'CapForge turns a finished video into captions you can style. Drop a file in, get a word-level transcript, design the captions in a preview that matches the render exactly, then export the video or the subtitle files.',
      'It is a finishing tool, so captions stay locked to the audio you cut elsewhere. Correcting a word never moves the words around it.',
      'Everything runs on this machine. Your video, its transcript and your notes stay in a folder on your disk, and nothing is uploaded anywhere.',
    ],
  },
  {
    id: 'library',
    title: 'Your library',
    paragraphs: [
      'The library is the home screen and the list of everything CapForge knows about. Use Add video for a single file, Import… for files, folders or a saved project, or drop them straight onto the window.',
      'Folders group videos, for an event or a series, and carry settings the whole group shares. Search finds a video by its name or its file name, and the grid and list views sort by date, duration or status.',
      'A watch folder in Settings can import new recordings for you as they land.',
    ],
  },
  {
    id: 'transcribe',
    title: 'Transcribe',
    paragraphs: [
      'Start runs WhisperX on the audio and gives back every word with its own start and end time, with speakers detected and labelled.',
      'The model is yours to pick, from Tiny at 75 MB to Large Turbo at about 1.6 GB. Bigger is more accurate and slower, and a model you have not downloaded yet is fetched the first time you use it.',
      'Another language can be added later as a second caption track, sharing the same timing and style.',
    ],
    action: { kind: 'settings', label: 'Open transcription settings', category: 'transcription' },
  },
  {
    id: 'edit',
    title: 'Edit and style',
    paragraphs: [
      'Three views of the same transcript: Text for reading and correcting, Groups for how the words are cut into captions, and Transcript for the segments with their speakers.',
      'Right-click a word to fix it or give it its own colour, size or font. Right-click a caption to move it on screen. The timeline below the player drags caption edges and the player shows the captions as they will render.',
      'The sidebar holds every style setting, and a preset saves a look you want to reuse.',
    ],
  },
  {
    id: 'export',
    title: 'Export',
    paragraphs: [
      'Render an MP4 with the captions baked in, or a transparent overlay as MOV or WebM to drop over your cut in an editor. The preview you designed is the frame that gets rendered.',
      'Subtitle files come out as .srt, .vtt or .ass, split into readable cues rather than one cue per transcription chunk.',
      'HyperFrames renders the animated caption styles through a separate engine, from the same settings.',
    ],
  },
  {
    id: 'publish',
    title: 'Publish',
    paragraphs: [
      'The Publish workspace sits beside the caption editor and holds everything the upload needs: title, description, chapters, tags, thumbnail and speakers, with a tab per channel.',
      'Channels are set up in Settings, and a folder can carry the footer and links every video in it shares, so an event is written once.',
      'CapForge never uploads. It writes the package and you copy it into YouTube or wherever you post.',
    ],
    action: { kind: 'settings', label: 'Set up channels', category: 'channels' },
  },
  {
    id: 'claude',
    title: 'Work with Claude',
    paragraphs: [
      'CapForge can be driven by Claude Desktop or Claude Code. Connect either one in Settings, and the agent can clean up the transcript, restyle captions, translate a track and write the upload package while you watch it happen in the app.',
      'Two skills come bundled: capforge-init sets up your channels by interview, and capforge-publish writes the upload package for a video.',
      'Skills are yours to edit, and your copy is never overwritten by an update.',
    ],
    action: { kind: 'settings', label: 'Connect Claude', category: 'claude' },
  },
]
