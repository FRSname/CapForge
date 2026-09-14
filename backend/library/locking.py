"""The library store's write lock, as a method decorator.

Every mutating ``LibraryStore`` method is read-modify-write (``get`` →
``model_copy`` → ``_persist``), and records are written from more than one
thread: FastAPI's threadpool and the watch-folder poller. ``@writes`` holds the
store's one re-entrant ``write_lock`` for the whole sequence, so no write can
land between another's read and its write. It is re-entrant because writers
call writers (``create_or_get`` → ``promote``, ``import_project_file`` →
``put_project``).

Reads stay unlocked: every file is swapped in with ``os.replace``, so a reader
sees the old file or the new one, never a torn one.

What must never run under it: ffmpeg, network I/O, or the ``on_created`` hook.
A slow operation there would stall every writer, including the autosave.
"""

from __future__ import annotations

import functools
from typing import Any, Callable, TypeVar, cast

Method = TypeVar("Method", bound=Callable[..., Any])


def writes(method: Method) -> Method:
    """Run ``method`` holding ``self.write_lock``."""

    @functools.wraps(method)
    def locked(self: Any, *args: Any, **kwargs: Any) -> Any:
        with self.write_lock:
            return method(self, *args, **kwargs)

    return cast(Method, locked)
