<template>
    <div class="doc-layout" v-if="App.ready">
        <nav class="doc-toc">
            <div class="toc-section-label">Tools</div>
            <ul>
                <li v-for="ch in toolsChapters" :key="ch.id">
                    <a :href="'#' + ch.id" :class="{ active: activeId === ch.id }" @click.prevent="scrollTo(ch.id)">{{ ch.title }}</a>
                </li>
            </ul>

            <div class="toc-section-label">Guides</div>
            <ul>
                <li v-for="ch in guidesChapters" :key="ch.id">
                    <a :href="'#' + ch.id" :class="{ active: activeId === ch.id }" @click.prevent="scrollTo(ch.id)">{{ ch.title }}</a>
                </li>
            </ul>

            <div class="toc-section-label">Reference</div>
            <ul>
                <li v-for="ch in referenceChapters" :key="ch.id">
                    <a :href="'#' + ch.id" :class="{ active: activeId === ch.id }" @click.prevent="scrollTo(ch.id)">{{ ch.title }}</a>
                </li>
            </ul>
        </nav>

        <main class="doc-content" ref="contentEl">

            <!-- ============ TOOLS ============ -->

            <section id="tool-game-info">
                <h1>Game Info</h1>
                <p>
                    Set the game's <strong>title</strong> and upload a <strong>badge image</strong>
                    that represents the game. The badge image is displayed in achievement popups
                    and game info notifications.
                </p>
                <p>
                    Changes are saved manually with the Save button.
                </p>
            </section>

            <section id="tool-game-behavior">
                <h1>Game Behavior</h1>
                <p>
                    Configure runtime behavior for the current game. Only available for
                    <strong>.raflash</strong> files &mdash; use "Convert to .raflash" from the
                    devtools menu if you're working with a plain .swf.
                </p>
                <dl>
                    <dt>Hash Override</dt>
                    <dd>
                        Override the hash used to identify this game. Leave empty to use the
                        .raflash file's own computed hash. Useful when a game has multiple
                        versions that should share the same achievement set.
                    </dd>

                    <dt>Origin URL</dt>
                    <dd>
                        The original URL where the SWF was hosted. Used to defeat sitelocks
                        that prevent the game from running outside its original domain, and to
                        load external resources relative to the original host.
                    </dd>

                    <dt>Scale Mode</dt>
                    <dd>
                        Controls how the game scales within the Flash Player window.
                        Options: No Scale, Show All, No Border, Exact Fit, or Neutral (let the game decide).
                    </dd>

                    <dt>Alignment</dt>
                    <dd>
                        Controls where the game is anchored within the player window.
                        Options: Top Left, Top Center, Top Right, Center Left, Center, Center Right,
                        Bottom Left, Bottom Center, Bottom Right, or Neutral (let the game decide).
                    </dd>
                </dl>
            </section>

            <section id="tool-network-behavior">
                <h1>Network Behavior</h1>
                <p>
                    Configure how the game's HTTP requests are handled. By default, all external
                    network requests are blocked. Use this tool to define custom response rules
                    for specific URLs that the game expects to reach.
                </p>
                <p>
                    Each entry has a <strong>URL pattern</strong> to match against and a
                    <strong>response action</strong> that determines what the game receives.
                    Available response actions:
                </p>
                <dl>
                    <dt>Block</dt>
                    <dd>Returns an empty response (the default for unhandled requests).</dd>

                    <dt>Text</dt>
                    <dd>Returns a custom text response body that you define.</dd>

                    <dt>File</dt>
                    <dd>Serves the contents of a file from the .raflash archive as the response.</dd>
                </dl>
                <p>
                    Entries can be reordered via drag-and-drop. Use the <strong>+</strong> button
                    to add new rules. Requests that don't match any rule are tagged as
                    <strong>UNHANDLED</strong> in the Event Log.
                </p>
                <p>
                    Only available for <strong>.raflash</strong> files. The <strong>Origin URL</strong>
                    field (also in Game Behavior) controls the base URL used for resolving relative
                    resource paths.
                </p>
            </section>

            <section id="tool-asset-list">
                <h1>Asset List</h1>
                <p>
                    The main achievement management view. Lists all assets for the current game.
                    Tabs at the top switch between <strong>Achievements</strong> and <strong>Rich Presence</strong> assets.
                    A dropdown filter narrows by state: All, Active, Inactive, Triggered, or Modified.
                </p>
                <p>
                    The header shows the Game ID, total achievement count, and total points.
                    The <strong>Processing Active</strong> checkbox controls whether the engine is evaluating
                    conditions each frame. Use the <strong>Activate/Deactivate</strong> button to toggle
                    the state of selected assets in bulk.
                </p>
                <p>
                    Use <strong>New</strong> to create an asset, <strong>Clone</strong> to duplicate the selection,
                    and <strong>Delete</strong> to remove selected assets. Double-click any asset to open it
                    in the <strong>Asset Editor</strong> (for achievements) or
                    <strong>Rich Presence Editor</strong> (for rich presence).
                </p>
                <p>
                    <strong>Save</strong> writes modified assets to the game file. <strong>Reset</strong>
                    discards unsaved changes and reloads from disk.
                </p>
                <p>
                    Assets with negative IDs are local/unpromoted &mdash; they only exist in your local game file
                    and haven't been submitted to a server yet.
                </p>
            </section>

            <section id="tool-asset-editor">
                <h1>Asset Editor</h1>
                <p>
                    Opens when you double-click an achievement in the Asset List.
                    The header contains the asset's <strong>Title</strong>, <strong>Description</strong>,
                    <strong>ID</strong>, <strong>Type</strong>, <strong>Points</strong>, and a
                    <strong>Badge Image</strong>.
                </p>

                <h2>Type</h2>
                <p>
                    Classifies the achievement for display purposes. Options:
                </p>
                <dl>
                    <dt>(None)</dt>
                    <dd>Standard achievement with no special classification.</dd>
                    <dt>Missable</dt>
                    <dd>Can be permanently missed during a playthrough.</dd>
                    <dt>Progression</dt>
                    <dd>Unlocked through normal game progression.</dd>
                    <dt>Win</dt>
                    <dd>Awarded for completing or winning the game.</dd>
                </dl>

                <h2>Points</h2>
                <p>
                    Point value for the achievement. Available values:
                    0, 1, 2, 3, 4, 5, 10, 25, 50, 100.
                </p>

                <h2>Groups</h2>
                <p>
                    Each achievement has a <strong>Core</strong> group and optional <strong>Alt</strong>
                    groups. The Core group's requirements must all be satisfied. Alt groups provide
                    alternative paths &mdash; if any single Alt group is fully satisfied, it counts as
                    meeting that part of the achievement. Use the <strong>+</strong> / <strong>-</strong>
                    buttons to add or remove Alt groups. The Core group cannot be removed.
                </p>

                <h2>Requirements</h2>
                <p>
                    Each group contains a table of requirements. A requirement compares two values
                    using DSL expressions. The columns are:
                </p>
                <dl>
                    <dt>Flag</dt>
                    <dd>
                        Modifies how the requirement is evaluated. Leave blank for a normal condition.
                        Available flags:
                        <table>
                            <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
                            <tbody>
                                <tr><td><code>Pause If</code></td><td>Pauses the entire group while this condition is true. Hits are frozen, not reset.</td></tr>
                                <tr><td><code>Reset If</code></td><td>Resets all hit counts in the group to zero when this condition is true.</td></tr>
                                <tr><td><code>Reset Next If</code></td><td>Resets only the <em>next</em> requirement's hit count when true.</td></tr>
                                <tr><td><code>Add Source</code></td><td>Adds this requirement's value to a running accumulator instead of comparing.</td></tr>
                                <tr><td><code>Sub Source</code></td><td>Subtracts this requirement's value from the accumulator.</td></tr>
                                <tr><td><code>Add Hits</code></td><td>Adds this requirement's hit count to the next terminal requirement's count.</td></tr>
                                <tr><td><code>Sub Hits</code></td><td>Subtracts this requirement's hit count from the next terminal requirement's count.</td></tr>
                                <tr><td><code>And Next</code></td><td>Combines with the next requirement using AND &mdash; both must be true in the same frame for either to count a hit.</td></tr>
                                <tr><td><code>Or Next</code></td><td>Combines with the next requirement using OR &mdash; either being true counts a hit.</td></tr>
                                <tr><td><code>Measured</code></td><td>Tracks this requirement's progress as a visible progress indicator.</td></tr>
                                <tr><td><code>Measured If</code></td><td>Only shows the Measured progress when this condition is true.</td></tr>
                                <tr><td><code>Trigger</code></td><td>Marks a requirement that must be true at the moment the achievement triggers, but doesn't accumulate hits.</td></tr>
                            </tbody>
                        </table>
                    </dd>

                    <dt>Type A / Type B</dt>
                    <dd>
                        <strong>Value</strong> reads the current value of the expression.
                        <strong>Delta</strong> reads the value from the <em>previous</em> frame,
                        useful for detecting changes (e.g. <code>Delta &lt; Value</code> means "increased this frame").
                    </dd>

                    <dt>Evaluate A / Evaluate B</dt>
                    <dd>DSL expressions evaluated against the game state. Side A is typically the game value; side B is often a constant.</dd>

                    <dt>Cmp</dt>
                    <dd>Comparison operator: <code>==</code>, <code>&lt;</code>, <code>&lt;=</code>, <code>&gt;</code>, <code>&gt;=</code>, <code>!=</code>.</dd>

                    <dt>Hits</dt>
                    <dd>
                        The <strong>maxHits</strong> target. When set to 0, the condition must be true
                        continuously. When set to N, the condition needs to have been true for N total frames
                        (not necessarily consecutive). The number in parentheses shows the <strong>effective hits</strong>
                        &mdash; the requirement's own hits plus any contiguous Add Hits/Sub Hits chain above it.
                    </dd>
                </dl>

                <h2>Requirement Actions</h2>
                <p>
                    The footer provides buttons to <strong>New</strong> / <strong>Remove</strong> requirements,
                    <strong>Copy</strong> / <strong>Paste</strong> via the clipboard (as JSON),
                    and <strong>Move Up</strong> / <strong>Move Down</strong> to reorder.
                    The <strong>Active</strong> checkbox in the panel header toggles whether this
                    achievement is being evaluated.
                </p>
                <p>
                    Clicking <strong>Save</strong> writes the asset to the game file and resets all
                    accumulated hit counts to zero, giving a clean slate for the next evaluation pass.
                </p>
            </section>

            <section id="tool-rich-presence">
                <h1>Rich Presence Editor</h1>
                <p>
                    Opens when you double-click a Rich Presence asset in the Asset List.
                    Rich Presence defines a text string that describes what the player is currently
                    doing in the game, built from live game state using DSL expressions.
                </p>
                <p>
                    Write a formula in the text area. The <strong>Preview</strong> row at the top
                    shows the live evaluated result, updating every 500ms.
                </p>
                <p>
                    The <strong>Active</strong> checkbox controls whether the engine evaluates this
                    rich presence. Changes to the formula are kept in memory as you type.
                    Click <strong>Save</strong> to persist changes to the game file.
                </p>
            </section>

            <section id="tool-memory-explorer">
                <h1>Memory Explorer</h1>
                <p>
                    Evaluates a DSL expression and displays all results as a table.
                    The primary tool for inspecting game state. Type a formula like
                    <code>stage.player</code> and click <strong>Evaluate</strong> to see all properties and values.
                </p>
                <p>Has four modes accessible via the dropdown button:</p>
                <dl>
                    <dt>Evaluate</dt>
                    <dd>Run the expression and show all results fresh.</dd>

                    <dt>Changed</dt>
                    <dd>
                        Re-evaluate and compare with the previous results. Rows are marked as
                        <strong>added</strong>, <strong>removed</strong>, or <strong>modified</strong>
                        to show what changed between evaluations.
                    </dd>

                    <dt>Remains</dt>
                    <dd>
                        Keep only rows whose keys persist across evaluations.
                        Unchanged rows appear normal; changed values are highlighted green with a <strong>+</strong> marker.
                        Clicking Remains repeatedly narrows the set to only the most stable keys.
                    </dd>

                    <dt>Leaves</dt>
                    <dd>
                        The inverse of Remains &mdash; shows rows whose keys disappeared between evaluations.
                        Useful for finding properties that are transient or get removed.
                    </dd>
                </dl>

                <h2>Navigation</h2>
                <p>
                    The <strong>&lt;</strong> / <strong>&gt;</strong> history buttons let you step back and
                    forward through previous evaluations (up to 50 entries).
                </p>
                <p>
                    Rows whose values look like <code>[MovieClip ...N]</code>, <code>[Object ...N]</code>,
                    or <code>[Array ...N]</code> are <strong>expandable</strong> &mdash; double-click them
                    to drill into that object. The expression updates automatically
                    (appending <code>.key</code> or <code>[index]</code>) and re-evaluates.
                </p>

                <h2>Editing Values</h2>
                <p>
                    Rows with simple values (numbers, strings, booleans) show a pencil button on hover.
                    Click it to open an edit popup where you can change the value directly in the
                    running game. Functions, TextFields, Dates, MovieClips, Objects, and Arrays cannot be edited.
                </p>

                <p>
                    All modes support a text filter input to narrow results by matching
                    against the full row content (both keys and values).
                </p>
            </section>

            <section id="tool-memory-search">
                <h1>Memory Search</h1>
                <p>
                    Recursively searches the game's entire stage tree for matching properties.
                    Returns the full path to each match, which you can then use in DSL expressions.
                </p>
                <p>
                    The optional <strong>Starting path</strong> field lets you narrow the search to
                    a subtree (e.g. <code>root.enemies</code>) instead of scanning everything.
                </p>
                <p>Two search modes are available via the radio toggle:</p>
                <dl>
                    <dt>Value</dt>
                    <dd>
                        Find properties whose current value matches the search term.
                        Supports wildcards: <code>M*io</code> matches "Mario".
                    </dd>

                    <dt>Name</dt>
                    <dd>Find properties whose name contains the search substring (case-insensitive).</dd>
                </dl>
                <p>
                    The search button shows the result count in parentheses.
                    Subsequent searches narrow within the previous result set &mdash; use <strong>Reset</strong> to clear
                    and search the full tree again.
                </p>
                <p>
                    Each result row shows the full path and a <strong>live value</strong> column
                    that updates every second (for the first 100 results). The path cells are
                    selectable so you can copy them directly into DSL expressions.
                </p>
            </section>

            <section id="tool-memory-watch">
                <h1>Memory Watch</h1>
                <p>
                    Monitors a DSL expression continuously, logging its value every frame.
                    Enter a formula and click <strong>Watch</strong> to start.
                </p>
                <p>
                    The mode is detected automatically from the expression's return type:
                </p>
                <dl>
                    <dt>Value mode</dt>
                    <dd>
                        When the expression returns a simple value. New entries are only added
                        when the value changes, keeping the log clean. Consecutive identical values
                        are collapsed into a single entry with a <strong>&times;N</strong> count.
                    </dd>

                    <dt>Structure mode</dt>
                    <dd>
                        When the expression returns properties. Tracks which keys appear over time
                        and marks removed keys with strikethrough.
                    </dd>
                </dl>
                <p>
                    Use <strong>Clear</strong> to clear the visible log without resetting the watch
                    &mdash; the watch continues running and previously seen keys are still remembered,
                    so only genuinely new keys will appear.
                    Click <strong>Stop</strong> to end monitoring.
                </p>
            </section>

            <section id="tool-resource-explorer">
                <h1>Resource Explorer</h1>
                <p>
                    Performs a static analysis of the game SWF and lists embedded resources.
                    Unlike Memory Explorer which inspects live runtime state, Resource Explorer
                    reads the SWF file itself to extract data that exists before the game runs.
                </p>
                <p>Four categories of resources are extracted:</p>
                <dl>
                    <dt>Strings</dt>
                    <dd>String constants embedded in the SWF bytecode.</dd>

                    <dt>Frame Labels</dt>
                    <dd>Named frames in the game's timeline. Useful for understanding game states and transitions.</dd>

                    <dt>Exports</dt>
                    <dd>Symbols exported from the SWF library (movie clips, sounds, etc.).</dd>

                    <dt>Text Fields</dt>
                    <dd>
                        Static text fields with their variable bindings. Shows the variable name
                        and, when present, the initial text content.
                    </dd>
                </dl>
                <p>
                    Use the category dropdown to filter by type, and the text filter to search
                    within results. This tool is especially helpful for discovering property
                    names, game states, and asset identifiers before diving into live exploration.
                </p>
            </section>

            <section id="tool-recorded-test">
                <h1>Recorded Test</h1>
                <p>
                    Records and replays scripted interactions against the live game as
                    <strong>.ratest</strong> files. Use it to capture a sequence of clicks,
                    method calls, and assertions that reproduces a given scenario &mdash; then
                    replay it later to confirm an achievement still unlocks, a bug is still
                    fixed, or the game still behaves as expected after changes.
                </p>
                <p>
                    The window has three parts: a <strong>file list</strong> on the left
                    showing every <code>.ratest</code> saved for the current game's hash, a
                    <strong>step log</strong> on the right showing the steps of the
                    selected recording, and a <strong>footer</strong> with the active
                    action buttons.
                </p>

                <h2>Header Toggles</h2>
                <dl>
                    <dt>Restart</dt>
                    <dd>
                        When <strong>Yes</strong>, playback resets the game to its initial
                        state before running. When <strong>No</strong>, the recording plays
                        against whatever state the game is currently in &mdash; useful for
                        composing steps on top of manual setup.
                    </dd>

                    <dt>Achievements</dt>
                    <dd>
                        When <strong>Yes</strong>, recording captures achievement triggers
                        as <code>achievement &lt;id&gt;</code> lines, and playback verifies
                        those achievements fire within 5 seconds at the corresponding point.
                        When <strong>No</strong>, new recordings skip them and playback
                        ignores any that are already present. This toggle is per-session
                        and resets to Yes on every launch.
                    </dd>

                    <dt>Realtime</dt>
                    <dd>
                        Picks how clicks are spaced on playback. When <strong>Yes</strong>
                        (action games), recording inserts <code>pause &lt;ms&gt;</code> lines
                        between clicks to preserve real-world timing. When <strong>No</strong>
                        (turn-based games), recording inserts <code>wait &lt;path&gt;</code>
                        so playback waits for the next clicked element to become visible
                        before proceeding &mdash; resilient to load times and animations.
                    </dd>
                </dl>

                <h2>Recording</h2>
                <dl>
                    <dt>New Record</dt>
                    <dd>
                        Starts a fresh recording. A new entry named
                        <code>New Recording N.ratest</code> is auto-added to the file list
                        and selected. Interact with the game normally &mdash; clicks, value
                        changes, and (if the Achievements toggle is Yes) achievement
                        triggers are appended to the step log as they happen.
                        Click <strong>Stop Recording</strong> when done, then <strong>Save</strong>
                        to persist to disk.
                    </dd>

                    <dt>Continue Recording</dt>
                    <dd>
                        Right-click an existing file and choose Continue Recording to
                        append new steps to the end of that file's script. The previously
                        recorded steps stay visible; new interactions are added below them.
                    </dd>

                    <dt>Rerecord</dt>
                    <dd>
                        Right-click an existing file and choose Rerecord to play back the
                        recording <em>and</em> capture any new events that happen during
                        playback. New clicks or unexpected achievements are spliced into
                        the script at the current playback position. Pause the playback to
                        insert steps at a specific point. Commit the modified script with
                        <strong>Save</strong>.
                    </dd>
                </dl>

                <h2>Playback</h2>
                <p>
                    Double-click a file (or right-click &rarr; Play) to run the selected
                    recording. The currently-executing step is highlighted in the log,
                    and each step reports <code>pass</code>, <code>fail</code>, or
                    <code>ok</code> as it completes. The final row summarizes the run as
                    <code>Passed N/M</code> or <code>Failed N/M</code>.
                </p>
                <dl>
                    <dt>Stop</dt>
                    <dd>Aborts the playback immediately.</dd>
                    <dt>Pause / Resume</dt>
                    <dd>
                        Freezes playback between steps. While paused, you can interact with
                        the game manually &mdash; in Rerecord mode, those interactions get
                        captured and spliced into the script.
                    </dd>
                    <dt>Step</dt>
                    <dd>Visible only while paused. Runs the next step, then stays paused.</dd>
                </dl>

                <h2>Editing Steps</h2>
                <p>
                    When not recording or playing, each step row shows inline action buttons
                    on hover:
                </p>
                <dl>
                    <dt>&#9650; / &#9660;</dt>
                    <dd>Move the step up or down in the script.</dd>
                    <dt>&#10005; (Edit)</dt>
                    <dd>
                        Open a popup to edit the step's source text directly. The editor
                        also has a <strong>Delete</strong> button for removing the step.
                    </dd>
                    <dt>&#65291; (Insert)</dt>
                    <dd>Add a new blank step directly below the current one and open the edit popup.</dd>
                </dl>
                <p>
                    The <strong>Filter steps...</strong> input at the bottom of the log
                    narrows rows by substring match on the step source and label.
                    The summary row (the pass/fail outcome) is always visible.
                </p>
                <p>
                    Unsaved edits on a file are indicated with a yellow <code>*</code>
                    next to its name. Switching to another file stashes your edits
                    in memory so you can return later without losing work.
                </p>

                <h2>File Management</h2>
                <p>
                    Right-click a file for the context menu:
                </p>
                <dl>
                    <dt>Play</dt>
                    <dd>Run the selected recording.</dd>
                    <dt>Continue Recording</dt>
                    <dd>Append new steps to the end of the selected recording.</dd>
                    <dt>Rerecord</dt>
                    <dd>Replay while capturing new events to splice in at the current position.</dd>
                    <dt>Rename</dt>
                    <dd>
                        Edit the filename inline. Renames are <strong>pending</strong> until
                        the row is selected and <strong>Save</strong> is clicked &mdash; you
                        can queue multiple renames and flush them one at a time.
                    </dd>
                    <dt>Discard changes</dt>
                    <dd>
                        Reload the file from disk, throwing away any unsaved edits or
                        pending rename. Prompts for confirmation.
                    </dd>
                    <dt>Delete</dt>
                    <dd>Remove the file from disk immediately.</dd>
                </dl>
                <p>
                    The <strong>Copy</strong> button above the step log copies the
                    current step script to the clipboard as <code>.ratest</code> source
                    text, handy for pasting into bug reports or version-controlled fixtures.
                </p>
                <p>
                    Recordings are tied to a game by its hash, so the file list only shows
                    scripts that target the game currently loaded. A "No game loaded"
                    indicator appears when Flash isn't connected.
                </p>
            </section>

            <section id="tool-code-notes">
                <h1>Code Notes</h1>
                <p>
                    A table of annotations that map DSL paths to human-readable descriptions.
                    Each note has a <strong>Note</strong> column (description), a <strong>Path</strong>
                    column (a DSL expression), and a live <strong>Value</strong> column that polls
                    the game every second for visible rows.
                </p>
                <p>
                    Code notes serve as a reference sheet &mdash; document what you've discovered about the game's
                    memory layout so you don't have to re-explore it later.
                </p>
                <p>
                    Use the <strong>Search</strong> input to filter notes by description. The
                    <strong>&#9650;</strong> / <strong>&#9660;</strong> buttons reorder notes, and the
                    <strong>x</strong> button deletes a note. Click <strong>+ Add</strong> to create
                    a new empty note.
                </p>
            </section>

            <section id="tool-event-log">
                <h1>Event Log</h1>
                <p>
                    A live stream of events from the RAFlash engine. Each entry shows a
                    <strong>timestamp</strong>, <strong>source</strong> (which component emitted it),
                    and a <strong>message</strong>. Entries are color-coded by severity: normal for
                    info, yellow for warnings, and red for errors.
                </p>
                <p>
                    Use the text filter to narrow entries by source or message content.
                    Click <strong>Clear</strong> to reset the log. The log auto-scrolls to
                    new entries only when you're already at the bottom &mdash; scrolling up
                    to review older entries won't be interrupted.
                </p>
            </section>

            <section id="tool-settings">
                <h1>Settings</h1>
                <p>
                    Configure RAFlash behavior. Accessed from the devtools menu gear icon.
                    Settings are organized into two tabs:
                </p>

                <h2>Firmware</h2>
                <p>
                    Controls how the firmware loads and instruments the game. Three modes are available:
                </p>
                <dl>
                    <dt>Child Injection</dt>
                    <dd>
                        Flash Player launches the game directly. RAEngine injects bytecode at frame 1
                        that loads the firmware as a child clip of the game's <code>_root</code>, so the game
                        runs as the true <code>_level0</code>. This gives the best compatibility since the game
                        believes it owns the stage.
                    </dd>

                    <dt>Parent Wrapper</dt>
                    <dd>
                        Flash Player launches the firmware, which then loads the game into a child clip.
                        Some games may need compatibility fixes (see below). Click <strong>Settings &rarr;</strong>
                        to configure:
                        <ul>
                            <li><strong>Fix TextField variable bindings</strong> &mdash; Restores two-way AS2 TextField
                            variable bindings that break under <code>loadMovie()</code>.</li>
                            <li><strong>Fix Sound attachSound scope</strong> &mdash; Fixes sounds that fail because
                            <code>attachSound</code> looks in the firmware's library instead of the game's.</li>
                        </ul>
                    </dd>

                    <dt>No Firmware</dt>
                    <dd>
                        Flash Player launches the game directly with no firmware. No devtools or achievement support.
                        Useful for testing how the game runs without any instrumentation.
                    </dd>
                </dl>
                <p>
                    Mode changes apply on the next game launch.
                </p>

                <h2>AVM1</h2>
                <p>
                    Controls how AVM1 (AS2) achievements are executed. Two modes are available:
                </p>
                <dl>
                    <dt>Interpreter</dt>
                    <dd>
                        Evaluates achievement bytecode in the firmware's ActionScript interpreter.
                        The <strong>Enable fast-path evaluation</strong> toggle enables an optimized
                        evaluation path for better performance.
                    </dd>

                    <dt>Compiled</dt>
                    <dd>
                        Compiles achievements to native AVM1 bytecode that runs directly in Flash Player.
                        Supports rich presence and devtools. Offers the best performance.
                    </dd>
                </dl>

                <h2>Developer</h2>
                <dl>
                    <dt>Enable Benchmarking</dt>
                    <dd>
                        Profiles firmware execution time per frame. When enabled, a <strong>Benchmarking</strong>
                        button appears in the devtools menu. Has a minor performance cost when active.
                    </dd>

                    <dt>Open RAFlash dev tools when game opens</dt>
                    <dd>
                        Automatically opens the devtools menu every time a game launches. Useful for sitelocked
                        or immediately-crashing games where you can't press F12 in time.
                    </dd>
                </dl>
            </section>

            <section id="tool-benchmarking">
                <h1>Benchmarking</h1>
                <p>
                    A developer tool that profiles firmware execution time per frame. Only visible in
                    the devtools menu when <strong>Enable Benchmarking</strong> is turned on in Settings.
                </p>
                <p>
                    Displays a table of timing data with columns for the <strong>Kind</strong> of operation,
                    <strong>Current</strong> frame time, <strong>Min</strong>, and <strong>Max</strong> observed times.
                    Times are color-coded by severity. Use the <strong>Reset</strong> button to clear
                    accumulated min/max values and start fresh.
                </p>
            </section>

            <!-- ============ GUIDES ============ -->

            <section id="guide-creating-achievement">
                <h1>Creating an Achievement</h1>
                <ol>
                    <li>Press <kbd>F12</kbd> to open the Devtools menu.</li>
                    <li>Open <strong>Asset List</strong> and click <strong>New</strong> to create a new asset.</li>
                    <li>Give it a title and description.</li>
                    <li>In the Asset Editor, add one or more <strong>requirements</strong>. Each requirement compares two DSL expressions that should match when the achievement should unlock.</li>
                    <li>Play the game normally. When all conditions are true at the same time, the achievement triggers.</li>
                </ol>
                <p>
                    If you're unsure what path to use, start with Memory Explorer or Memory Search
                    to discover the game's stage structure.
                </p>
            </section>

            <section id="guide-finding-value">
                <h1>Finding a Value in Memory</h1>
                <p>
                    When you can see a value on screen (like a score of 1500) but don't know its path:
                </p>
                <ol>
                    <li>Open <strong>Memory Search</strong> from the Devtools menu.</li>
                    <li>Make sure <strong>Value</strong> mode is selected.</li>
                    <li>Type the value you see (e.g. <code>1500</code>) and click <strong>Search</strong>.</li>
                    <li>If too many results appear, change the value in-game (e.g. score becomes 1600), then search again with the new value. The results narrow to only paths that matched both times.</li>
                    <li>The remaining path(s) are your answer &mdash; use them in DSL expressions.</li>
                </ol>
            </section>

            <section id="guide-finding-property">
                <h1>Finding a Property by Name</h1>
                <p>
                    When you suspect a property exists but don't know where:
                </p>
                <ol>
                    <li>Open <strong>Memory Search</strong> and switch to <strong>Name</strong> mode.</li>
                    <li>Type a substring like <code>health</code> or <code>score</code>.</li>
                    <li>All properties whose names contain that substring will appear with their full paths.</li>
                </ol>
            </section>

            <section id="guide-exploring-structure">
                <h1>Exploring Game Structure</h1>
                <p>
                    To understand how a game's stage is organized:
                </p>
                <ol>
                    <li>Open <strong>Memory Explorer</strong> and evaluate <code>stage</code> to see all top-level properties.</li>
                    <li>Drill deeper by evaluating paths like <code>stage.gameWorld</code> or <code>stage.player</code>.</li>
                    <li>Use <strong>Changed</strong> mode to see what changes between evaluations as you play.</li>
                    <li>Use <strong>Remains</strong> mode repeatedly to find the most stable properties (ones that persist across frames).</li>
                    <li>Document useful paths in <strong>Code Notes</strong> so you can reference them later.</li>
                </ol>
            </section>

            <section id="guide-tracking-changes">
                <h1>Tracking Changing Values</h1>
                <p>
                    To watch a value change in real time as you play:
                </p>
                <ol>
                    <li>Open <strong>Memory Watch</strong> from the Devtools menu.</li>
                    <li>Enter a formula like <code>stage.player.health</code> and click <strong>Watch</strong>.</li>
                    <li>Play the game &mdash; the log updates whenever the value changes.</li>
                    <li>This helps verify that your path expression is correct and understand when values update.</li>
                </ol>
            </section>

            <section id="guide-recording-test">
                <h1>Recording a Test</h1>
                <p>
                    To capture a reproducible run that unlocks an achievement (or otherwise
                    exercises the game) and replay it later:
                </p>
                <ol>
                    <li>Open <strong>Recorded Test</strong> from the Devtools menu.</li>
                    <li>
                        Confirm the <strong>Achievements</strong> toggle is set to Yes if you
                        want achievement triggers to be captured and verified on playback.
                    </li>
                    <li>
                        Pick a <strong>Realtime</strong> mode. For action games leave it Yes
                        so click timing is preserved; for turn-based games flip it to No so
                        playback waits for each clicked element to appear instead of relying
                        on fixed delays.
                    </li>
                    <li>Click <strong>New Record</strong>. A new entry appears in the file list.</li>
                    <li>
                        Play the game through the scenario you want to capture &mdash; clicks
                        and value changes are logged as steps as they happen.
                    </li>
                    <li>Click <strong>Stop Recording</strong>, then <strong>Save</strong> to persist the script to disk.</li>
                    <li>
                        Play it back anytime with a double-click (or right-click &rarr; Play).
                        The run reports Passed or Failed at the end.
                    </li>
                </ol>
                <p>
                    To refine a recording afterwards &mdash; reorder, edit, insert, or delete
                    steps &mdash; use the inline action buttons that appear on each row when
                    not actively recording or playing. Use <strong>Rerecord</strong> (from the
                    right-click menu) to replay a script while splicing in additional events
                    captured during paused playback.
                </p>
            </section>

            <!-- ============ REFERENCE ============ -->

            <section id="ref-dsl-syntax">
                <h1>DSL Syntax</h1>
                <p>
                    The Formula DSL is a collection-oriented query language. Its core principle:
                    <strong>every value is an array</strong>, and operations broadcast over collections.
                </p>

                <h2>Property Access</h2>
                <p>
                    Dot notation traverses the stage tree. Unlike traditional languages,
                    <code>objects.property</code> returns <strong>all matching values from all objects</strong> in the collection.
                </p>
                <pre>stage.enemies.health     // array of all enemy health values
