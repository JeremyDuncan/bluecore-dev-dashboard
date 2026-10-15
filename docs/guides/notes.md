---
title: Notes
sidebar_position: 4
sidebar_class_name: sidebar-icon sidebar-icon--notes
---

**Notes** is your own notebook on this site: Markdown notes you can read, write, tag and search here, that AI agents can read and add to, and that are also an [Obsidian](https://obsidian.md) vault. This page explains how to set it up, where the notes live, and how the site, Obsidian and AI agents share them.

## Getting started

There's nothing to set up. Run the site as usual:

```bash
make up
```

Open **Notes** in the navbar. The first time, the MCP server creates a `notes/` folder in this repo with a *Welcome* note. Click **New note** to write your own.

:::info Local only
Notes are personal, so they only exist on your machine. The `notes/` folder is git-ignored, and the public site has no Notes link. In `make prod`, notes are only served to `localhost`, not to people opening your site through a tunnel.
:::

## Where notes live

Each note is one Markdown file: `<folder>/<title>.md`. The title is the file name, as in Obsidian. Folders are optional.

The site adds a few properties (front matter) at the top of the notes it writes:

```markdown
---
tags:
  - meeting
  - bluecore_api
created: 2026-10-15T14:02:00.000Z
updated: 2026-10-15T14:30:00.000Z
author: you
---
Notes from the API sync. See [[Keycloak realm export]]. #followup
```

| Property | Meaning |
|---|---|
| `tags` | The note's tags. Tags written inline in the text (`#followup`) count too. |
| `created` | When the note was created. For notes without it, the file's date is used. |
| `updated` | When it was last saved from the site or by an agent. An edit in Obsidian only changes the file's date, so the later of the two is shown. |
| `author` | Who created it here: `you`, `Ask the docs (Claude Code)`, or an agent's name. |

Other properties, such as `aliases` or anything an Obsidian plugin adds, are kept as they are.

## Using an existing Obsidian vault

To use a vault you already have instead of `notes/`, point `NOTES_DIR` at it in `.env` and restart:

```bash
NOTES_DIR=/Users/you/Documents/My Vault
```

The vault's name in Obsidian is its folder name, which **Open in Obsidian** (in a note's **⋯** menu) uses. If you renamed the vault in Obsidian, also set `NOTES_VAULT_NAME`.

To go the other way and open the site's notes in Obsidian, choose **Open folder as vault** in Obsidian and pick the `notes/` folder in this repo.

Either way, both read and write the same files. A note you change in Obsidian shows up on the site within about 20 seconds (or when you switch back to the tab), and the other way round.

:::tip Working without Obsidian
You never need Obsidian: the site reads and writes plain Markdown files. You can start with the site and open the folder in Obsidian later, or start in Obsidian and point the site at the vault later.
:::

## Reading and organizing notes

The Notes page has three ways to browse, at the top of the list:

- **By date**: grouped into Today, Yesterday, Previous 7 days, and then by month. Sort by last change or by creation date.
- **By tag**: every tag with how many notes use it. Click one to filter, and click it again to clear the filter. Nested tags (`project/api`) match their parent (`project`). With many tags, type in **Filter tags** to narrow them (Enter picks the first match, Esc clears), sort them by *Most used*, *A–Z* or *Recently used* (remembered in your browser), and use **Show all** to see past the top ones. The Notes home page has the same tag browser. A tag needs a letter, `_` or `-`, so issue numbers like `#339` aren't tags.
- **By folder**: a folder tree, like the docs sidebar. Click a folder to open or close it; sub-folders come first, then the notes (A–Z). The site remembers which folders you opened, and the folders holding the note you're reading always stay open.

To give a note more room, hide the notes list with the panel button at the top of it. A narrow strip stays, with buttons to show the list again, jump to a note, start a new one and open the Trash. The page remembers whether the list is hidden.

**Search** finds notes containing all the words you type, in the title, tags or text. To jump straight to a note, press **⌘P** (Ctrl+P on Windows and Linux) anywhere on the Notes page, or click the **⌘ P** in the search box. Type a few letters of its title, in order: "kre" finds "Keycloak realm export". Enter opens it. With nothing typed, the switcher shows your recent notes, and if nothing matches it offers to create the note.

A note page shows its tags, its dates and the notes linking to it (**Linked from**). Its **⋯** menu has **Pin to the top of the list**, **Open in Obsidian**, **Copy [[link]] to this note** (to paste into another note) and **Show in folders**.

