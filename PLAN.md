# Player controls plan

Goal: the player should work like the Netflix TV app for films and series, and like a good TV box for live channels. **This pass covers function only.** The look of the control bar comes later, in Phase 6.

## Status (2026-11-01)

Phases 1–5 are built in one pass, as asked (no per-phase stops). Phase 6 (look) is not started.

- **Phase 0 was not run as a separate test build.** Each unknown has a built-in fallback instead:
  - Picture: five modes by resizing the video box. If this TV's player ignores a mode, the picture stays as it was and the drawer says so.
  - Keys: Info = 457, Guide = 458, digits = 48–57 and 96–105. Colour keys use the codes already in `keys.js`. If a key does nothing on your remote, tell me which.
  - Catch-up: three link formats are tried in turn (`/timeshift/…m3u8`, the same as `.ts`, then `streaming/timeshift.php`). If all fail, the screen says the replay is unavailable and Back returns to live.
  - Subtitle size: set with `video::cue`. A player that draws its own subtitles may ignore it.
- **Checked:** all scripts pass a syntax check, and 59 scripted checks pass in a simulated browser (fake clock, fake video, fake provider) covering Phases 1–5.
- **Not checked yet:** anything on the real TV. See the test checklist at the bottom.

Not built: Magic Remote wheel, seek thumbnails (the provider has none).

## Decisions (2026-11-01)

| Question | Decision |
|---|---|
| Up/Down with the controls hidden | **Live:** change channel (Up = next, Down = previous). **Films and series:** show the controls. |
| Up Next | 10 s countdown. "Are you still watching?" after 3 autoplayed episodes. |
| Extras | All four: learned Skip intro, pause info card, subtitle size, catch-up + sleep timer. |
| Colour keys | Red = Audio & Subtitles, Green = last channel, Yellow = Favorite, Blue = next picture mode. |
| Left out for now | Magic Remote wheel (can be added later). |

## Hard limits on this TV

These decide how each feature is built.

| Limit | Effect on the plan |
|---|---|
| Any CSS transform, fade, or full-screen box over the video drops the webOS picture plane (`css/styles.css:171`, `:204`). | Zoom and crop resize the `<video>` box itself. New panels are cards, never full-screen dimmers. |
| The TV's native player may not report the video size (`videoWidth` = 0). | Picture modes assume 16:9 when the size is unknown. |
| The provider (Xtream) has no intro or credits markers and no seek thumbnails. | Skip intro is learned from the user's own skips. Credits are estimated from the length (last 5%, 20–60 s). No thumbnail preview. |
| The provider limits open connections (429 / 458 / 509 are already handled in `player.js:330`). | Fast channel zapping must not open a stream on every key press. |
| Key codes differ between LG remote models. | Phase 0 checks the user's real remote before keys are assigned. |
| The native player may draw subtitles itself, outside CSS. | Phase 0 checks whether subtitle size can be changed with `::cue`. |
| Catch-up depends on the provider and its file format. | Phase 0 checks that a catch-up URL plays before Phase 5c is built. |

## What already works

Back, Play/Pause, −10 s / +10 s, seek bar with hold-to-speed-up, mini progress bar, Next episode button, Episodes drawer with season chips, Channels drawer, Audio & Subtitles, Speed, Favorite (also Yellow), CH+/CH−, auto-resume with toast, Continue Watching saving, error screen with retry, and auto-retry on provider limits.

## What is missing

### Bugs found in the code

| # | Problem | Where |
|---|---|---|
| B1 | A stream that freezes **after** it started is never restarted. The 8 s watchdog only runs before the first picture, so a mid-stream freeze shows the spinner forever. | `player.js:477`, `:929` |
| B2 | Resuming a live channel after a long pause plays old buffered video, or stalls. | `player.js:68-71` |
| B3 | The Play key does not set `wantPlay` and does not retry on the error screen. | `player.js:842` |
| B4 | Each CH+/CH− press opens a new stream at once. Fast zapping hits the provider's connection limit. | `player.js:555-563` |
| B5 | Changing channel inside the player does not update "Recently watched". | `app.js:304` |
| B6 | The Channels drawer builds one button per channel. With thousands of channels it is slow. | `player.js:666-679` |
| B7 | Episodes keep the provider's order inside a season, not episode-number order, so "Next episode" can jump wrong. | `app.js` `showEpisodes` |
| B8 | An episode started from Continue Watching plays alone: no Next episode, no Episodes drawer, no autoplay. Progress saves only `name`, `icon`, `url`. When an episode finishes, the series disappears from the row instead of showing the next episode. | `app.js:264`, `api.js:268` |
| B9 | The Up Next card counts the seconds to the end of the file (up to 60 s) and plays the next episode only at the very end. Netflix gives a short countdown. | `player.js:263-274`, `:939` |
| B10 | Stopping the old stream fires `pause`, which can re-open the controls and move focus to Play during a switch. | `player.js:909-914` |