stage.player.x           // [playerX]
stage.level.coins        // [coinCount]</pre>

                <h2>Array Indexing</h2>
                <pre>stage.inventory[0]       // first inventory item
stage.enemies[2].health  // third enemy's health
root.tooltips.60         // numeric property names work in dot access too</pre>

                <h2>Implicit "this"</h2>
                <pre>.health    // equivalent to this.health</pre>

                <h2>Arithmetic</h2>
                <p>All arithmetic broadcasts over arrays:</p>
                <pre>stage.enemies.health * 2     // doubles every value
stage.player.x + 100        // scalar + scalar</pre>

                <table>
                    <thead><tr><th>a.length</th><th>b.length</th><th>Result</th></tr></thead>
                    <tbody>
                        <tr><td>1</td><td>N</td><td>Scalar broadcasts to N elements</td></tr>
                        <tr><td>N</td><td>1</td><td>Scalar broadcasts to N elements</td></tr>
                        <tr><td>N</td><td>N</td><td>Element-wise operation</td></tr>
                        <tr><td>M</td><td>N (M!=N)</td><td>Array of NaN</td></tr>
                    </tbody>
                </table>

                <h2>Operators</h2>
                <table>
                    <thead><tr><th>Category</th><th>Operators</th></tr></thead>
                    <tbody>
                        <tr><td>Arithmetic</td><td><code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>%</code> <code>**</code></td></tr>
                        <tr><td>Comparison</td><td><code>==</code> <code>!=</code> <code>&gt;</code> <code>&lt;</code> <code>&gt;=</code> <code>&lt;=</code></td></tr>
                        <tr><td>Boolean</td><td><code>&amp;&amp;</code> <code>||</code> <code>^</code> <code>!</code></td></tr>
                        <tr><td>Ternary</td><td><code>condition ? then : else</code></td></tr>
                    </tbody>
                </table>

                <h2>Functions</h2>
                <table>
                    <thead><tr><th>Function</th><th>Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>len(expr)</code></td><td>Returns the number of elements in the array produced by <code>expr</code></td></tr>
                    </tbody>
                </table>
                <pre>len(stage.enemies)       // number of enemies on stage
