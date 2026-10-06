<h1 align="center">PR Review Labels Action</h1>

<p align="center">
	Adds and removes a 'status: waiting for author' label on PR reviews, including PRs from forks.
	🏷️
</p>

<p align="center">
	<!-- prettier-ignore-start -->
	<!-- ALL-CONTRIBUTORS-BADGE:START - Do not remove or modify this section -->
	<a href="#contributors" target="_blank"><img alt="👪 All Contributors: 1" src="https://img.shields.io/badge/%F0%9F%91%AA_all_contributors-1-21bb42.svg" /></a>
<!-- ALL-CONTRIBUTORS-BADGE:END -->
	<!-- prettier-ignore-end -->
	<a href="https://github.com/JoshuaKGoldberg/pr-review-labels-action/blob/main/.github/CODE_OF_CONDUCT.md" target="_blank"><img alt="🤝 Code of Conduct: Kept" src="https://img.shields.io/badge/%F0%9F%A4%9D_code_of_conduct-kept-21bb42" /></a>
	<a href="https://codecov.io/gh/JoshuaKGoldberg/pr-review-labels-action" target="_blank"><img alt="🧪 Coverage" src="https://img.shields.io/codecov/c/github/JoshuaKGoldberg/pr-review-labels-action?label=%F0%9F%A7%AA%20coverage" /></a>
	<a href="https://github.com/JoshuaKGoldberg/pr-review-labels-action/blob/main/LICENSE.md" target="_blank"><img alt="📝 License: MIT" src="https://img.shields.io/badge/%F0%9F%93%9D_license-MIT-21bb42.svg" /></a>
	<img alt="💪 TypeScript: Strict" src="https://img.shields.io/badge/%F0%9F%92%AA_typescript-strict-21bb42.svg" />
</p>

## Usage

This action keeps a `status: waiting for author` label up to date on pull requests:

- When someone with write access submits a review requesting changes, it adds the label
- When a review is requested, it removes the label

It works on pull requests from forks, which GitHub doesn't give write permissions to in `pull_request_review` workflows.
That needs two workflows:

1. An unprivileged `pull_request_review` workflow that records the review
2. A privileged workflow that adds the label after the first workflow completes, and removes it when a review is requested

`.github/workflows/pr-review-submitted.yaml`:

```yaml
jobs:
  pr_review_submitted:
    permissions: {}
    runs-on: ubuntu-latest
    steps:
      - uses: JoshuaKGoldberg/pr-review-labels-action@v0.1.0

name: PR Review Submitted

on:
  pull_request_review:
    types:
      - submitted
```

`.github/workflows/pr-review-labels.yaml`:

```yaml
jobs:
  pr_review_labels:
    permissions:
      actions: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - uses: JoshuaKGoldberg/pr-review-labels-action@v0.1.0

name: PR Review Labels

on:
  pull_request_target:
    types:
      - review_requested
  workflow_run:
    types:
      - completed
    workflows:
      - PR Review Submitted
```

The `workflows` entry must match the first workflow's `name`.

The second workflow runs with write permissions, so consider pinning the action to a full commit SHA rather than a tag.
This action only supports github.com, not GitHub Enterprise Server.

### Inputs

| Input          | Description                                                                            | Default                      |
| -------------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| `github-token` | GitHub token used to read artifacts and edit labels.                                   | `${{ github.token }}`        |
| `label`        | Label to add when a review requests changes, and to remove when a review is requested. | `status: waiting for author` |

### How It Works

On `pull_request_review`, the action uploads a small artifact containing the pull request and review IDs if the review requested changes.
That workflow runs with the pull request's code, so the artifact is treated as untrusted.

On `workflow_run`, the action reads that artifact without unzipping it or writing it to disk, and warns instead of labeling if it isn't a tiny JSON record.
It then only adds the label if GitHub's API confirms that:

- The pull request is open
- The review exists on that pull request, requested changes, and is from someone with write access
- The review or the pull request's head is on the commit the recording workflow ran on
- Since the review, no review has been requested, the label hasn't been removed, and the reviewer hasn't approved, dismissed, or requested changes again

On `pull_request_target`, the action removes the label when a review is requested.
It never checks out or runs code from the pull request.

### Limitations

GitHub doesn't run `pull_request_review` workflows on pull requests with merge conflicts.
Reviews requesting changes on those pull requests won't add the label.

## Development

See [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md), then [`.github/DEVELOPMENT.md`](./.github/DEVELOPMENT.md).
Thanks! 🏷️

## Contributors

<!-- spellchecker: disable -->
<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center"><a href="http://www.joshuakgoldberg.com"><img src="https://avatars.githubusercontent.com/u/3335181?v=4?s=100" width="100px;" alt="Josh Ghoulberg 👻"/><br /><sub><b>Josh Ghoulberg 👻</b></sub></a><br /><a href="https://github.com/JoshuaKGoldberg/pr-review-labels-action/commits?author=JoshuaKGoldberg" title="Code">💻</a> <a href="#content-JoshuaKGoldberg" title="Content">🖋</a> <a href="https://github.com/JoshuaKGoldberg/pr-review-labels-action/commits?author=JoshuaKGoldberg" title="Documentation">📖</a> <a href="#ideas-JoshuaKGoldberg" title="Ideas, Planning, & Feedback">🤔</a> <a href="#infra-JoshuaKGoldberg" title="Infrastructure (Hosting, Build-Tools, etc)">🚇</a> <a href="#maintenance-JoshuaKGoldberg" title="Maintenance">🚧</a> <a href="#projectManagement-JoshuaKGoldberg" title="Project Management">📆</a> <a href="#tool-JoshuaKGoldberg" title="Tools">🔧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->
<!-- spellchecker: enable -->

> 💝 This package was templated with [`create-typescript-app`](https://github.com/JoshuaKGoldberg/create-typescript-app) using the [Bingo framework](https://create.bingo).
