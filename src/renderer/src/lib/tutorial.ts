/**
 * The tutorial video, in one place.
 *
 * Three constants rather than a module of their own hidden inside the guide:
 * `TutorialPlayer` renders the embed, the welcome step of the getting-around
 * tour mounts that player, and `csp.test.ts` reads the embed URL to pin the
 * one origin `index.html` allows in a frame.
 */

/** The walkthrough video linked from the CHANGELOG and shown in the tour. */
export const TUTORIAL_VIDEO_ID = '7xxLt5FEq1E'

/** Where "Open in browser" goes, and the link the CHANGELOG carries. */
export const TUTORIAL_URL = `https://www.youtube.com/watch?v=${TUTORIAL_VIDEO_ID}`

/**
 * The in-app player's source. The nocookie host is YouTube's own privacy
 * variant, it is the only origin `index.html`'s CSP allows in a frame
 * (`csp.test.ts`), and nothing loads from it until the user asks
 * (`TutorialPlayer` renders no iframe while collapsed). `rel=0` keeps the
 * end screen's suggestions to this channel.
 */
export const TUTORIAL_EMBED_URL = `https://www.youtube-nocookie.com/embed/${TUTORIAL_VIDEO_ID}?rel=0`