len(stage.inventory)     // number of inventory items</pre>

                <h2>Number Literals</h2>
                <p>Both integers and floating-point numbers are supported:</p>
                <pre>100                      // integer
3.14                     // floating-point</pre>

                <h2>Negation</h2>
                <p>The <code>!</code> operator negates a boolean value. It broadcasts over arrays:</p>
                <pre>!stage.player.dead           // true when player is alive
!(stage.player.health == 0)  // same thing with grouped expression</pre>
            </section>

            <section id="ref-globals">
                <h1>Globals</h1>
                <table>
                    <thead><tr><th>Global</th><th>Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>stage</code></td><td>The game's root MovieClip (singleton)</td></tr>
                        <tr><td><code>root</code></td><td>Combined game state &mdash; includes the stage tree plus class statics</td></tr>
                        <tr><td><code>main</code></td><td>Smart alias that resolves to the most useful root object for the current game</td></tr>
                        <tr><td><code>class</code></td><td>Namespace for accessing static fields on game classes</td></tr>
                        <tr><td><code>this</code></td><td>Current context array &mdash; the values being filtered in a property access</td></tr>
                        <tr><td><code>key</code></td><td>Current keys array &mdash; property names or indices, parallel to <code>this</code></td></tr>
                        <tr><td><code>stage_frame</code></td><td>Current frame number of the game's root MovieClip</td></tr>
                    </tbody>
                </table>
                <h2>Literals</h2>
                <table>
                    <thead><tr><th>Literal</th><th>Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>null</code></td><td>Null literal &mdash; used to test whether an expression returned any results</td></tr>
                    </tbody>
                </table>
            </section>

            <section id="ref-remembered-values">
                <h1>Remembered Values</h1>
                <p>
                    Wrapping an expression in curly braces caches its last non-empty result:
                </p>
                <pre>{stage.player.textbox.debuff}</pre>
                <p>
                    On each evaluation, the inner expression runs normally. If it returns a non-empty array,
                    the cache is updated and that value is used. If it returns an empty array (e.g. the UI element
                    was detached from the stage), the previously cached value is returned instead.
                </p>
                <p>
                    Identical expressions share the same cache entry across all formulas in the game.
                    The cache key is derived from the compiled bytecode, so textually identical expressions
                    always share a cache.
                </p>
                <pre>// Useful in ternary expressions for resilient access:
{stage.player.health} != null ? {stage.player.health} + " HP" : "Unknown"</pre>
                <p>
                    <strong>Note:</strong> "Empty" strictly means an empty array <code>[]</code>.
                    An expression that returns <code>[null]</code> or <code>[0]</code> is considered non-empty
                    and will update the cache.
                </p>
            </section>

            <section id="ref-function-hooks">
                <h1>Function Hooks</h1>
                <p>
                    When a DSL expression accesses a property whose value is a function,
                    the runtime transparently wraps that function so it can detect when
                    the game calls it. The function still appears as a function &mdash; what
                    changes is that it gains a synthetic <code>.triggered</code> property.
                </p>
                <pre>stage.menu.gotoMySite           // the function reference (wrapped)
