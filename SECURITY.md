# Security

tells reads source files, rewrites some of them (`tells fix`), and loads pages you name in headless Chrome (`tells render`). As a Claude Code plugin, its skill tells an agent to run those commands. Please report anything that lets a file or page make tells write outside the paths it was given, run code, or reach the network on its own.

## Reporting a vulnerability

Report privately through [GitHub's private vulnerability reporting](https://github.com/bubb4rd/tells/security/advisories/new). Don't open a public issue.

Include the tells version (`tells --version`), your Node version, the command you ran and a file or page that reproduces it. You'll get a reply within a week.

## Scope

In scope:

- `tells fix` writing to a file it wasn't given, or writing something other than the documented fixes
- `tells render` and the Chrome it launches: flags, temporary profiles, and what a rendered page can reach
- The Claude Code skill in `skills/tells/`: anything in it that could lead an agent to run more than the documented commands

Out of scope: Chrome itself, and pages you choose to render. Report Chrome bugs to the Chromium project.