- **Pinned notes** show in a *Pinned* group at the top of the date and tag lists, with a pin icon in the folder tree. Pinning sets `pinned: true` in the note's properties, so it travels with the file.
- **Outline**: on wide screens, a note with three or more headings shows them beside it (*On this note*), with the section you're reading highlighted. Click one to jump to it.
- **Tasks**: tick a `- [ ]` checkbox in a note and the note is saved right away. If the note changed somewhere else meanwhile, it reloads instead, and you tick it again.

The page renders the Obsidian syntax people use most:

| Syntax | Shows as |
|---|---|
| `[[Note]]`, `[[Note\|text]]`, `[[Note#Heading]]` | A link to that note. A link to a note that doesn't exist yet is dimmed, and clicking it starts that note. |
| `![[image.png]]`, `![[image.png\|300]]` | An image from the vault. |
| `#tag` | A tag link. |
| `> [!note] Title` | A callout (`tip`, `warning`, `danger`, … get their own colors). |
| `%%comment%%` | Hidden. |
| `==text==` | Highlighted. |

Raw HTML in a note is shown as text, never run. Dataview queries and other plugin syntax show as plain text.

### Notes about docs pages

Link a note to a docs page with the toolbar's **Link to a docs page** button. It searches the docs and inserts a link such as `[Keycloak](/blue-core-repos/bluecore-stack/docs/keycloak)`. That docs page then lists the note at the bottom, under *Your notes about this page*.

Every docs page also has a **Note about this page** link there, which starts a new note that already links to the page. This box only appears when the site runs locally, so the public site never shows your notes.

## Writing notes on the site

- **New note**: a title (it becomes the file name), an optional folder, tags (press Enter or a comma after each one, or click a suggested existing tag), and the text in Markdown. **Preview** shows how it will look. ⌘/Ctrl+S saves.
- **Formatting toolbar** (above the text while writing): headings 1–3, bold, italic, strikethrough, highlight (`==text==`), inline code, a link to another note, a web link, a vault image, a tag, bulleted, numbered and task lists, a quote, a callout, a code block, a table and a divider. Each button wraps or prefixes the selected text, or inserts a placeholder that's selected, ready to type over; clicking bold, italic or a list again removes it. ⌘/Ctrl+Z undoes any of them.
- **Linking notes**: type `[[` (or click the link-to-a-note button) to search your notes, then pick one with the arrow keys and Enter. With text selected, that text becomes the link's label (`[[Note|text]]`). If no note matches, you can link to a new one; the link shows dimmed until you create it.
- **Shortcuts**: ⌘/Ctrl+B bold, ⌘/Ctrl+I italic, ⌘/Ctrl+K web link, ⌘/Ctrl+S save. Enter in a list, task list or quote continues it, and Enter on an empty item ends it.
- **Layout**: **Write**, **Split** (the text and a live preview side by side, on screens 1200px or wider) or **Preview**. Your choice is remembered.
- **Templates**: pick one in **Template** to start a note from it. If the note already has text, the template goes below it. Templates are notes in the vault's `Templates` folder, as in Obsidian. `{{title}}`, `{{date}}`, `{{time}}` and formats like `{{date:YYYY-MM-DD}}` are filled in, and the template's tags are added. If you don't have any yet, **Add starter templates** creates *Meeting notes*, *How-to* and *Decision record*, which you can edit like any note.
- **Your own templates**: on a note, **⋯ → Save as template** copies it to `Templates/` (its title in the first heading becomes `{{title}}`) and opens the copy, so you can trim it to the reusable parts. **New template…** in the Template list starts a blank one. The Notes home page lists your templates: **Use** starts a new note from one, and `{{title}}` is filled in with the note's title when you save. In the notes list, templates have a *Template* badge. Edit or delete templates like any other note in the `Templates` folder.
- **Duplicate**: **⋯ → Duplicate** makes a copy of the note next to it, called "*title* copy", and opens it for editing. Its tags and properties are copied; it gets new dates and isn't pinned.
- **Images**: paste a screenshot, drop image files onto the text, or use the toolbar's image button. Each image is saved in the vault's `attachments` folder (screenshots as `Pasted image <date and time>.png`, as Obsidian names them) and embedded as `![[name]]` where the cursor is. PNG, JPEG, GIF and WebP images up to 20 MB are accepted. The `attachments` folder is for images only: the Notes page doesn't list it as a folder, and notes and folders can't be put in it (Obsidian still shows it).
- **Drafts**: while you type, your changes are kept in this browser ("Draft kept …" next to Save). If the tab closes or the browser crashes before you save, the next time you open that note's editor (or a new note) it offers **Restore them** or **Discard**. Saving or cancelling removes the draft.
- **Edit**: change the title, the text, the folder and the tags. Inline `#tags` stay in the text, and the tag field edits the `tags` property.
- **Renaming**: change the **Title** and save. The file is renamed, and `[[links]]` to the note in other notes are updated, whether they're plain (`[[Old]]`), paths (`[[folder/Old]]`), labeled or embedded. Links inside code aren't touched, and Markdown links to the file (`[x](Old.md)`) aren't updated.
- **Changed elsewhere**: if the note changed in Obsidian or was changed by an agent while you were editing, saving stops and asks whether to keep your version or reload theirs, so neither side is silently overwritten.