stage.menu.gotoMySite.triggered // 1 on frames the function fired, else 0</pre>
                <p>
                    This makes "achievement when X is called" expressible directly. Pair
                    it with a hit count to require a specific number of invocations:
                </p>
                <pre>stage.menu.gotoMySite.triggered == 1   // with maxHits: 1, fires on first call</pre>
                <p>
                    The wrapper takes a snapshot once per frame, so all conditions in a
                    given evaluation pass see a consistent view: a call lands in the
                    <em>next</em> frame's snapshot, never mid-evaluation.
                </p>
                <p>
                    <strong>Self-healing:</strong> if the game destroys and recreates the
                    parent object, the new function instance is unwrapped &mdash; the next
                    evaluation re-wraps it automatically. No manual reset needed.
                </p>
                <p>
                    <strong>Limitations:</strong> functions stored in read-only or native
                    slots cannot be wrapped, and their <code>.triggered</code> will read
                    as 0 forever. Most user-defined game functions are wrappable.
                </p>
            </section>

            <section id="ref-achievement-states">
                <h1>Achievement States</h1>
                <table>
                    <thead><tr><th>State</th><th>Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>ACTIVE</code></td><td>Not yet unlocked. Conditions are being evaluated every frame.</td></tr>
                        <tr><td><code>INACTIVE</code></td><td>Disabled. Conditions are not evaluated. Toggle via the Active checkbox in the Asset Editor or the Activate/Deactivate button in the Asset List.</td></tr>
                        <tr><td><code>TRIGGERED</code></td><td>Unlocked. Persisted in the user profile. Conditions stop being evaluated.</td></tr>
                    </tbody>
                </table>
                <p>
                    When a game is loaded with a user profile, any achievements that were previously
                    unlocked for that user are set to TRIGGERED immediately. The state field is ephemeral &mdash;
                    it resets to ACTIVE on each load unless the profile says it was unlocked.
                </p>
            </section>

            <section id="ref-user-profiles">
                <h1>User Profiles</h1>
                <p>
                    Profiles are stored as JSON files in <code>RACache/users/</code>.
                    Each profile tracks which achievements have been unlocked per game.
                </p>
                <p>
                    A default <strong>Guest</strong> profile is auto-created if no profiles exist.
                    The launcher sidebar lets you select or create profiles before loading a game.
                </p>
                <p>
                    Profile data includes the user's name, creation date, and a map of game IDs to
                    unlock records. When an achievement transitions to TRIGGERED, the profile is
                    updated and saved automatically.
                </p>
            </section>

        </main>
    </div>
