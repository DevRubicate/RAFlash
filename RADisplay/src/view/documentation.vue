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

            <section id="tool-game-behavior">
                <h1>Game Behavior</h1>
                <p>
                    Configure metadata for the current game. Set the game's <strong>title</strong>,
                    <strong>origin URL</strong> (the original source where the SWF was hosted),
                    and upload a <strong>badge image</strong> that represents the game.
                </p>
                <p>
                    Changes are saved manually with the Save button. The origin URL is used
                    when the game needs to load external resources relative to its original host.
                </p>
            </section>

            <section id="tool-asset-list">
                <h1>Asset List</h1>
                <p>
                    The main achievement management view. Lists all achievement assets for the current game,
                    organized by tabs for different asset types. Each asset has a title, description, badge image,
                    and a set of conditions written in the Formula DSL.
                </p>
                <p>
                    Use the <strong>+</strong> button to create new assets. Click any asset to open it in the
                    <strong>Asset Editor</strong>, where you can define conditions, set point values, and configure behavior.
                </p>
                <p>
                    Assets with negative IDs are local/unpromoted &mdash; they only exist in your local game file
                    and haven't been submitted to a server yet.
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
                <p>
                    All modes support a text filter input to narrow results.
                    Key extraction uses the text before the first <code>: </code> separator in each row.
                </p>
            </section>

            <section id="tool-memory-search">
                <h1>Memory Search</h1>
                <p>
                    Recursively searches the game's entire stage tree for matching properties.
                    Returns the full path to each match, which you can then use in DSL expressions.
                </p>
                <p>Two search modes are available via the radio toggle:</p>
                <dl>
                    <dt>Value</dt>
                    <dd>Find properties whose current value matches the search term.</dd>

                    <dt>Name</dt>
                    <dd>Find properties whose name contains the search substring (case-insensitive).</dd>
                </dl>
                <p>
                    The search button shows the result count in parentheses.
                    Subsequent searches narrow within the previous result set &mdash; use <strong>Clear</strong> to reset
                    and search the full tree again.
                </p>
            </section>

            <section id="tool-memory-watch">
                <h1>Memory Watch</h1>
                <p>
                    Monitors a DSL expression continuously, logging its value every frame.
                    Enter a formula and click <strong>Watch</strong> to start.
                </p>
                <p>
                    In <strong>value mode</strong> (when the expression returns a simple value),
                    new entries are only added when the value changes, keeping the log clean.
                    In <strong>structure mode</strong> (when the expression returns properties),
                    it tracks which keys appear and marks removed keys with strikethrough.
                </p>
                <p>
                    Use <strong>Clear</strong> to clear the visible log without resetting the watch.
                    Click <strong>Stop</strong> to end monitoring.
                </p>
            </section>

            <section id="tool-code-notes">
                <h1>Code Notes</h1>
                <p>
                    A table of annotations that map DSL paths to human-readable descriptions.
                    Each note has a <strong>description</strong>, a <strong>path</strong> (a DSL expression),
                    and a live <strong>value</strong> column that updates automatically.
                </p>
                <p>
                    Code notes serve as a reference sheet &mdash; document what you've discovered about the game's
                    memory layout so you don't have to re-explore it later. Notes can be reordered with the
                    arrow buttons and searched with the filter input.
                </p>
            </section>

            <!-- ============ GUIDES ============ -->

            <section id="guide-creating-achievement">
                <h1>Creating an Achievement</h1>
                <ol>
                    <li>Press <kbd>F12</kbd> to open the Devtools menu.</li>
                    <li>Open <strong>Asset List</strong> and click <strong>+</strong> to create a new asset.</li>
                    <li>Give it a title and description.</li>
                    <li>In the Asset Editor, add one or more <strong>conditions</strong>. Each condition is a DSL expression that should evaluate to true when the achievement should unlock.</li>
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
stage.enemies[2].health  // third enemy's health</pre>

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
                        <tr><td>Boolean</td><td><code>&amp;&amp;</code> <code>||</code> <code>^</code></td></tr>
                        <tr><td>Ternary</td><td><code>condition ? then : else</code></td></tr>
                    </tbody>
                </table>

                <h2>Comments</h2>
                <pre>// single line
/* multi-line (nestable) */</pre>
            </section>

            <section id="ref-globals">
                <h1>Globals</h1>
                <table>
                    <thead><tr><th>Global</th><th>Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>stage</code></td><td>The game's root MovieClip (singleton)</td></tr>
                        <tr><td><code>this</code></td><td>Current context array &mdash; the values being filtered in a property access</td></tr>
                        <tr><td><code>key</code></td><td>Current keys array &mdash; property names or indices, parallel to <code>this</code></td></tr>
                        <tr><td><code>stage_frame</code></td><td>Current frame number of the game's root MovieClip</td></tr>
                        <tr><td><code>null</code></td><td>Null literal</td></tr>
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

            <section id="ref-achievement-states">
                <h1>Achievement States</h1>
                <table>
                    <thead><tr><th>State</th><th>Description</th></tr></thead>
                    <tbody>
                        <tr><td><code>ACTIVE</code></td><td>Not yet unlocked. Conditions are being evaluated every frame.</td></tr>
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
        { id: 'tool-game-behavior',    title: 'Game Behavior' },
        { id: 'tool-asset-list',       title: 'Asset List' },
        { id: 'tool-memory-explorer',  title: 'Memory Explorer' },
        { id: 'tool-memory-search',    title: 'Memory Search' },
        { id: 'tool-memory-watch',     title: 'Memory Watch' },
        { id: 'tool-code-notes',       title: 'Code Notes' },
    ];

    const guidesChapters = [
        { id: 'guide-creating-achievement', title: 'Creating an Achievement' },
        { id: 'guide-finding-value',        title: 'Finding a Value' },
        { id: 'guide-finding-property',     title: 'Finding a Property' },
        { id: 'guide-exploring-structure',  title: 'Exploring Structure' },
        { id: 'guide-tracking-changes',     title: 'Tracking Changes' },
    ];

    const referenceChapters = [
        { id: 'ref-dsl-syntax',          title: 'DSL Syntax' },
        { id: 'ref-globals',             title: 'Globals' },
        { id: 'ref-remembered-values',   title: 'Remembered Values' },
        { id: 'ref-achievement-states',  title: 'Achievement States' },
        { id: 'ref-user-profiles',       title: 'User Profiles' },
    ];

    const allChapters = [...toolsChapters, ...guidesChapters, ...referenceChapters];

    const activeId = ref('tool-game-behavior');
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
