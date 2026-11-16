import json
import os
import urllib.request
from typing import Any


ISSUE_TITLE = "[Automated database backup failure]"
API_ROOT = "https://api.github.com"


def notify_failure(
    environment: dict[str, str] | None = None,
    open_url: Any = urllib.request.urlopen,
) -> str:
    env = environment if environment is not None else os.environ
    token = env["GITHUB_TOKEN"]
    repository = env["GITHUB_REPOSITORY"]
    owner = env["GITHUB_REPOSITORY_OWNER"]
    run_id = env["GITHUB_RUN_ID"]
    run_attempt = env.get("GITHUB_RUN_ATTEMPT", "1")
    run_url = (
        f"{env.get('GITHUB_SERVER_URL', 'https://github.com')}/"
        f"{repository}/actions/runs/{run_id}"
    )
    body = (
        f"@{owner} the automated database backup failed "
        f"(run {run_id}, attempt {run_attempt}).\n\n"
        f"Review the failed job and logs: {run_url}\n\n"
        "No backup was marked successful. Each run uses a unique object name, "
        "so this failure does not replace the previous backup."
    )
    api_base = f"{API_ROOT}/repos/{repository}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    def request_json(url: str, method: str, payload: dict[str, Any] | None = None) -> Any:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        with open_url(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    issues = request_json(
        f"{api_base}/issues?state=open&per_page=100",
        "GET",
    )
    existing = next(
        (
            issue for issue in issues
            if "pull_request" not in issue
            and issue.get("title") == ISSUE_TITLE
        ),
        None,
    )
    if existing:
        result = request_json(
            f"{api_base}/issues/{existing['number']}/comments",
            "POST",
            {"body": body},
        )
    else:
        result = request_json(
            f"{api_base}/issues",
            "POST",
            {
                "title": ISSUE_TITLE,
                "body": body,
                "assignees": [owner],
            },
        )
    return result["html_url"]


def main() -> None:
    issue_url = notify_failure()
    print(f"Backup failure notification recorded: {issue_url}")


if __name__ == "__main__":
    main()