</template>

<style>
    .doc-layout {
        display: flex;
        height: 100vh;
        overflow: hidden;
    }

    /* --- Table of Contents sidebar --- */
    .doc-toc {
        width: 180px;
        flex-shrink: 0;
        background-color: var(--c-surface-alt);
        border-right: 1px solid var(--c-border);
        overflow-y: auto;
        padding: 0.75rem 0;
    }

    .toc-section-label {
        padding: 0.75rem 1rem 0.25rem;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--c-text-muted);
    }

    .toc-section-label:first-child {
        padding-top: 0.25rem;
    }

    .doc-toc ul {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    .doc-toc li a {
        display: block;
        padding: 0.3rem 1rem;
        font-size: 0.8125rem;
        color: var(--c-text-secondary);
        text-decoration: none;
        border-left: 2px solid transparent;
        transition: all var(--duration) var(--ease);
    }

    .doc-toc li a:hover {
        color: var(--c-text);
        background-color: rgba(0, 0, 0, 0.03);
    }

    .doc-toc li a.active {
        color: var(--c-primary);
        border-left-color: var(--c-primary);
        font-weight: 600;
    }

    /* --- Main content area --- */
    .doc-content {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem 2rem 3rem;
    }

    .doc-content section {
        margin-bottom: 2.5rem;
    }

    .doc-content h1 {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--c-text);
        margin: 0 0 1rem 0;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--c-border);
    }

    .doc-content h2 {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--c-text);
        margin: 1.25rem 0 0.5rem 0;
    }

    .doc-content p {
        color: var(--c-text-secondary);
        margin: 0.5rem 0;
        line-height: 1.65;
    }

    .doc-content ol,
    .doc-content ul {
        color: var(--c-text-secondary);
        margin: 0.5rem 0;
        padding-left: 1.5rem;
        line-height: 1.65;
    }

    .doc-content li {
        margin: 0.25rem 0;
    }

    .doc-content code {
        font-family: var(--font-mono);
        font-size: 0.8em;
        background-color: var(--c-surface-alt);
        border: 1px solid var(--c-border-subtle);
        border-radius: 3px;
        padding: 0.1em 0.35em;
    }

    .doc-content kbd {
        font-family: var(--font-sans);
        font-size: 0.75em;
        font-weight: 600;
        background-color: var(--c-surface-alt);
        border: 1px solid var(--c-border);
        border-radius: 3px;
        padding: 0.15em 0.4em;
        box-shadow: 0 1px 0 var(--c-border);
    }

    .doc-content pre {
        font-family: var(--font-mono);
        font-size: 0.8125rem;
        background-color: var(--c-surface-alt);
        border: 1px solid var(--c-border-subtle);
        border-radius: var(--radius-md);
        padding: 0.75rem 1rem;
        margin: 0.75rem 0;
        overflow-x: auto;
        line-height: 1.6;
        color: var(--c-text);
        white-space: pre;
        user-select: text;
    }

    .doc-content table {
        width: 100%;
        border-collapse: collapse;
        margin: 0.75rem 0;
        font-size: 0.8125rem;
    }

    .doc-content thead th {
        background-color: var(--c-surface-alt);
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--c-text-muted);
        padding: 0.4375rem 0.75rem;
        text-align: left;
        border-bottom: 1px solid var(--c-border);
    }

    .doc-content tbody td {
        padding: 0.4375rem 0.75rem;
        color: var(--c-text-secondary);
        border-bottom: 1px solid var(--c-border-subtle);
    }

    .doc-content dl {
        margin: 0.5rem 0;
    }

    .doc-content dt {
        font-weight: 600;
        color: var(--c-text);
        margin-top: 0.5rem;
    }

    .doc-content dd {
        color: var(--c-text-secondary);
        margin: 0.15rem 0 0.5rem 1rem;
        line-height: 1.65;
    }
