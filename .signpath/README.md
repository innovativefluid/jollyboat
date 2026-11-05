# Code signing with SignPath

Jollyboat's Windows downloads are signed for free by the SignPath Foundation (open source code
signing). The release workflow is ready for it; it signs once the settings below exist, and
builds unsigned until then.

## What gets signed

The three files people download: `Jollyboat-<version>-windows-universal-setup.exe` and the two
portable exes (`x64`, `arm64`). SmartScreen looks at what is downloaded, so these are the ones
that count. The files inside them (Electron's own executable, renamed to Jollyboat.exe, and the
sound helper) stay unsigned: the Foundation does not sign binaries built by someone else, and
Electron's executable is Electron's build.

## Setting it up

1. Apply at <https://signpath.org/apply> with this repository. The README's "Code signing
   policy" section and PRIVACY.md are what they ask for on the project page; the installer
   shows the privacy statement (build/license.txt).
2. Once accepted, in SignPath:
   - add the predefined **GitHub.com** trusted build system and link it to the project;
   - install the SignPath GitHub App for the repository;
   - set the project's artifact configuration to `artifact-configuration.xml` from this folder;
   - create (or use) a signing policy for releases with manual approval; note its slug.
3. Turn on multi-factor sign-in for GitHub and SignPath (the Foundation requires it).
4. In the GitHub repository settings (Secrets and variables → Actions):
   - secret `SIGNPATH_API_TOKEN`: the API token of a SignPath user who may submit signing
     requests for the project;
   - variable `SIGNPATH_ORGANIZATION_ID`: the SignPath organization id;
   - variable `SIGNPATH_PROJECT_SLUG` if the project slug is not `jollyboat`;
   - variable `SIGNPATH_POLICY_SLUG` if the policy slug is not `release-signing`.

## Each release

Dispatch the release as before. The Windows build stops at "Sign (SignPath, waits for an
approver)" until the signing request is approved on signpath.io (it waits up to four hours).
Then the signed files replace the unsigned ones, `latest.yml`, the blockmap and
`latest-portable.json` are worked out again from the signed files, and the draft release gets
them.

Signed builds also name their publisher ("SignPath Foundation") inside the app, so an installed
copy accepts an update only if it is signed by the same publisher. A release that is not signed
would then not install itself on signed copies (they keep running the version they have); the
portable copies check the same way.