## Organizing folders

In **By folder**:

- **Add**: the **+** next to *Folders* adds a note or a folder at the top level. Hover over a folder for its own **+**, which adds a note in it or a folder inside it. Type the new folder's name in place, then press Enter (Esc cancels).
- **Rename a folder**: hover over it and click the pencil. The notes inside keep their names, so `[[links]]` to them still work.
- **Delete a folder**: the trash icon shows on empty folders only. Move or delete a folder's notes first.
- **Move a note**: drag it onto a folder, or onto *Drop here to move to the top level*, which appears while you drag. Hovering over a closed folder while dragging opens it. You can also change the **Folder** field when editing a note; a folder that doesn't exist yet is created.

Moving keeps the note's file name, so links to it keep working. If the target folder already has a note with that name, the move is refused. Rename notes in Obsidian or your file manager.

## Deleting notes

- **One note**: the **Delete** button on the note.
- **Several**: click **Select** above the list, tick the notes, then the trash icon in the selection bar.

A dialog asks you to confirm first. It names the notes and warns you when other notes link to the one you're deleting. Cancel has the focus, and Esc or a click outside the dialog cancels too.

Deleted notes aren't erased: they move to the `.trash` folder in your vault, the same place Obsidian's "Move to Obsidian trash" puts them. Images a note embeds aren't deleted with it.

**Trash**, at the bottom of the notes list, shows what's there, newest first, with the folder each note came from:

- **Restore** puts a note back in its folder (with a number added if that name is taken meanwhile). Notes deleted in Obsidian go back to the top level, because Obsidian doesn't record where they were.
- **Delete forever** erases the file, after a confirmation. This can't be undone.

The site keeps where each note came from in `.trash/.restore.json`.

## Copying and exporting notes

- **Copy**: the copy button on a note puts the note's Markdown on the clipboard, exactly as it is in the file (properties included), ready to paste into another note, a chat or an issue.
- **Export one note**: the download button on a note saves it as a `.md` file.
- **Export a folder**: in **By folder**, hover over a folder and click its download button. It exports the folder's notes, including those in its sub-folders.
- **Export a selection**: click **Select** above the list, tick notes (a group's or folder's checkbox ticks everything in it, and the checkbox in the bar ticks or clears everything shown), then **Export**.

One note downloads as a `.md` file. Several download as a `.zip` that keeps their folders and includes the images and PDFs they embed, so it unzips straight into another vault.

## Notes and AI

**Ask the docs** (the chat box) can search and read your notes, and save notes when you ask it to:

- Ask, for example, "save a note with the steps to export the Keycloak realm, tagged keycloak". It reuses your existing tags and links the new note in its answer.
- **Save as note**, under any answer, saves the question and the answer to the *Ask the docs* folder, tagged `ask-the-docs`.

It never writes a note on its own initiative.

**Any AI agent** connected to the MCP server (`http://localhost:3001/mcp`, see the README) gets these tools:

Reading:

| Tool | What it does |
|---|---|
| `list_notes` | Notes, newest first, filtered by tag, folder or date range (`since`, `until`). |
| `search_notes` | Keyword search over titles, tags and text. |
| `read_note` | One note as Markdown, with its tags, dates and backlinks. `section` returns one heading of a long note. `include_images` also returns the images it embeds (up to 6), so the agent can look at screenshots, diagrams and photos. |
| `get_note_image` | One image from the vault, to look at, by its name (as in `![[name]]`) or path. |
| `related_notes` | What a note links to (and links to notes that don't exist yet), what links to it, and notes sharing its tags. |
| `list_tasks` | Checklist items across notes, open ones by default, with the note, line and section of each. Filter by tag, folder or date. |
| `list_note_tags` | Every tag with its count. |
| `list_templates` | The templates in `Templates/`, with their sections. |
| `list_attachments` | Images and PDFs in the vault and the notes that embed each (`unused_only` for the ones nothing uses). |
| `notes_for_doc` | Your notes that link to a docs page, so an agent reading the docs also sees what you wrote about them. |
| `notes_health` | What to tidy: links to notes that don't exist, unused images, tags spelled more than one way, notes without tags, empty notes. |

Writing (only when you ask):

| Tool | What it does |
|---|---|
| `create_note` | Adds a note (title, text, tags, folder, author), optionally from a `template` with `{{title}}` and `{{date}}` filled in. Never overwrites: a title that's taken gets a number added. |
| `update_note` | Appends to a note, replaces its text, adds or removes tags, or moves it to another folder (`move_to`). |
| `complete_task` | Ticks (or unticks) a checklist item. It checks the task's text, so a note that changed since `list_tasks` can't get the wrong box ticked. |
| `rename_note` | Renames a note and updates the `[[links]]` to it. |
| `pin_note` | Pins or unpins a note. |
| `duplicate_note` | Copies a note (text, tags, properties) to "*title* copy" or a title you give, in the same or another folder. |
| `save_template` | Creates or updates a template in `Templates/`, from an existing note (`from_note`) or from Markdown (`body`). `replace` overwrites a template of the same name. |
| `attach_image` | Saves an image in `attachments/` and, optionally, embeds it at the end of a note with a caption. |

**Which AI wrote it.** A note an AI writes records the agent as `author` (*Claude Code*, *Codex*) and the exact model as `model` (for example `claude-sonnet-4-5-20250929`). When an AI later changes a note's text, `edited_by` and `edited_model` say so, until you save it yourself. The note's page shows the agent's logo, its name and the model (*Claude Sonnet 4.5*), and so do the note cards on the Notes home page. Through **Ask the docs** this is automatic: the chat helper tells the MCP server which CLI and model are answering, and turns an alias like `sonnet` into the exact model. Other agents are recognized by their User-Agent where possible and can pass `model` to the write tools.

None of them deletes anything: only you can delete notes, on the Notes page.

Images are sent to the agent's AI provider when it looks at them, like note text is. Images over 3 MB aren't sent, and SVGs and PDFs are listed but not shown. The **notes_review** prompt (a slash command in Claude Code, `/mcp__docs__notes_review`) summarizes what changed in your notes this week, your open tasks, notes written by AI to check, and what to tidy.

:::warning
An agent with these tools can change your notes when you ask it to. Keep your vault in Obsidian Sync, iCloud or git if you want a history of changes.
:::

## Settings

| Variable (`.env`) | Default | What it does |
|---|---|---|
| `NOTES_DIR` | `./notes` | The vault folder. Docker mounts it at `/notes`. |
| `NOTES_VAULT_NAME` | the folder's name | The vault's name in Obsidian, for **Open in Obsidian**. |
| `NOTES_TEMPLATES` | `Templates` | The folder that holds templates. |
| `NOTES_ATTACHMENTS` | `attachments` | The folder where pasted and dropped images are saved. |

Under the hood, the vault is read and written by the MCP server (`mcp/notes.mjs`). It serves the Notes page (`/api/notes`, in `mcp/notes-api.mjs`) and the MCP tools (`mcp/notes-tools.mjs`). The page itself is `src/pages/notes.js` with its components in `src/components/Notes/`.

## Troubleshooting

- **"The notes server isn't answering"**: the MCP container isn't running. Start the site with `make up`, or run `npm run mcp`.
- **A note doesn't show up**: only `.md` files count, and folders starting with a dot (`.obsidian`, `.trash`) are skipped.
- **"The properties at the top of this note aren't valid YAML"**: fix the front matter in Obsidian or a text editor. Until then, the note can't be edited here, so its properties aren't lost.
- **Open in Obsidian does nothing**: add the folder to Obsidian as a vault first, and check that its name matches `NOTES_VAULT_NAME`.
- **On Linux, Obsidian can't edit notes created by the site**: Docker writes them as root. Run `sudo chown -R $USER notes/`.

## Related

- [Live GitHub data](./live-github-data.md): the other part of the site served by the MCP server
- [How content gets onto the site](./content-lifecycle.md): what's local only and why