### Features compared with Netflix (films and series)

| Feature | Now | Phase |
|---|---|---|
| Up Next card with 10 s countdown, "Watch credits" | Partial (B9) | 3 |
| "Are you still watching?" after 3 autoplayed episodes | Missing | 3 |
| Start over (after an auto-resume) | Missing | 3 |
| Remember audio and subtitle language | Missing | 3 |
| Picture size (aspect ratio) | Missing | 2 |
| Skip intro (learned per series) | Missing | 5a |
| Info card while paused (plot, rating) | Missing | 5b |
| Subtitle size and background | Missing | 5c |
| Seek thumbnails | Missing | Not possible: no thumbnails from the provider |

### Features compared with a TV box (live channels)

| Feature | Now | Phase |
|---|---|---|
| Up/Down changes channel | Missing (shows the controls) | 4 |
| Type a channel number | Missing | 4 |
| Last channel (swap back) | Missing | 4 |
| Now / next programme, with progress | Missing (`API.getShortEpg` exists but the player never uses it) | 4 |
| Info key | Missing | 4 |
| Channel numbers in the Channels drawer | Missing | 4 |
| Catch-up: start the current programme over, replay earlier ones | Missing | 5d |
| Sleep timer | Missing | 5e |

## Phases

Each phase ends with a build, an install, the helper check (healthy state: port `18491` listening on the TV's LAN address and on `127.0.0.1`; `0.0.0.0` only if the TV reports no LAN address), and a test on the TV by the user before the next phase starts.

### Phase 0 — Test build (removed afterwards)

Facts needed before building:

1. **Does the picture follow a resized `<video>` box?** The Blue key steps through test sizes (fit, crop, zoom ×1.33, stretch, 4:3). Test on one native-player channel and one hls.js channel. If the picture does not follow, Phase 2 is cut down to what works.
2. **Real key codes of this remote.** A corner label shows the code of every key pressed. The user presses Info, 0–9, Red/Green/Blue, Play, Pause, Stop, FF, RW, CH+/−.
3. **Provider data.** Log once: do live items have `num`, `tv_archive` and `tv_archive_duration`; does `get_short_epg` return programmes; does `get_simple_data_table` return past programmes with `has_archive`; do episodes have `episode_num` and a plot.
4. **Catch-up playback.** Play one past programme through the proxy, as `/timeshift/{user}/{pass}/{minutes}/{YYYY-MM-DD:HH-MM}/{stream_id}.m3u8`, falling back to `.ts`. Record which format plays and whether it can be seeked.
5. **Subtitles.** On a film with subtitles, check whether `video::cue { font-size }` changes their size on the native player and on hls.js.

### Phase 1 — Reliability (bugs B1–B8, B10)

1. **Auto-reconnect (B1).** After playback has started: if the player waits more than 10 s, or time stops moving for 15 s while playing, restart the stream quietly ("Reconnecting…"), up to 3 times. Live restarts at the live point; films and episodes restart at the same position. Then show the error screen.
2. **Live resume (B2).** Resuming a live channel paused for more than 30 s reloads it at the live point.
3. **Play key (B3).** Sets `wantPlay`; on the error screen it retries.
4. **Zap delay (B4).** CH+/CH− (and Up/Down on live, Phase 4) update the channel number and name at once, and open the stream 450 ms after the last press.
5. **Recently watched (B5).** The live context gets an `onPlay` hook from `app.js`, so every channel change records the channel the same way as `pick()`.
6. **Fast Channels drawer (B6).** Draw about 300 channels around the current one.
7. **Episode order (B7).** Sort each season by `episode_num` (numeric). Keep each episode's plot and `series_id` on the episode object (needed by 5a and 5b).
8. **Continue Watching keeps the series (B8).** Save `series_id`, season, episode number and series name with the progress. Playing from the row reloads the series' episodes, so Next episode, Episodes and autoplay work. A finished episode is replaced in the row by the next episode, starting at 0:00.
9. **No focus jump on switch (B10).** Ignore `pause` events caused by releasing the old stream.

Files: `js/player.js`, `js/app.js`, `js/api.js`.

### Phase 2 — Picture

- Modes: **Fit** (whole picture), **Fill** (fill the screen, trim the edges), **Zoom** (remove black bars that are part of the broadcast, ×1.33), **Stretch**, **4:3**. The final list depends on Phase 0.
- A **Picture** button in the control row opens a drawer like Speed, with a short line under each mode. The **Blue** key cycles through the modes with a toast ("Picture: Fill").
- Saved in `localStorage` (`iptv_aspect`) and used for every channel, film and episode. Applied again when the video size changes (`loadedmetadata`, `resize`).
- How: set the `<video>` box size and position, plus `object-fit`. No transforms. Add `overflow: hidden` on `#player`.

Files: `js/player.js`, `index.html`, `css/styles.css`.

### Phase 3 — Films and series, Netflix-style

1. **Up Next card (B9).** Appears at the credits (last 5% of the length, between 20 and 60 s). It shows the next episode's image and title, a **Next episode** button with a 10 s fill countdown, and a **Watch credits** button. Left/Right moves between them; OK presses. The countdown holds while the controls or a menu are open, or while paused. At 0, or at the end of the file, the next episode plays. Seeking back before the credits hides the card. Season breaks work (S1 E10 → S2 E1).
2. **Are you still watching?** After 3 episodes in a row play with no key or pointer input, pause before the next one and show a card with **Continue watching** and **Back**. Back and Stop act as Back.
3. **Start over.** When an item auto-resumes, a **Start over** button appears in the control row for that item.
4. **Remember languages.** The chosen audio and subtitle language (or Off) is saved and applied to the next episode or film when that language exists.
5. **Last episode.** No Up Next card. At the end, return to the episodes page.

Files: `js/player.js`, `index.html`, `css/styles.css`, `js/api.js` (saving languages).

### Phase 4 — Live TV

1. **Up/Down changes channel** while the controls are hidden (Up = next, Down = previous), with the 450 ms zap delay. With the controls open, Up/Down moves focus as now. Films and series are unchanged: Up/Down shows the controls.
2. **Channel number.** Digits show a large number top right (`12–`). The jump happens 1.5 s after the last digit, or on OK. Back cancels. Matching uses the provider number (`num`), or the list position when the provider has no numbers. A number that is not in the current category is looked up in all channels, and the list switches to them. Unknown number: toast "No channel 123".
3. **Channel banner.** On every channel change, the number, name and now/next programme show for 4 s.
4. **Now / next.** The subtitle under the title reads `Now: <programme>  ·  21:00 <next programme>`. The live bar shows how far the current programme has run, with its start and end times. Reloaded when the programme ends. M3U playlists without a guide keep "LIVE".
5. **Last channel.** The **Green** key swaps to the previous channel, and pressing again swaps back.
6. **Info key.** Shows or hides the controls and programme info.
7. **Channels drawer.** Number before each name; the current channel is marked and focused.

Files: `js/player.js`, `js/keys.js`, `js/app.js`, `index.html`, `css/styles.css`.

### Phase 5 — Extras

**5a. Learned Skip intro (series only).**
- Learning: in the first 5 minutes of an episode, a forward jump (FF/scrub, +10 s, or the seek bar) that lands between 0:20 and 6:00 and moves at least 30 s is saved for that series (`series_id`) as `{ from, to }`. A later skip updates it.
- Showing: on later episodes of that series, a **Skip intro** button appears bottom right from `from − 5 s` until `to − 5 s`. While the controls are hidden it has focus, so OK presses it; pressing it jumps to `to`. It hides on its own after that window.
- Never on live, films, or the first episode before anything is learned.

**5b. Pause info card.**
- 10 s after a pause with no key pressed, the controls hide and a card appears bottom left. Films and series show title, year, rating, genre and plot (`get_vod_info` for films, the episode plot for series). Live shows the channel and the current programme.
- Any key hides the card and brings the controls back. Play resumes. No full-screen dimming.

**5c. Subtitle size.**
- The Audio & Subtitles drawer gets a third column, **Style**: Small / Medium / Large, and Background on/off. Saved in `localStorage` and applied with `video::cue`.
- If Phase 0 shows the native player ignores `::cue`, the column only shows for hls.js streams, with a note.

**5d. Catch-up TV** (only on channels the provider marks `tv_archive`, in the format Phase 0 confirms).
- **Start over:** on a catch-up channel, a **Start over** button in the live control row, or the RW key, plays the current programme from its start.
- **Guide:** a **Guide** button opens a drawer for the current channel. It lists past programmes that have an archive (by day, newest first), the programme on now, and the next ones.
- OK on a past programme plays it like a film: seek bar, ±10 s, pause, and resume. The title shows the channel and the programme time. Back returns to the live channel. A **Live** button jumps back to live.
- Channels without catch-up show neither button.

**5e. Sleep timer.**
- A **Sleep** button opens a drawer: Off, 30, 60, 90, 120 minutes, and End of this episode or film. The button label shows the time left ("Sleep 42m").
- 60 s before the end, a card says "Stopping in 60 s" with a **Keep watching** button; any key cancels the timer.
- At 0: save progress, stop playback, and go back to the home screen. Apps cannot switch the TV off.

Files: `js/player.js`, `js/api.js` (catch-up URLs, archive guide, intro memory), `js/app.js` (episode plot, `series_id`), `index.html`, `css/styles.css`.

### Phase 6 — Look (after the function is done)

Redesign the control bar, cards and drawers within the plane limits above.

## Control row after all phases

| Film / episode | Live |
|---|---|
| Left: Play, −10 s, +10 s, Next episode (series), Start over (after resume) | Left: Play, Start over (catch-up channels) |
| Right: Episodes (series), Audio & Subtitles, Picture, Speed, Sleep, Favorite | Right: Channels, Guide (catch-up channels), Audio & Subtitles, Picture, Sleep, Favorite |

Floating, outside the row: Up Next card, Skip intro, Are you still watching, pause info card, sleep warning, channel number.

## Remote keys after all phases

| Key | Films and series | Live |
|---|---|---|
| OK | Show controls / press the focused button / Skip intro when shown | Show controls / press the focused button / confirm a channel number |
| Left / Right (controls hidden) | Scrub | Show controls |
| Up / Down (controls hidden) | Show controls | **Next / previous channel** (450 ms delay) |
| Back | Close card or menu → cancel scrub → leave player | Cancel number → close menu → leave player (from a catch-up programme: back to live) |
| Play / Pause / Stop | Play / Pause / Leave | Same; Play after a long pause jumps to live |
| FF / RW | Scrub | RW = Start over the programme (catch-up channels) |
| CH+ / CH− | Next / previous episode | Next / previous channel (450 ms delay) |
| 0–9 | — | Channel number |
| Info | Show / hide controls | Show / hide controls and programme info |
| Red | Audio & Subtitles | Audio & Subtitles |
| Green | — | Last channel |
| Yellow | Favorite | Favorite |
| Blue | Next picture mode | Next picture mode |

The final key codes come from Phase 0.

## Test checklist (on the TV, per phase)

- **Phase 1:** unplug the network for 20 s during a channel and a film; both come back by themselves. Zap 10 times fast with CH+; no 429/458 error, and the last channel plays. Start an episode from Continue Watching; Next episode and Episodes work. Finish an episode; Continue Watching shows the next one.
- **Phase 2:** each mode on a 16:9 channel, a 4:3 channel and a film; the picture stays visible in every mode; the mode is kept after leaving and reopening the app.
- **Phase 3:** let 3 episodes autoplay without touching the remote; the 4th asks "Are you still watching?". Watch credits, then the next episode plays at the end. Change audio language; the next episode keeps it.
- **Phase 4:** Up/Down zaps on live and shows controls on a film. Type 3 digits; the right channel opens. Green swaps back and forth. Now/next and its progress match the provider guide.
- **Phase 5:** skip an intro once, then the next episode offers Skip intro at the right time. Pause 10 s; the info card shows. Change subtitle size. Start over, and a past programme from the Guide, play and seek. A 30 min sleep timer warns at 60 s and stops.
