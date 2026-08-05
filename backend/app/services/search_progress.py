"""Small in-process progress registry for long search-index updates."""

import threading
from dataclasses import dataclass, field


@dataclass
class SearchProgress:
    done: int = 0
    total: int = 0
    state: str = "running"
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)


_jobs: dict[str, SearchProgress] = {}
_lock = threading.Lock()


def start(job_id: str) -> SearchProgress:
    with _lock:
        job = SearchProgress()
        _jobs[job_id] = job
        return job


def update(job_id: str, done: int, total: int) -> None:
    with _lock:
        if job := _jobs.get(job_id):
            job.done, job.total = done, total


def finish(job_id: str, state: str = "complete") -> None:
    with _lock:
        if job := _jobs.get(job_id):
            job.state = state


def get(job_id: str) -> dict[str, int | str] | None:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return None
        return {"done": job.done, "total": job.total, "state": job.state}


def cancel(job_id: str) -> bool:
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            return False
        job.cancel_event.set()
        job.state = "cancelling"
        return True
