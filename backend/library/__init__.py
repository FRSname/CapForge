"""The video library — durable, backend-owned per-video records (v3.0 #1).

See docs/plans/backend-library.md and docs/plans/creator-hub-vision.md §2.
The session (transcript, groups, style, tracks) stays renderer-owned; the
*dossier* (``record.json``), the derived transcript snapshot, the assets and the
disposable search index live here and are readable with no window open.
"""