</style>

<script setup>
    import { ref, onMounted, onUnmounted } from 'vue';
    import { App } from '../js/app.ts';

    const toolsChapters = [
        { id: 'tool-game-info',           title: 'Game Info' },
        { id: 'tool-game-behavior',       title: 'Game Behavior' },
        { id: 'tool-network-behavior',    title: 'Network Behavior' },
        { id: 'tool-asset-list',          title: 'Asset List' },
        { id: 'tool-asset-editor',        title: 'Asset Editor' },
        { id: 'tool-rich-presence',       title: 'Rich Presence Editor' },
        { id: 'tool-memory-explorer',     title: 'Memory Explorer' },
        { id: 'tool-memory-search',       title: 'Memory Search' },
        { id: 'tool-memory-watch',        title: 'Memory Watch' },
        { id: 'tool-resource-explorer',   title: 'Resource Explorer' },
        { id: 'tool-recorded-test',       title: 'Recorded Test' },
        { id: 'tool-code-notes',          title: 'Code Notes' },
        { id: 'tool-event-log',           title: 'Event Log' },
        { id: 'tool-settings',            title: 'Settings' },
        { id: 'tool-benchmarking',        title: 'Benchmarking' },
    ];

    const guidesChapters = [
        { id: 'guide-creating-achievement', title: 'Creating an Achievement' },
        { id: 'guide-finding-value',        title: 'Finding a Value' },
        { id: 'guide-finding-property',     title: 'Finding a Property' },
        { id: 'guide-exploring-structure',  title: 'Exploring Structure' },
        { id: 'guide-tracking-changes',     title: 'Tracking Changes' },
        { id: 'guide-recording-test',       title: 'Recording a Test' },
    ];

    const referenceChapters = [
        { id: 'ref-dsl-syntax',          title: 'DSL Syntax' },
        { id: 'ref-globals',             title: 'Globals' },
        { id: 'ref-remembered-values',   title: 'Remembered Values' },
        { id: 'ref-function-hooks',      title: 'Function Hooks' },
        { id: 'ref-achievement-states',  title: 'Achievement States' },
        { id: 'ref-user-profiles',       title: 'User Profiles' },
    ];

    const allChapters = [...toolsChapters, ...guidesChapters, ...referenceChapters];

    const activeId = ref('tool-game-info');
    const contentEl = ref(null);

    const scrollTo = (id) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
    };

    let observer = null;

    onMounted(() => {
        observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        activeId.value = entry.target.id;
                    }
                }
            },
            { root: contentEl.value, rootMargin: '0px 0px -60% 0px', threshold: 0 }
        );

        for (const ch of allChapters) {
            const el = document.getElementById(ch.id);
            if (el) observer.observe(el);
        }
    });

    onUnmounted(() => {
        if (observer) observer.disconnect();
    });

    App.initialize().then(() => App.ready = true);
</script>
